import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { db, enableWorkerWal } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { runtimeSettings } from "@/lib/integrations/config";
import { ProviderError } from "@/lib/integrations/network";
import { initializeMasterKey, seal, unseal } from "@/lib/integrations/secrets";
import { cleanupVerifiedMedia } from "@/lib/planning/retention";
import { maintainStorage } from "@/lib/clips/storage";
import { expireAnalytics } from "@/lib/analytics/cache";
import { refreshAutomaticAnalytics } from "@/lib/analytics/automatic";
import { claimJob, leaseMs, recoverLeases, type Work } from "./queue";
import { instagramPublisher, providerRetryDelay, youtubePublisher, type Checkpoint, type Publisher } from "./providers";
import type { Content } from "@/lib/planning/model";

export async function processJob(work: Work, owner: string, publish: Publisher, parent: AbortSignal) {
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, parent]);
  const where = { id: work.id, leaseOwner: owner };
  let busy = false;
  const keepAlive = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const result = await db().job.updateMany({ where: { ...where, leaseUntil: { gt: new Date() } }, data: { leaseUntil: new Date(Date.now() + leaseMs) } });
      if (!result.count) controller.abort();
    } catch { controller.abort(); }
    finally { busy = false; }
  }, 15000);
  let state = "NEEDS_REVIEW", remoteId = work.remoteId, remoteUrl = work.remoteUrl;
  let message: string | null = null, kind: string | null = null, dueAt = new Date();
  try {
    const checkpoint = work.checkpoint ? unseal<Checkpoint>(work.checkpoint, work.id) : {};
    const result = await publish({ work, checkpoint, signal, save: async (value, uploadedBytes) => {
      if (signal.aborted) throw new ProviderError("temporary", "Worker interrupted.");
      const updated = await db().job.updateMany({ where: { ...where, leaseUntil: { gt: new Date() } }, data: {
        checkpoint: Object.keys(value).length ? seal(value, work.id) : null, uploadedBytes,
        ...(value.remoteId ? { remoteId: value.remoteId } : {}),
      } });
      if (!updated.count) throw new ProviderError("temporary", "Job lease is no longer held.");
    } });
    state = result.state; remoteId = result.remoteId ?? remoteId; remoteUrl = result.remoteUrl ?? remoteUrl;
    if (state === "PUBLISHED" && !remoteId) throw new ProviderError("uncertain", "No verified remote ID was returned.");
    dueAt = new Date(Date.now() + (result.wait ?? 0));
  } catch (error) {
    const failure = error instanceof ProviderError ? error : error instanceof ClipError ? new ProviderError("permanent", error.message) :
      new ProviderError("uncertain", "The worker could not verify the provider outcome.");
    kind = failure.kind; message = failure.message;
    if (signal.aborted && parent.aborted) {
      state = "RETRY"; dueAt = new Date();
    } else if ((kind === "temporary" && (work.attempts < 10 || Boolean(work.remoteId) && work.attempts < 2000)) || kind === "quota") {
      state = "RETRY"; dueAt = new Date(Date.now() + providerRetryDelay(work.target.account.platform, failure, work.attempts));
    } else if (kind === "authorization") state = "PAUSED_AUTH";
    else if (kind === "permanent") state = "FAILED";
    else { state = "NEEDS_REVIEW"; kind = "uncertain"; }
  } finally { clearInterval(keepAlive); }
  if (controller.signal.aborted) return;
  await db().$transaction(async tx => {
    const result = await tx.job.updateMany({ where: { ...where, leaseUntil: { gt: new Date() } },
      data: { state, remoteId: remoteId ?? undefined, remoteUrl, error: message, errorKind: kind, dueAt, leaseOwner: null, leaseUntil: null,
        ...(state === "PUBLISHED" ? { checkpoint: null } : {}) } });
    if (!result.count) return;
    if (state === "PAUSED_AUTH" && /expired|revoked/i.test(message ?? "")) {
      await tx.socialAccount.updateMany({ where: { id: work.target.accountId, status: "CONNECTED" },
        data: { status: "AUTH_REQUIRED", canPublish: false, canAnalyze: false, authIssue: message } });
      await tx.analyticsCache.deleteMany({ where: { accountId: work.target.accountId } });
      await tx.job.updateMany({ where: { target: { accountId: work.target.accountId }, leaseOwner: null, state: { in: ["QUEUED", "SCHEDULED", "RETRY", "PROCESSING", "AWAITING_PROVIDER"] } },
        data: { state: "PAUSED_AUTH", errorKind: "authorization", error: message } });
    }
    const finished = new Date();
    if (state === "PROCESSING" || state === "AWAITING_PROVIDER" || state === "PUBLISHED") {
      await tx.socialAccount.updateMany({ where: { id: work.target.accountId, status: "CONNECTED" }, data: { lastApiAt: finished } });
    }
    await tx.publishAttempt.updateMany({ where: { jobId: work.id, number: work.attempts }, data: { outcome: state, finishedAt: finished, error: message } });
    const published = state === "PUBLISHED";
    await tx.postTarget.update({ where: { id: work.targetId }, data: { status: published ? "SUCCEEDED" : state, ...(published ? { verifiedAt: finished } : {}) } });
    const post = work.target.post, account = work.target.account, content = work.target.content as Content;
    if (published || ["FAILED", "NEEDS_REVIEW"].includes(state)) {
      await tx.publicationHistory.create({ data: { targetId: work.targetId, filename: post.filename,
        title: account.platform === "YOUTUBE" ? content.title : content.caption, platform: account.platform, accountName: account.name,
        remoteAccount: account.remoteId, status: published ? "SUCCEEDED" : state === "FAILED" ? "FAILED" : "UNCERTAIN",
        remoteMediaId: remoteId, remoteUrl, scheduledAt: work.scheduledAt, publishedAt: published ? finished : null,
        checksum: post.clip?.checksum, errorSummary: message } });
    }
    if (published && !(await tx.postTarget.count({ where: { postId: post.id, status: { not: "SUCCEEDED" } } }))) {
      await tx.post.update({ where: { id: post.id }, data: { status: "SUCCEEDED" } });
      if (post.clipId) {
        await tx.cleanupTask.updateMany({ where: { clipId: post.clipId, requestedByPostId: post.id, state: "WAITING_FOR_PUBLICATION" },
          data: { dueAt: finished, state: "PENDING" } });
      }
    }
    if (published && post.clipId) {
      await tx.cleanupTask.updateMany({ where: { clipId: post.clipId, state: "PENDING", dueAt: { gt: finished } },
        data: { dueAt: finished } });
    }
  });
}

