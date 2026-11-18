import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/ssr";
import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { Status } from "@/components/ui/status";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { db } from "@/lib/clips/db";
import { displayTime, localInstant, platformName, platforms, type Platform } from "@/lib/planning/model";
import { runtimeSettings } from "@/lib/integrations/config";

export const metadata = { title: "History" };

const statuses = { SUCCEEDED: "Published", FAILED: "Failed", UNCERTAIN: "Needs review", CANCELLED: "Cancelled" };

async function History({ searchParams }: { searchParams: PageProps<"/history">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const read = (key: string) => typeof params[key] === "string" ? params[key].slice(0, 100) : "";
  const filename = read("filename").trim();
  const account = read("account").trim();
  const platform = read("platform");
  const status = read("status");
  const date = read("date");
  const sort = read("sort");
  const { timezone } = await runtimeSettings();
  const start = date ? localInstant(date + "T00:00", timezone) : null;
  const nextDay = start ? new Date(+new Date(date + "T00:00Z") + 86400000).toISOString().slice(0, 10) : "";
  const end = nextDay ? localInstant(nextDay + "T00:00", timezone) : null;
  const records = await db().publicationHistory.findMany({ where: {
    ...(filename ? { filename: { contains: filename } } : {}),
    ...(account ? { accountName: { contains: account } } : {}),
    ...(platforms.includes(platform as Platform) ? { platform } : {}),
    ...(Object.hasOwn(statuses, status) ? { status } : {}),
    ...(start && end ? { OR: [{ publishedAt: { gte: start, lt: end } },
      { publishedAt: null, scheduledAt: { gte: start, lt: end } },
      { publishedAt: null, scheduledAt: null, createdAt: { gte: start, lt: end } }] } : {}),
  }, orderBy: sort === "filename" ? [{ filename: "asc" }, { id: "asc" }] :
    sort === "oldest" ? [{ createdAt: "asc" }, { id: "asc" }] : [{ createdAt: "desc" }, { id: "desc" }], take: 101 });
  return <div className="overview">
    <header><h1 className="heading-4">History</h1><p className="body-6 muted">Publication records are kept even after local media is removed.</p></header>
    <Card className="overview-panel"><form className="plan-filters">
      <label className="clip-form-label title-4">Filename<input name="filename" className="clip-field body-6" defaultValue={filename} /></label>
      <label className="clip-form-label title-4">Account<input name="account" className="clip-field body-6" defaultValue={account} /></label>
      <label className="clip-form-label title-4">Platform<select name="platform" className="clip-field body-6" defaultValue={platform}>
        <option value="">All platforms</option>{platforms.map(item => <option key={item} value={item}>{platformName[item]}</option>)}</select></label>
      <label className="clip-form-label title-4">Date<input name="date" type="date" className="clip-field body-6" defaultValue={date} /></label>
      <label className="clip-form-label title-4">Status<select name="status" className="clip-field body-6" defaultValue={status}>
        <option value="">All statuses</option>{Object.entries(statuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="clip-form-label title-4">Sort<select name="sort" className="clip-field body-6" defaultValue={sort}>
        <option value="">Latest records</option><option value="oldest">Oldest records</option><option value="filename">Filename</option></select></label>
      <Button type="submit">Apply filters</Button>
    </form>{date && !start && <p className="caption-2 form-error" role="alert">Choose a valid date.</p>}</Card>
    <Card className="overview-panel plan-stack">
      {records.length ? <><ul className="plan-list">{records.slice(0, 100).map(record => <li className="plan-row" key={record.id}>
        <div><p className="title-4">{record.title || record.filename}</p><p className="caption-2 muted">{record.filename} · {record.accountName} · {platformName[record.platform as Platform] ?? record.platform}</p>
          {record.errorSummary && <p className="caption-2 form-error">{record.errorSummary}</p>}</div>
        <div><Status state={record.status}>{statuses[record.status as keyof typeof statuses] ?? record.status}</Status>
          <p className="caption-5 muted technical">{displayTime((record.publishedAt ?? record.scheduledAt ?? record.createdAt).toISOString(), timezone)}</p>
          <div className="plan-actions">{record.remoteUrl?.startsWith("https://") && <a className="workspace-link caption-5" href={record.remoteUrl} target="_blank" rel="noreferrer">View publication</a>}
            {record.status === "SUCCEEDED" && <Link className="workspace-link caption-5" href={`/templates?history=${record.id}`}>Save as template</Link>}</div></div>
      </li>)}</ul>{records.length > 100 && <p className="caption-2 muted">Showing the first 100 matching records. Narrow your filters to find more.</p>}</> :
        <EmptyState icon={<ClockCounterClockwiseIcon size={24} />} title={filename || account || platform || status || date ? "No matching publications" : "No publication history"}
          description="Verified publishes and other publication results will appear here." />}
    </Card>
  </div>;
}

export default function Page({ searchParams }: PageProps<"/history">) {
  return <Suspense fallback={<WorkspaceLoading />}><History searchParams={searchParams} /></Suspense>;
}
