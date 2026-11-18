import { Suspense } from "react";
import { connection } from "next/server";
import { QueueBoard } from "@/components/planning/queue-board";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { db } from "@/lib/clips/db";
import { runtimeSettings } from "@/lib/integrations/config";
import { quotaWindow } from "@/lib/publishing/queue";

export const metadata = { title: "Publishing Queue" };

const pageSize = 50;
const finished = ["PUBLISHED", "CANCELLED"];

async function Queue({ searchParams }: { searchParams: PageProps<"/queue">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const completed = params.completed === "1";
  const requestedPage = typeof params.page === "string" && /^\d{1,8}$/.test(params.page) ? Math.max(1, Number(params.page)) : 1;
  const where = { state: completed ? { in: finished } : { notIn: finished } };
  const now = new Date().getTime();
  const [total, settings, heartbeat, quota] = await Promise.all([
    db().job.count({ where }),
    runtimeSettings(), db().workerHeartbeat.findFirst({ orderBy: { seenAt: "desc" } }),
    db().quotaUsage.findUnique({ where: { key: `youtube:${quotaWindow("America/Los_Angeles").day}` } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);
  const jobs = await db().job.findMany({ where, orderBy: completed ? [{ updatedAt: "desc" }, { id: "desc" }] : [{ dueAt: "asc" }, { id: "asc" }],
    skip: (page - 1) * pageSize, take: pageSize,
    include: { target: { include: { account: true, post: { include: { clip: true } } } },
      history: { select: { number: true, outcome: true, error: true }, orderBy: { number: "desc" }, take: 10 } } });
  return <QueueBoard key={`${completed}:${page}`} rows={jobs.map(job => {
    const { account, post } = job.target;
    const safe = !job.leaseOwner && job.errorKind !== "uncertain" && !job.remoteId;
    return { id: job.id, filename: post.filename, account: account.name, platform: account.platform, state: job.state,
      native: job.nativeSchedule,
      date: (job.scheduledAt ?? job.dueAt).toISOString(), updated: job.updatedAt.toISOString(), attempts: job.attempts,
      thumbnail: post.clip?.thumbnailPath ? post.clip.id : null,
      progress: job.uploadedBytes === null || !post.clip?.size ? null : Math.floor(job.uploadedBytes / post.clip.size * 100),
      error: job.error, remoteId: job.remoteId, remoteUrl: job.remoteUrl, attemptsLog: job.history,
      retry: !job.leaseOwner && (safe || job.state === "PAUSED_AUTH") && ["FAILED", "RETRY", "PAUSED_AUTH", "NEEDS_REVIEW"].includes(job.state) &&
        job.errorKind !== "permanent" && !(job.errorKind === "quota" && +job.dueAt > now) && account.status === "CONNECTED" && account.canPublish,
      edit: safe && !job.checkpoint && ["QUEUED", "SCHEDULED", "RETRY", "PAUSED_AUTH", "FAILED", "NEEDS_REVIEW"].includes(job.state) };
  })} completed={completed} page={page} pages={pages} paused={settings.paused} timezone={settings.timezone} online={Boolean(heartbeat && now - +heartbeat.seenAt < 15000)}
    estimate={`YouTube upload calls tracked locally: ${quota?.used ?? 0} of ${settings.youtubeDaily} today (Pacific time).`} />;
}

export default function Page({ searchParams }: PageProps<"/queue">) {
  return <Suspense fallback={<WorkspaceLoading />}><Queue searchParams={searchParams} /></Suspense>;
}