export async function runCleanup(now = new Date()) {
  const tasks = await db().cleanupTask.findMany({ where: { dueAt: { lte: now }, state: "PENDING" }, take: 12, orderBy: { dueAt: "asc" } });
  for (const task of tasks) {
    let done = false;
    try { done = await cleanupVerifiedMedia(task.clipId, now) ||
      Boolean(await db().clip.count({ where: { id: task.clipId, status: "MEDIA_REMOVED" } })); }
    catch { /* Keep the durable task pending for another attempt. */ }
    await db().cleanupTask.updateMany({ where: { clipId: task.clipId, updatedAt: task.updatedAt },
      data: { state: done ? "DONE" : "PENDING", dueAt: new Date(+now + 5 * 60000) } });
  }
}

export async function runWorker(signal: AbortSignal) {
  initializeMasterKey();
  const owner = randomUUID(), active = new Set<Promise<void>>();
  const publishers: Record<string, Publisher> = { YOUTUBE: youtubePublisher(), INSTAGRAM: instagramPublisher() };
  let upkeep = 0;
  let analytics: Promise<void> | undefined;
  try {
    while (!signal.aborted) {
      try {
        await enableWorkerWal();
        const now = new Date(), settings = await runtimeSettings();
        await db().workerHeartbeat.upsert({ where: { id: owner }, create: { id: owner, seenAt: now, running: active.size },
          update: { seenAt: now, running: active.size } });
        await recoverLeases(now);
        if (+now - upkeep > 60000) {
          await runCleanup(now);
          await maintainStorage();
          await expireAnalytics(now);
          await db().aiSuggestion.deleteMany({ where: { expiresAt: { lte: now } } });
          if (!analytics && !active.size && settings.analyticsHours) {
            analytics = refreshAutomaticAnalytics(settings.analyticsHours, now, signal)
              .catch(() => console.error("The automatic analytics refresh could not complete."))
              .finally(() => { analytics = undefined; });
          }
          await db().workerHeartbeat.deleteMany({ where: { seenAt: { lt: new Date(+now - 3600000) } } });
          await db().quotaUsage.deleteMany({ where: { expiresAt: { lte: now } } });
          await db().oAuthState.deleteMany({ where: { expiresAt: { lte: now } } });
          upkeep = +now;
        }
        while (!signal.aborted && !settings.paused && active.size < settings.concurrency) {
          const job = await claimJob(owner);
          if (!job) break;
          const publisher = publishers[job.target.account.platform];
          const task = processJob(job, owner, publisher ?? (async () => { throw new ProviderError("permanent", "Unsupported provider."); }), signal)
            .catch(() => console.error("A job could not be updated; its lease will be recovered."))
            .finally(() => active.delete(task));
          active.add(task);
        }
      } catch { console.error("Worker could not read the local queue. Retrying."); }
      await sleep(3000, undefined, { signal }).catch(() => {});
    }
  } finally {
    await Promise.allSettled(active);
    await analytics;
    await db().workerHeartbeat.deleteMany({ where: { id: owner } }).catch(() => {});
  }
}
