import { Suspense } from "react";
import { connection } from "next/server";
import { Overview } from "@/components/dashboard/overview";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { clipSummary } from "@/lib/clips/storage";
import { runtimeSettings } from "@/lib/integrations/config";
import { db } from "@/lib/clips/db";
import { localInstant, wallTime } from "@/lib/planning/model";

async function OverviewData() {
  await connection();
  const now = new Date();
  const pending = { state: { in: ["FAILED", "NEEDS_REVIEW", "PAUSED_AUTH"] } };
  const [summary, drafts, accounts, publishedToday, upcoming, runtime, youtube, instagram, ready, scheduled, active, failed, heartbeat, activity, issues, reconnect] = await Promise.all([
    clipSummary(), db().publishingDraft.count({ where: { status: "ACTIVE" } }),
    db().socialAccount.count({ where: { status: "CONNECTED" } }),
    runtimeSettings().then(settings => db().publicationHistory.count({ where: { status: "SUCCEEDED", publishedAt: { gte: todayStart(now, settings.timezone), lte: now } } })),
    db().job.findMany({ where: { state: { in: ["SCHEDULED", "PROCESSING", "AWAITING_PROVIDER", "UPLOADING"] }, scheduledAt: { gte: now } },
      orderBy: { scheduledAt: "asc" }, take: 4, select: { id: true, scheduledAt: true, target: { select: {
        post: { select: { filename: true } }, account: { select: { name: true } },
      } } } }),
    runtimeSettings(), db().socialAccount.count({ where: { status: "CONNECTED", platform: "YOUTUBE" } }),
    db().socialAccount.count({ where: { status: "CONNECTED", platform: "INSTAGRAM" } }),
    db().clip.count({ where: { status: "READY" } }), db().job.count({ where: { state: "SCHEDULED" } }),
    db().job.count({ where: { state: { in: ["QUEUED", "UPLOADING", "PROCESSING", "AWAITING_PROVIDER", "RETRY"] } } }),
    db().job.count({ where: pending }),
    db().workerHeartbeat.findFirst({ orderBy: { seenAt: "desc" } }),
    db().publicationHistory.findMany({ orderBy: { createdAt: "desc" }, take: 3, select: { id: true, filename: true, status: true, accountName: true } }),
    db().job.findMany({ where: pending, orderBy: { updatedAt: "desc" }, take: 3, select: { id: true, state: true, target: { select: { post: { select: { filename: true } } } } } }),
    db().socialAccount.findMany({ where: { status: "AUTH_REQUIRED" }, orderBy: { name: "asc" }, take: 3, select: { id: true, name: true } }),
  ]);
  return <Overview summary={summary} uploadLimit={runtime.uploadMib * 1048576} counts={{ drafts, accounts, publishedToday }}
    publishing={{ youtube, instagram, ready, scheduled, active, failed, online: Boolean(heartbeat && +now - +heartbeat.seenAt < 15000), activity,
      issues: issues.map(job => ({ id: job.id, state: job.state, filename: job.target.post.filename })), reconnect }}
    upcoming={upcoming.flatMap(job => job.scheduledAt ? [{ id: job.id, filename: job.target.post.filename, account: job.target.account.name,
      date: job.scheduledAt.toISOString(), timezone: runtime.timezone }] : [])} />;
}

function todayStart(now: Date, zone: string) {
  return localInstant(wallTime(now, zone).slice(0, 10) + "T00:00", zone) ?? new Date(now.toISOString().slice(0, 10));
}

export default function Page() {
  return <Suspense fallback={<WorkspaceLoading />}><OverviewData /></Suspense>;
}
