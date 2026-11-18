"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { planningRequest } from "@/components/planning/draft-actions";
import { combineReports, count, orderedDays, presets, type ChannelReport, type Range, type VideoStats } from "@/lib/analytics/model";
import { displayTime } from "@/lib/planning/model";
import { ReportChart } from "./charts";

const videoSort = { periodViews: "Views in period", lifetimeViews: "Lifetime views", published: "Publication date", likes: "Likes", comments: "Comments" } as const;
function imageUrl(value: string | undefined) {
  return value && /^https:\/\/(?:i\.ytimg\.com|yt3\.ggpht\.com|yt3\.googleusercontent\.com)\//.test(value) ? value : undefined;
}
function RemoteImage({ src }: { src?: string }) {
  const url = imageUrl(src);
  // Remote thumbnails are displayed directly and never archived by ClipFlow.
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img className="analytics-image" src={url} alt="" loading="lazy" referrerPolicy="no-referrer" /> : null;
}
const states = { disconnected: "Disconnected", unavailable: "Awaiting synchronization", current: "Current", stale: "Stale" };
export function AnalyticsDashboard({ reports, range, preset, start, end, selected, timezone }: {
  reports: ChannelReport[]; range: Range | null; preset: string; start: string; end: string; selected: string; timezone: string;
}) {
  const [mode, setMode] = useState(preset);
  const [sort, setSort] = useState<keyof typeof videoSort>("periodViews");
  const [page, setPage] = useState(0);
  const [subscriberSeries, setSubscriberSeries] = useState<"gained" | "lost">("gained");
  const [clearOpen, setClearOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState("");
  const [clearError, setClearError] = useState("");
  const router = useRouter();
  const shown = selected ? reports.filter(report => report.id === selected) : reports;
  const metrics = combineReports(shown, false);
  const single = shown.length === 1 ? shown[0] : null;
  const daily = new Map(single?.snapshot?.days.map(day => [day.day, day]));
  const days = range ? orderedDays(range) : [];
  const data = (key: "views" | "minutes") => days.map(day => ({ label: day, value: daily.get(day)?.[key] ?? null }));
  const videos: (VideoStats & { channel: string })[] = shown.flatMap(report => {
    const current = new Map(report.currentVideos?.map(video => [video.id, video]));
    const period = new Map(report.snapshot?.videos.map(video => [video.id, video]));
    return [...new Set([...period.keys(), ...current.keys()])].map(id => ({
      ...(current.get(id) ?? period.get(id)!), periodViews: period.get(id)?.periodViews ?? null,
      channel: report.currentChannel?.name ?? report.snapshot?.channel.name ?? report.name,
    })).sort((first, second) => sort === "published" ? second.published.localeCompare(first.published) : (second[sort] ?? -1) - (first[sort] ?? -1));
  });
  const sync = shown.flatMap(report => report.syncedAt ? [report.syncedAt] : []).sort().at(-1);
  const visiblePage = Math.min(page, Math.max(0, Math.ceil(videos.length / 50) - 1));
  const rows = (entries: [string, number | null, string?][]) => <dl className="analytics-stats">
    {entries.map(([label, value, special]) => <div key={label}><dt className="caption-2 muted">{label}</dt>
      <dd className="title-3 technical">{special ?? count(value)}</dd></div>)}</dl>;
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Analytics</h1>
      <p className="body-6 muted">Review YouTube channel and video performance.</p></div>
      <div className="plan-actions">
        {reports.some(report => report.syncedAt) && <Modal title="Clear analytics cache?" description="Saved YouTube reports will be removed from this computer."
          open={clearOpen} onOpenChange={setClearOpen} busy={clearing} trigger={<Button>Clear cached data</Button>}>
          {clearError && <p className="clip-dialog-body body-6 form-error" role="alert">{clearError}</p>}
          <footer className="clip-dialog-footer"><Button disabled={clearing} onClick={() => setClearOpen(false)}>Keep data</Button>
            <Button variant="primary" disabled={clearing} onClick={async () => {
              setClearing(true); setClearError("");
              try { await planningRequest("/api/analytics/cache", "DELETE"); setClearOpen(false); router.refresh(); }
              catch { setClearError("The cache could not be cleared. Try again."); }
              finally { setClearing(false); }
            }}>Clear cache</Button></footer>
        </Modal>}
        <Button disabled={refreshing || !range || !shown.some(report => report.state !== "disconnected")} aria-describedby="analytics-connection" onClick={async () => {
          setRefreshing(true); setRefreshStatus("");
          try {
            const result = await planningRequest("/api/analytics/refresh", "POST", { preset, start, end, channel: selected });
            const outcomes = result.results as { state: string }[];
            const complete = outcomes.filter(item => item.state === "synced").length;
            setRefreshStatus(outcomes.length ? `Synced ${complete} of ${outcomes.length} channels.${complete < outcomes.length ? " Check account permissions or quota for the other channels." : ""}` :
              "No channels have verified Analytics permission. Check Accounts.");
            router.refresh();
          } catch (problem) { setRefreshStatus(problem instanceof Error ? problem.message : "Refresh failed."); }
          finally { setRefreshing(false); }
        }}><ArrowsClockwiseIcon size={18} aria-hidden="true" /> {refreshing ? "Refreshing" : "Refresh"}</Button>
      </div></header>
    <p className="availability body-6" id="analytics-connection">{reports.some(report => report.state !== "disconnected") ? "Refresh retrieves provider reports for authorized channels." : "Connect a YouTube channel with Analytics permission to refresh."}
      {" "}Last successful sync: {sync ? displayTime(sync, timezone) : "Never"}.</p>
    {refreshStatus && <p role="status" className="body-6">{refreshStatus}</p>}
    <Card className="overview-panel plan-stack"><form className="plan-filters">
      <label className="clip-form-label title-4">Channel<select name="channel" className="clip-field body-6" defaultValue={selected}>
        <option value="">All channels</option>{reports.map(report => <option key={report.id} value={report.id}>{report.name}</option>)}</select></label>
      <label className="clip-form-label title-4">Date range<select name="range" className="clip-field body-6" value={mode} onChange={event => setMode(event.target.value)}>
        {presets.map(option => <option key={option} value={option}>{option === "custom" ? "Custom range" : `Last ${option} days`}</option>)}</select></label>
      {mode === "custom" && <>
        <label className="clip-form-label title-4">From<input required name="start" type="date" className="clip-field body-6" defaultValue={start} /></label>
        <label className="clip-form-label title-4">To<input required name="end" type="date" className="clip-field body-6" defaultValue={end} /></label>
      </>}
      <Button type="submit">Apply range</Button>
    </form>
      {range ? <p className="caption-5 muted technical">{range.start} to {range.end} · YouTube reporting dates in Pacific time</p> :
        <p className="body-6 form-error" role="alert">Choose an ordered range of up to 366 days ending before today in Pacific time.</p>}
      {shown.length > 1 && <p className="caption-2 muted">All channels shows a comparison. Select a channel to see its totals and daily series.</p>}
    </Card>
    <div className="report-grid">
      <Card className="overview-panel plan-stack"><h2 className="dashboard-section">Channel totals</h2>
        <p className="caption-2 muted">These figures do not change with the selected dates.</p>
        {rows([["Lifetime views", metrics.views], ["Video count", metrics.videos], ["Current subscribers", metrics.subscribers,
          (single?.currentChannel ?? single?.snapshot?.channel)?.hiddenSubscribers ? "Hidden" : undefined]])}
      </Card>
      <Card className="overview-panel plan-stack"><h2 className="dashboard-section">Selected period</h2>
        {rows([["Views", metrics.periodViews], ["Watch time", null, metrics.minutes === null ? undefined : `${count(metrics.minutes)} min`],
          ["Subscribers gained", metrics.gained], ["Subscribers lost", metrics.lost], ["Likes", metrics.likes],
          ["Comments", metrics.comments], ["Net subscriber growth", null]])}
        <p className="caption-5 muted">Net growth requires permission for a calculated YouTube metric.</p>
      </Card>
      <ReportChart title="Daily views" points={data("views")} />
      <ReportChart title="Views by channel" bars points={shown.map(report => ({ label: report.name + (report.state === "stale" ? " (stale)" : ""), value: report.snapshot?.totals?.views ?? null }))} />
      <ReportChart title="Subscriber growth" controls={<label className="clip-form-label title-4">Subscriber series
        <select className="clip-field body-6" value={subscriberSeries} onChange={event => setSubscriberSeries(event.target.value === "lost" ? "lost" : "gained")}>
          <option value="gained">Subscribers gained</option><option value="lost">Subscribers lost</option>
        </select></label>} points={days.map(day => ({ label: day, value: daily.get(day)?.[subscriberSeries] ?? null }))} />
      <ReportChart title="Watch time" points={data("minutes")} unit="min" />
    </div>
    <Card className="overview-panel plan-stack">
      <h2 className="dashboard-section">Channel comparison</h2>
      {!shown.length ? <p className="chart-empty body-6 muted">No YouTube channels are connected.</p> :
        <ul className="plan-list">{shown.map(report => <li className="plan-row" key={report.id}>
          <div className="plan-avatar"><RemoteImage src={report.currentChannel?.avatar ?? report.snapshot?.channel.avatar} /><div>
            <p className="title-4">{report.name}</p><p className="caption-5 muted">{states[report.state]} · {report.syncedAt ? displayTime(report.syncedAt, timezone) : "Never synced"}</p>
            {report.snapshot?.issues.map(issue => <p className="caption-5 muted" key={issue}>{issue}</p>)}
          </div></div>
          {rows([["Subscribers", (report.currentChannel ?? report.snapshot?.channel)?.subscribers ?? null,
            (report.currentChannel ?? report.snapshot?.channel)?.hiddenSubscribers ? "Hidden" : undefined],
            ["Videos", (report.currentChannel ?? report.snapshot?.channel)?.videos ?? null],
            ["Lifetime views", (report.currentChannel ?? report.snapshot?.channel)?.views ?? null],
            ["Period views", report.snapshot?.totals?.views ?? null]])}
        </li>)}</ul>}
    </Card>
    <Card className="overview-panel plan-stack">
      <div className="plan-row"><div><h2 className="dashboard-section">Top videos</h2>
        <p className="caption-2 muted">Performance can include any accessible video on a connected channel.</p></div>
        <label className="clip-form-label title-4">Sort videos
          <select className="clip-field body-6" value={sort} onChange={event => { setSort(event.target.value as keyof typeof videoSort); setPage(0); }}>
            {Object.entries(videoSort).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label></div>
      {!videos.length ? <p className="chart-empty body-6 muted">No video performance data to show.</p> :
        <><div className="report-table"><table className="body-6"><thead><tr>{["Video", "Channel", "Published", "Lifetime views", "Period views", "Likes", "Comments"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{videos.slice(visiblePage * 50, (visiblePage + 1) * 50).map(video => <tr key={video.channelId + ":" + video.id}>
            <td><div className="plan-avatar"><RemoteImage src={video.thumbnail} /><a className="workspace-link" href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.id)}`} target="_blank" rel="noreferrer">{video.title}</a></div></td>
            <td>{video.channel}</td><td>{video.published.slice(0, 10) || "Unavailable"}</td>
            {[video.lifetimeViews, video.periodViews, video.likes, video.comments].map((value, index) => <td key={index} className="technical">{count(value)}</td>)}
          </tr>)}</tbody></table></div>
        {videos.length > 50 && <div className="plan-actions"><Button disabled={visiblePage === 0} onClick={() => setPage(visiblePage - 1)}>Previous videos</Button>
          <p className="caption-5 muted">{visiblePage * 50 + 1} to {Math.min(videos.length, (visiblePage + 1) * 50)} of {videos.length}</p>
          <Button disabled={(visiblePage + 1) * 50 >= videos.length} onClick={() => setPage(visiblePage + 1)}>Next videos</Button></div>}</>}
    </Card>
  </div>;
}
