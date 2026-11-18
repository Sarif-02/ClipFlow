import {
  CalendarDotsIcon, CheckCircleIcon, HardDriveIcon, FilmStripIcon,
  GaugeIcon, NotePencilIcon, ListBulletsIcon, PlusIcon, UsersIcon, WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { displayTime } from "@/lib/planning/model";
import { ClipPreview, ClipThumbnail } from "@/components/clips/clip-preview";
import { UploadButton } from "@/components/clips/upload";
import { formatBytes, formatDuration, type ClipInfo } from "@/lib/clips/types";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Status, type Tone } from "@/components/ui/status";

const metrics = [
  { key: "accounts", label: "Connected accounts", emptyLabel: "YouTube and Instagram", Icon: UsersIcon },
  { key: "ready", label: "Ready clips", emptyLabel: "Passed local analysis", Icon: FilmStripIcon },
  { key: "publishedToday", label: "Published today", emptyLabel: "Across all destinations", Icon: CheckCircleIcon },
  { key: "drafts", label: "Saved drafts", emptyLabel: "Ready to resume", Icon: NotePencilIcon },
  { key: "scheduled", label: "Scheduled jobs", emptyLabel: "Confirmed destinations", Icon: CalendarDotsIcon },
] as const;

function OverviewPanel({ id, title, description, detail, children }: {
  id: string; title: string; description: string; detail?: ReactNode; children: ReactNode;
}) {
  return (
    <Card className="overview-panel" aria-labelledby={id}>
      <header className="panel-header">
        <div><h2 id={id} className="dashboard-section">{title}</h2><p className="caption-2 muted">{description}</p></div>
        {detail}
      </header>
      {children}
    </Card>
  );
}

const services = [
  { name: "Account health", description: "YouTube and Instagram", status: "No accounts", Icon: UsersIcon },
  { name: "Daily publishing quota", description: "Usage by provider", status: "Unavailable", Icon: GaugeIcon },
];

