import { db } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { hasClipMedia } from "@/lib/clips/storage";
import { providerConfig, runtimeSettings } from "@/lib/integrations/config";
import { localInstant, publishingContent, targetPublishingContent, wallTime, youtubeMetadataIssues, type Content } from "@/lib/planning/model";
import { validId } from "@/lib/planning/drafts";
import { ProviderError } from "@/lib/integrations/network";
import type { Prisma } from "@/generated/prisma/client";

export const runnable = ["QUEUED", "SCHEDULED", "RETRY", "PROCESSING", "AWAITING_PROVIDER"];
const unsent = ["QUEUED", "SCHEDULED", "RETRY", "PAUSED_AUTH", "FAILED", "NEEDS_REVIEW"];
export const jobDetail = { target: { include: { account: true, post: { include: { clip: true } } } } } as const;
export type Work = Prisma.JobGetPayload<{ include: typeof jobDetail }>;
export const leaseMs = 90000;
const youtubeZone = "America/Los_Angeles";
const plusDay = (value: string) => new Date(+new Date(value + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
export function quotaWindow(zone: string, now = new Date()) {
  const day = wallTime(now, zone).slice(0, 10);
  return { day, reset: localInstant(plusDay(day) + "T00:00", zone) ?? new Date(+now + 86400000) };
}
export async function reserveUpload(work: Work, now = new Date()) {
  const settings = await runtimeSettings();
  const { day, reset } = quotaWindow(work.target.account.platform === "YOUTUBE" ? youtubeZone : settings.timezone, now);
  const limits = [{ key: `account:${work.target.accountId}:${day}`, maximum: settings.accountDaily }];
  if (work.target.account.platform === "YOUTUBE") limits.unshift({ key: `youtube:${day}`, maximum: settings.youtubeDaily });
  await db().$transaction(async tx => {
    for (const { key, maximum } of limits) {
      await tx.quotaUsage.upsert({ where: { key }, create: { key, expiresAt: reset }, update: {} });
      const result = await tx.quotaUsage.updateMany({ where: { key, used: { lt: maximum } }, data: { used: { increment: 1 } } });
      if (!result.count) throw new ProviderError("quota", "ClipFlow’s local upload allowance is exhausted.", 0, +reset - +now);
    }
  });
}

export function metadataFor(post: { content: unknown; filename: string }, target: { content: unknown }) {
  return targetPublishingContent(post.content as Content, target.content as Partial<Content>, post.filename);
}

export function validatePublication(platform: string, content: Content, clip: { size: number; codec: string | null; duration: number | null;
  width: number | null; height: number | null; audioCodec: string | null }) {
  if (platform === "YOUTUBE") {
    const issues = youtubeMetadataIssues(publishingContent(content));
    if (issues.length) throw new ClipError(400, issues.join(" "));
  } else if (platform === "INSTAGRAM") {
    if ((clip.codec !== "h264" && clip.codec !== "hevc") || (clip.audioCodec !== null && clip.audioCodec !== "aac") ||
      !clip.duration || clip.duration < 3 || clip.duration > 900 || clip.size > 1024 ** 3 ||
      !clip.width || clip.width > 1920 || !clip.height || clip.width / clip.height < 0.25 || clip.width / clip.height > 2.75) {
      throw new ClipError(400, "Instagram needs a compatible Reel: H.264 or HEVC MP4 with AAC when audio is present, 3 seconds to 15 minutes, at most 1 GB.");
    }
    if (reelCaption(content).length > 2200) throw new ClipError(400, "Instagram caption and hashtags must fit within 2200 characters.");
  } else throw new ClipError(400, "Unsupported destination platform.");
}
export const reelCaption = (content: Content) => [content.caption.trim(), content.hashtags.trim()].filter(Boolean).join("\n\n");

export async function queueDraft(id: string, input: { key?: unknown; revision?: unknown; removeAfterPublish?: unknown }) {
  if (!validId(id) || !validId(input.key)) throw new ClipError(400, "Use a valid draft and submission key.");
  if (input.removeAfterPublish !== undefined && typeof input.removeAfterPublish !== "boolean") throw new ClipError(400, "Choose whether to keep the clips after publishing.");
  const key = input.key;
  const current = await db().publishingDraft.findUnique({ where: { id }, include: {
    posts: { include: { clip: true, targets: { include: { account: { include: { credential: { select: { accountId: true } } } } } } } },
  } });
  if (!current) throw new ClipError(404, "Draft not found.");
  const countJobs = () => db().job.count({ where: { target: { post: { draftId: id } } } });
  if (current.status === "SUBMITTED" && current.submissionKey === key) return { count: await countJobs() };
  if (current.status !== "ACTIVE" || current.revision !== input.revision || current.step !== 5) throw new ClipError(409, "Reopen and save the latest reviewed draft before submitting.");
  const posts = current.posts.filter(post => post.status !== "CANCELLED");
  const now = new Date();
  if (!posts.length) throw new ClipError(400, "Select at least one clip.");
  for (const post of posts) {
    if (!post.clip || post.clip.status !== "READY" || !(await hasClipMedia(post.clip.id))) throw new ClipError(409, "A selected clip is missing or has not passed analysis.");
    if (!post.targets.length) throw new ClipError(400, "Select a destination for every clip.");
    if (current.scheduleMode !== "NOW" && (!post.scheduledAt || +post.scheduledAt <= +now)) throw new ClipError(400, "Choose a future posting time for each clip.");
    for (const target of post.targets) {
      if (target.account.status !== "CONNECTED" || !target.account.canPublish || !target.account.credential) throw new ClipError(409, "Reconnect an authorized publishing account before submitting.");
      validatePublication(target.account.platform, metadataFor(post, target), post.clip);
    }
  }
  const settings = await runtimeSettings();
  const nativeSchedule = (await providerConfig("YOUTUBE")).values.nativeSchedule;
  const { day } = quotaWindow(youtubeZone, now);
  const usage = await db().quotaUsage.findUnique({ where: { key: `youtube:${day}` } });
  const youtubeNow = current.scheduleMode !== "NOW" ? 0 : posts.flatMap(post => post.targets).filter(item => item.account.platform === "YOUTUBE").length;
  if (youtubeNow && youtubeNow + (usage?.used ?? 0) > settings.youtubeDaily) throw new ClipError(409, "This batch exceeds today's estimated YouTube capacity. Schedule it for another day or split it.");
  if (current.scheduleMode === "NOW") {
    const perAccount = new Map<string, { count: number; platform: string }>();
    for (const target of posts.flatMap(post => post.targets)) {
      perAccount.set(target.accountId, { count: 1 + (perAccount.get(target.accountId)?.count ?? 0), platform: target.account.platform });
    }
    for (const [account, value] of perAccount) {
      const zone = value.platform === "YOUTUBE" ? youtubeZone : settings.timezone;
      const used = await db().quotaUsage.findUnique({ where: { key: `account:${account}:${quotaWindow(zone, now).day}` } });
      if (value.count + (used?.used ?? 0) > settings.accountDaily) throw new ClipError(409, "One destination would exceed its local daily allowance. Split or schedule this batch.");
    }
  }
  return db().$transaction(async tx => {
    const claimed = await tx.publishingDraft.updateMany({ where: { id, status: "ACTIVE", revision: current.revision },
      data: { status: "SUBMITTED", submissionKey: key, revision: { increment: 1 } } });
    if (!claimed.count) {
      if (await tx.publishingDraft.count({ where: { id, submissionKey: key, status: "SUBMITTED" } })) return { count: await tx.job.count({ where: { target: { post: { draftId: id } } } }) };
      throw new ClipError(409, "This draft was changed or submitted. Check the queue.");
    }
    let count = 0;
    for (const post of posts) {
      const clipId = post.clipId;
      if (!clipId || !(await tx.clip.count({ where: { id: clipId, status: "READY" } }))) throw new ClipError(409, "A selected clip is no longer available.");
      const scheduledAt = current.scheduleMode === "NOW" ? null : post.scheduledAt;
      const state = scheduledAt ? "SCHEDULED" : "QUEUED";
      await tx.post.update({ where: { id: post.id }, data: { status: state, scheduledAt } });
      if (input.removeAfterPublish === true) {
        const cleanup = { requestedByPostId: post.id, dueAt: scheduledAt ?? now, state: "WAITING_FOR_PUBLICATION" };
        await tx.cleanupTask.upsert({ where: { clipId }, create: { clipId, ...cleanup }, update: cleanup });
      } else {
        await tx.cleanupTask.deleteMany({ where: { clipId, state: { in: ["WAITING_FOR_PUBLICATION", "PENDING"] } } });
      }
      for (const target of post.targets) {
        if (!(await tx.socialAccount.count({ where: { id: target.accountId, status: "CONNECTED", canPublish: true, credential: { isNot: null } } }))) throw new ClipError(409, "An account changed while the draft was being submitted.");
        await tx.postTarget.update({ where: { id: target.id }, data: { content: metadataFor(post, target), status: state } });
        const native = Boolean(nativeSchedule && target.account.platform === "YOUTUBE" && scheduledAt &&
          +scheduledAt > +now + 15 * 60000 && metadataFor(post, target).visibility === "public");
        await tx.job.create({ data: { targetId: target.id, state, scheduledAt, dueAt: native ? now : scheduledAt ?? now, nativeSchedule: native } });
        count++;
      }
    }
    return { count };
  });
}

export async function recoverLeases(now = new Date()) {
  await db().$transaction(async tx => {
    const expired = await tx.job.findMany({ where: { leaseUntil: { lte: now }, leaseOwner: { not: null } }, select: { id: true, attempts: true } });
    for (const job of expired) {
      await tx.job.updateMany({ where: { id: job.id, leaseUntil: { lte: now }, leaseOwner: { not: null } },
        data: { state: "RETRY", dueAt: now, leaseOwner: null, leaseUntil: null, error: "Worker stopped. Recovering the stored provider checkpoint." } });
      await tx.publishAttempt.updateMany({ where: { jobId: job.id, number: job.attempts, finishedAt: null }, data: { outcome: "INTERRUPTED", finishedAt: now } });
    }
  });
}

export async function claimJob(owner: string, now = new Date()) {
  const settings = await runtimeSettings();
  if (settings.paused) return null;
  return db().$transaction(async tx => {
    const current = await tx.appSetting.findUnique({ where: { key: "runtime" } });
    if ((current?.value as { paused?: boolean } | null)?.paused) return null;
    const running = await tx.job.findMany({ where: { leaseUntil: { gt: now } }, select: { target: { select: { accountId: true } } } });
    if (running.length >= settings.concurrency) return null;
    const blocked = [...new Set(running.map(row => row.target.accountId))].filter(id => running.filter(row => row.target.accountId === id).length >= settings.perAccount);
    const job = await tx.job.findFirst({ where: { leaseOwner: null, state: { in: runnable }, dueAt: { lte: now },
      target: { accountId: { notIn: blocked } } }, orderBy: [{ dueAt: "asc" }, { id: "asc" }],
      include: { target: { select: { accountId: true, account: { select: { platform: true } } } } } });
    if (!job) return null;
    if (job.state === "RETRY" && job.errorKind === "temporary" && job.attempts >= 10 && !job.remoteId) {
      await tx.job.update({ where: { id: job.id }, data: { state: "NEEDS_REVIEW", errorKind: "uncertain",
        error: "Automatic recovery reached its limit. Review the provider before retrying." } });
      await tx.postTarget.update({ where: { id: job.targetId }, data: { status: "NEEDS_REVIEW" } });
      return null;
    }
    if (job.state === "SCHEDULED" && job.scheduledAt && +now - +job.scheduledAt > 5 * 60000 && settings.missed !== "CATCH_UP") {
      if (settings.missed === "MOVE") {
        const slot = 15 * 60000;
        const youtube = job.target.account.platform === "YOUTUBE";
        const zone = youtube ? youtubeZone : settings.timezone;
        const booked = await tx.job.findMany({ where: { state: "SCHEDULED", id: { not: job.id },
          target: { accountId: job.target.accountId }, scheduledAt: { gt: now } }, select: { scheduledAt: true } });
        const occupied = new Set(booked.map(row => Math.floor(+row.scheduledAt! / slot)));
        let next = new Date((Math.floor(+now / slot) + 1) * slot);
        for (;;) {
          const { day, reset } = quotaWindow(zone, next);
          const keys = { [`account:${job.target.accountId}:${day}`]: settings.accountDaily,
            ...(youtube ? { [`youtube:${day}`]: settings.youtubeDaily } : {}) };
          const usage = await tx.quotaUsage.findMany({ where: { key: { in: Object.keys(keys) } } });
          if (usage.some(row => row.used >= keys[row.key])) next = new Date(Math.ceil(+reset / slot) * slot);
          else if (occupied.has(+next / slot)) next = new Date(+next + slot);
          else break;
        }
        await tx.job.update({ where: { id: job.id }, data: { dueAt: next, scheduledAt: next, nativeSchedule: false, error: "Missed schedule moved to the next local slot." } });
      } else {
        await tx.job.update({ where: { id: job.id }, data: { state: "NEEDS_REVIEW", errorKind: "missed", error: "The scheduled time passed while the worker was unavailable." } });
        await tx.postTarget.update({ where: { id: job.targetId }, data: { status: "NEEDS_REVIEW" } });
      }
      return null;
    }
    const result = await tx.job.updateMany({ where: { id: job.id, leaseOwner: null, state: job.state },
      data: { leaseOwner: owner, leaseUntil: new Date(+now + leaseMs), attempts: { increment: 1 },
        state: ["PROCESSING", "AWAITING_PROVIDER"].includes(job.state) ? job.state : "UPLOADING" } });
    if (!result.count) return null;
    await tx.publishAttempt.create({ data: { jobId: job.id, number: job.attempts + 1, outcome: "RUNNING" } });
    await tx.postTarget.update({ where: { id: job.targetId }, data: { status: ["PROCESSING", "AWAITING_PROVIDER"].includes(job.state) ? job.state : "UPLOADING" } });
    return tx.job.findUniqueOrThrow({ where: { id: job.id }, include: jobDetail });
  });
}

export async function changeJob(id: string, input: { action?: unknown; utc?: unknown }) {
  if (!validId(id)) throw new ClipError(404, "Job not found.");
  await db().$transaction(async tx => {
    const job = await tx.job.findUnique({ where: { id }, include: { target: { include: { account: true, post: true } } } });
    if (!job) throw new ClipError(404, "Job not found.");
    if (job.leaseOwner || !unsent.includes(job.state) || job.errorKind === "uncertain" || (job.remoteId && !(job.state === "PAUSED_AUTH" && input.action === "retry")) ||
      (job.checkpoint && input.action !== "retry")) throw new ClipError(409, "This job has started or may already exist at the provider. Check its status first.");
    let state: string;
    let dueAt = new Date();
    let scheduledAt: Date | null = job.scheduledAt;
    if (input.action === "cancel") state = "CANCELLED";
    else if (input.action === "retry") {
      if (!["FAILED", "RETRY", "PAUSED_AUTH", "NEEDS_REVIEW"].includes(job.state) || job.target.account.status !== "CONNECTED" || !job.target.account.canPublish) throw new ClipError(409, "The job is not eligible to retry. Check account permissions.");
      if (job.errorKind === "permanent" || job.errorKind === "quota" && +job.dueAt > Date.now()) throw new ClipError(409, "This job cannot be retried yet.");
      state = job.remoteId ? "PROCESSING" : scheduledAt && +scheduledAt > +dueAt ? "SCHEDULED" : "QUEUED";
      if (state === "SCHEDULED" && !job.nativeSchedule) dueAt = scheduledAt!;
    } else if (input.action === "reschedule") {
      if (typeof input.utc !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.utc) ||
        !Number.isFinite(Date.parse(input.utc)) || +new Date(input.utc) <= Date.now()) throw new ClipError(400, "Choose a future time.");
      scheduledAt = dueAt = new Date(input.utc); state = "SCHEDULED";
    } else throw new ClipError(400, "Unknown queue action.");
    await tx.job.update({ where: { id }, data: { state, scheduledAt, dueAt,
      ...(input.action === "reschedule" ? { nativeSchedule: false } : {}), error: null, errorKind: null } });
    await tx.postTarget.update({ where: { id: job.targetId }, data: { status: state } });
  });
}
