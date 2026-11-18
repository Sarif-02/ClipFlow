"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Card } from "@/components/ui/card";
import { Status } from "@/components/ui/status";
import { clipMedia } from "@/lib/clips/types";
import { displayTime, localInstant, wallTime } from "@/lib/planning/model";
import { planningRequest } from "./draft-actions";

export type QueueRow = { id: string; filename: string; account: string; platform: string; state: string; date: string;
  native: boolean;
  updated: string; attempts: number; thumbnail: string | null; progress: number | null; error: string | null;
  remoteId: string | null; remoteUrl: string | null; retry: boolean; edit: boolean; attemptsLog: { number: number; outcome: string; error: string | null }[] };
const states: Record<string, string> = { QUEUED: "Queued", SCHEDULED: "Scheduled", UPLOADING: "Uploading", PROCESSING: "Processing",
  AWAITING_PROVIDER: "Awaiting provider", PUBLISHED: "Published", RETRY: "Retry waiting", FAILED: "Failed",
  NEEDS_REVIEW: "Needs review", CANCELLED: "Cancelled", PAUSED_AUTH: "Authorization required" };

export function QueueBoard({ rows, paused, timezone, online, estimate, completed, page, pages }: {
  rows: QueueRow[]; paused: boolean; timezone: string; online: boolean; estimate: string; completed: boolean; page: number; pages: number;
}) {
  const router = useRouter();
  const [selection, setSelection] = useState<string[]>([]);
  const [confirm, setConfirm] = useState<{ job: QueueRow; action: "cancel" | "reschedule" }>();
  const [details, setDetails] = useState<QueueRow>();
  const [date, setDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const pageLink = (number: number) => `/queue?page=${number}${completed ? "&completed=1" : ""}`;
  useEffect(() => {
    const timer = setInterval(() => { if (!document.hidden && !confirm && !details && !busy) router.refresh(); }, 10000);
    return () => clearInterval(timer);
  }, [router, confirm, details, busy]);
  async function send(action: string, ids?: string[]) {
    const utc = action === "reschedule" ? localInstant(date, timezone)?.toISOString() : undefined;
    if (action === "reschedule" && !utc) { setProblem("Enter an unambiguous future time."); return; }
    setBusy(true); setProblem(""); setNotice("");
    try {
      const response = await planningRequest("/api/queue", "POST", { action, ids, utc });
      const failures = (response.results ?? []).filter((result: { ok: boolean }) => !result.ok);
      if (failures.length) setProblem(failures[0].error);
      else { setConfirm(undefined); setSelection([]); setNotice("Queue updated."); }
      router.refresh();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Queue update failed."); }
    finally { setBusy(false); }
  }
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Publishing Queue</h1>
      <p className="body-6 muted">Track each destination, retry eligible jobs, and adjust local posting times.</p></div>
      <Button onClick={() => router.refresh()}>Refresh status</Button></header>
    <div className="availability body-6"><Status state={online ? "ONLINE" : "OFFLINE"}>Worker {online ? "online" : "offline"}</Status>
      <Status tone={paused ? "warning" : "info"}>Queue {paused ? "paused" : "active"}</Status><span>{timezone} · Scheduled jobs need this computer online.</span></div>
    <div className="plan-actions"><Button disabled={busy} variant="primary" onClick={() => void send(paused ? "resume" : "pause")}>{paused ? "Resume queue" : "Pause queue"}</Button>
      <Button disabled={busy || !selection.length} onClick={() => void send("retry", selection)}>Retry selected</Button>
      <p className="caption-2 muted">{estimate}</p></div>
    <a className="workspace-link caption-2" href="https://developers.google.com/youtube/data/guides/quota_and_compliance_audits" target="_blank" rel="noreferrer">YouTube quota extension guide</a>
    {!confirm && problem && <p role="alert" className="body-6 form-error">{problem}</p>}
    {notice && <p role="status" className="body-6">{notice}</p>}
    <Card className="overview-panel plan-stack">
      <div className="plan-row"><h2 className="dashboard-section">{completed ? "Completed jobs" : "Active jobs and issues"}</h2>
        <Link className="workspace-link caption-2" href={completed ? "/queue" : "/queue?completed=1"}>{completed ? "View active jobs" : "View completed jobs"}</Link></div>
      {!rows.length ? <p className="chart-empty body-6 muted">{completed ? "No completed jobs yet." : "No active jobs or issues. Confirm a draft in Create Post to add jobs here."}</p> :
        <ul className="plan-list">{rows.map(job => <li className="plan-row" key={job.id}>
          <div className="plan-avatar">
            {job.retry && <input type="checkbox" aria-label={`Select ${job.filename} for ${job.account}`} checked={selection.includes(job.id)}
              onChange={event => setSelection(event.target.checked ? [...selection, job.id].slice(0, 50) : selection.filter(id => id !== job.id))} />}
            {job.thumbnail && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="analytics-image" src={clipMedia(job.thumbnail, "thumbnail")} alt="" loading="lazy" />
            )}
            <div><p className="title-4">{job.filename}</p><p className="caption-5 muted">{job.account} · {job.platform === "YOUTUBE" ? "YouTube" : "Instagram"}</p>
              <p className="caption-5 muted technical">{displayTime(job.date, timezone)} · Updated {displayTime(job.updated, timezone)}</p>
              {job.native && <p className="caption-5 muted">YouTube native schedule</p>}</div>
          </div>
          <div><Status state={job.state}>{states[job.state] ?? job.state}</Status><p className="caption-5 muted">{job.attempts} attempts
            {job.progress !== null && ` · ${job.progress}% transferred`}</p>
            {job.progress !== null && job.state === "UPLOADING" && <progress className="job-progress" aria-label="Upload progress" max={100} value={job.progress} />}
            {job.error && <p className="caption-5 form-error">{job.error}</p>}
            {job.remoteId && <p className="caption-5 technical">{job.remoteId}</p>}
            {job.remoteUrl && <a className="workspace-link caption-5" href={job.remoteUrl} target="_blank" rel="noreferrer">Open publication</a>}
          </div>
          <div className="plan-actions">
            <Button onClick={() => setDetails(job)}>Details</Button>
            {job.retry && <Button disabled={busy} onClick={() => void send("retry", [job.id])}>Retry</Button>}
            {job.edit && <>
              <Button disabled={busy} onClick={() => { setProblem(""); setDate(wallTime(new Date(job.date), timezone)); setConfirm({ job, action: "reschedule" }); }}>Reschedule</Button>
              <Button className="tone-error" disabled={busy} onClick={() => { setProblem(""); setConfirm({ job, action: "cancel" }); }}>Cancel job</Button>
            </>}
          </div>
        </li>)}</ul>}
      {pages > 1 && <nav aria-label="Queue pages" className="plan-actions">
        {page > 1 && <Link className="workspace-link caption-2" href={pageLink(page - 1)}>Previous page</Link>}
        <span className="caption-2 muted">Page {page} of {pages}</span>
        {page < pages && <Link className="workspace-link caption-2" href={pageLink(page + 1)}>Next page</Link>}
      </nav>}
    </Card>
    {confirm && <Modal open onOpenChange={open => { if (!open) setConfirm(undefined); }} busy={busy}
      title={confirm.action === "cancel" ? "Cancel publishing job?" : "Reschedule publishing job"}
      description={confirm.action === "cancel" ? "The pending job will stop. ClipFlow will keep the local video." : `Enter a new time in ${timezone}.`}>
      <div className="clip-dialog-body">
        {confirm.action === "reschedule" && <label className="clip-form-label title-4">New time<input className="clip-field body-6" type="datetime-local" value={date} onChange={event => setDate(event.target.value)} /></label>}
        {problem && <p role="alert" className="body-6 form-error">{problem}</p>}
      </div>
      <footer className="clip-dialog-footer"><Button disabled={busy} onClick={() => setConfirm(undefined)}>Keep job</Button>
        <Button disabled={busy} variant="primary" onClick={() => void send(confirm.action, [confirm.job.id])}>{confirm.action === "cancel" ? "Confirm cancellation" : "Save new time"}</Button></footer>
    </Modal>}
    {details && <Modal open onOpenChange={open => { if (!open) setDetails(undefined); }} title="Job details" description={details.filename}>
      <div className="clip-dialog-body">{details.error && <p className="body-6 form-error">{details.error}</p>}
        <p className="body-6">Status: {states[details.state] ?? details.state}</p>
        <ul className="plan-list">{details.attemptsLog.map(attempt => <li key={attempt.number} className="plan-row body-6">
          <span>Attempt {attempt.number} · {states[attempt.outcome] ?? attempt.outcome}</span><span className="muted">{attempt.error}</span></li>)}</ul>
      </div>
    </Modal>}
  </div>;
}