export function Overview({ summary, uploadLimit, counts, upcoming, publishing }: {
  summary: { count: number; bytes: number; recent: ClipInfo[] }; uploadLimit: number;
  counts: { drafts: number; accounts: number; publishedToday: number };
  upcoming: { id: string; filename: string; date: string; account: string; timezone: string }[];
  publishing: { youtube: number; instagram: number; ready: number; scheduled: number; active: number; failed: number; online: boolean;
    activity: { id: string; filename: string; status: string; accountName: string }[]; issues: { id: string; filename: string; state: string }[];
    reconnect: { id: string; name: string }[] };
}) {
  const statusRows = [{ ...services[0], status: `${publishing.youtube} YouTube · ${publishing.instagram} Instagram`, tone: publishing.youtube + publishing.instagram > 0 ? "success" : "neutral" },
    { name: "Local storage", description: `${summary.count} stored clips`, status: formatBytes(summary.bytes), Icon: HardDriveIcon, tone: "neutral" },
    { ...services[1], name: "Publishing worker", description: "Local background process", status: publishing.online ? "Online" : "Offline", tone: publishing.online ? "success" : "error" }];
  const totals = { ...counts, ready: publishing.ready, scheduled: publishing.scheduled };
  return (
    <div className="overview">
      <div className="overview-header">
        <div>
          <h1 className="heading-4">Overview</h1>
          <p className="body-6 muted">See what’s ready, what’s scheduled, and what needs attention.</p>
        </div>
        <div className="overview-actions" aria-describedby="action-availability">
          <UploadButton limit={uploadLimit} label="Import clips" primary={false} />
          <Link href="/compose?new=1" className={buttonVariants({ variant: "primary" })}><PlusIcon size={18} aria-hidden="true" /> Create post</Link>
        </div>
      </div>

      <div className="availability caption-5" id="action-availability">
        <span className="status-dot" aria-hidden="true" />
        <span><strong>Drafts stay local until confirmed.</strong> Scheduled jobs need this computer and the worker online.</span>
      </div>

      <dl className="metrics planning-metrics" aria-label="Workspace totals">
        {metrics.map(({ key, label, emptyLabel, Icon }) => (
          <div className="card metric" key={label}>
            <dt className="title-4"><span>{label}</span><Icon size={18} aria-hidden="true" /></dt>
            <dd className="metric-value heading-4 technical">{totals[key]}</dd>
            <dd className="caption-5 muted">{emptyLabel}</dd>
          </div>
        ))}
      </dl>

      <div className="overview-grid">
        <OverviewPanel id="recent-clips" title="Recent clips" description="The latest imports in your library."
          detail={summary.count > 0 && <Link className="workspace-link caption-1" href="/clips">View library</Link>}>
          {summary.recent.length ? <ul className="recent-clips">
            {summary.recent.map(clip => <li key={clip.id}>
              <ClipPreview clip={clip} trigger={<button type="button" className="recent-clip" aria-label={`Preview ${clip.displayName}`}>
                <ClipThumbnail clip={clip} /><span><span className="title-4 recent-name">{clip.displayName}</span>
                  <span className="caption-5 technical muted">{formatDuration(clip.duration)}</span></span>
              </button>} />
            </li>)}
          </ul> : <EmptyState icon={<FilmStripIcon size={24} />} title="No clips yet" description="Imported videos and their thumbnails will appear here." />}
        </OverviewPanel>

        <OverviewPanel id="publishing-queue" title="Publishing queue" description="Track confirmed jobs."
          detail={<Link className="workspace-link caption-1" href="/queue">Open queue</Link>}>
          {publishing.active || publishing.scheduled ? <p className="body-6">{publishing.active} active · {publishing.scheduled} scheduled</p> :
            <EmptyState icon={<ListBulletsIcon size={24} />} title="No active jobs" description="Confirmed publications will appear in the queue." />}
        </OverviewPanel>

        <OverviewPanel id="upcoming-posts" title="Upcoming publications" description="Confirmed jobs with future posting times."
          detail={<Link className="workspace-link caption-1" href="/calendar">Open Calendar</Link>}>
          {upcoming.length ? <ul className="plan-list">{upcoming.map(post => <li className="plan-row" key={post.id}>
            <Link className="workspace-link title-4" href="/queue">{post.filename} · {post.account}</Link>
            <time dateTime={post.date} className="caption-5 muted technical">{displayTime(post.date, post.timezone)}</time>
          </li>)}</ul> : <EmptyState icon={<CalendarDotsIcon size={24} />} title="Nothing scheduled" description="Confirm a scheduled draft to add it here." />}
        </OverviewPanel>

        <OverviewPanel id="workspace-status" title="Workspace status" description="Connections, imports, and provider limits."
          detail={<div className="plan-actions"><Link className="workspace-link caption-1" href="/analytics">Analytics</Link>
            <Link className="workspace-link caption-1" href="/integrations">Connect account</Link></div>}>
          <ul className="service-list">
            {statusRows.map(({ name, description, status, Icon, tone }) => (
              <li key={name} className="service-row">
                <span className="service-icon" aria-hidden="true"><Icon size={18} /></span>
                <div className="service-copy"><p className="title-4">{name}</p><p className="caption-5 muted">{description}</p></div>
                <Status tone={tone as Tone}>{status}</Status>
              </li>
            ))}
          </ul>
        </OverviewPanel>

        <OverviewPanel id="failed-jobs" title="Needs attention" description="Failed jobs and items that require review.">
          <div className="inline-state">
            <WarningCircleIcon size={20} aria-hidden="true" />
            <div><p className="title-4">{publishing.failed ? `${publishing.failed} jobs need attention` : "No failed jobs"}</p>
              <Link className="workspace-link caption-5" href="/queue">Inspect publishing queue</Link></div>
          </div>
          <ul className="plan-list settings-note">{publishing.issues.map(job => <li key={job.id} className="plan-row"><Link className="workspace-link title-4" href="/queue">{job.filename}</Link>
            <Status state={job.state}>{job.state === "FAILED" ? "Failed" : job.state === "PAUSED_AUTH" ? "Reconnect required" : "Needs review"}</Status></li>)}
          {publishing.reconnect.map(account => <li key={account.id} className="plan-row"><Link className="workspace-link title-4" href="/accounts">{account.name}</Link><Status state="AUTH_REQUIRED">Reconnect required</Status></li>)}</ul>
        </OverviewPanel>
        {publishing.activity.length > 0 && <OverviewPanel id="recent-activity" title="Recent activity" description="Latest provider outcomes"
          detail={<Link className="workspace-link caption-1" href="/history">History</Link>}>
          <ul className="plan-list">{publishing.activity.map(item => <li className="plan-row body-6" key={item.id}>
            <span>{item.filename} · {item.accountName}</span><Status state={item.status}>{item.status === "SUCCEEDED" ? "Published" : item.status === "FAILED" ? "Failed" : "Needs review"}</Status>
          </li>)}</ul>
        </OverviewPanel>}
      </div>
    </div>
  );
}
