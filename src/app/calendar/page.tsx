import { CalendarDotsIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { CalendarActions } from "@/components/planning/calendar-actions";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { Status } from "@/components/ui/status";
import { db } from "@/lib/clips/db";
import { runtimeSettings } from "@/lib/integrations/config";
import { displayTime, platformName, type Platform } from "@/lib/planning/model";

export const metadata = { title: "Calendar" };

async function CalendarData() {
  await connection();
  const [plans, jobs, { timezone }] = await Promise.all([
    db().post.findMany({ where: { status: "PLANNED", scheduledAt: { not: null }, draft: { status: "ACTIVE" } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], include: { draft: true, _count: { select: { targets: true } } } }),
    db().job.findMany({ where: { scheduledAt: { not: null }, state: { in: ["SCHEDULED", "UPLOADING", "PROCESSING", "AWAITING_PROVIDER", "RETRY", "PAUSED_AUTH", "NEEDS_REVIEW"] } },
      orderBy: [{ scheduledAt: "asc" }, { id: "asc" }], include: { target: { include: { account: true, post: true } } } }),
    runtimeSettings(),
  ]);
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Calendar</h1>
      <p className="body-6 muted">Review planned drafts and confirmed publication times.</p></div>
      <Link className={buttonVariants({ variant: "primary" })} href="/compose?new=1">New draft</Link></header>
    <Card className="overview-panel plan-stack"><h2 className="dashboard-section">Scheduled jobs</h2>
      {!jobs.length ? <EmptyState icon={<CalendarDotsIcon size={24} />} title="No scheduled jobs" description="Confirm a scheduled draft to queue its publications." /> :
        <ul className="plan-list">{jobs.map(job => {
          const date = job.scheduledAt!.toISOString();
          const { account, post } = job.target;
          const attention = job.state === "NEEDS_REVIEW" || job.state === "PAUSED_AUTH";
          return <li className="plan-row" key={job.id}><div className="plan-stack">
            <time dateTime={date} className="caption-1 technical">{displayTime(date, timezone)} · {timezone}</time>
            <p className="title-4">{post.filename}</p><p className="caption-5 muted">{account.name} · {platformName[account.platform as Platform]}</p>
            <Status state={job.state}>{attention ? "Needs attention" : job.nativeSchedule ? "YouTube native scheduling" : "Local worker"}</Status>
          </div><Link href="/queue" className="workspace-link caption-2">View publishing queue</Link></li>;
        })}</ul>}
    </Card>
    <Card className="overview-panel plan-stack"><h2 className="dashboard-section">Planned publications</h2>
      {!plans.length ? <EmptyState icon={<CalendarDotsIcon size={24} />} title="No local plans yet"
        description="Set a future posting time in a draft to add it to this calendar." /> :
        <ul className="plan-list">{plans.map(post => {
          const date = post.scheduledAt!.toISOString();
          const draft = post.draft!;
          return <li key={post.id} className="plan-row">
            <div className="plan-stack"><time dateTime={date} className="caption-1 technical">{displayTime(date, draft.timezone)} · {draft.timezone}</time>
              <Link href={`/compose?draft=${draft.id}`} className="workspace-link title-4">{post.filename}</Link>
              <p className="caption-5 muted">{draft.name} · {post._count.targets} destinations · Local plan</p></div>
            <CalendarActions id={post.id} date={date} timezone={draft.timezone} />
          </li>;
        })}</ul>}
    </Card>
  </div>;
}

export default function Page() {
  return <Suspense fallback={<WorkspaceLoading />}><CalendarData /></Suspense>;
}
