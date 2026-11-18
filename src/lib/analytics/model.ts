export const presets = ["7", "28", "30", "90", "custom"] as const;
export type Range = { start: string; end: string };
export type Daily = { day: string; views: number | null; minutes: number | null; gained: number | null; lost: number | null };
export type Totals = Omit<Daily, "day"> & { likes?: number | null; comments?: number | null };
export type ChannelStats = { id: string; name: string; avatar?: string; uploads?: string;
  views: number | null; videos: number | null; subscribers: number | null; hiddenSubscribers: boolean };
export type VideoStats = { id: string; channelId: string; title: string; thumbnail?: string; published: string;
  lifetimeViews: number | null; periodViews: number | null; likes: number | null; comments: number | null };
export type Snapshot = {
  channel: ChannelStats; totals: Totals | null; days: Daily[]; videos: VideoStats[];
  issues: string[];
};
export type ChannelReport = {
  id: string; name: string; state: "disconnected" | "unavailable" | "current" | "stale";
  syncedAt: string | null; snapshot: Snapshot | null; currentChannel?: ChannelStats; currentVideos?: VideoStats[];
};
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dayMs = 86400000;
const pacific = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" });
export const reportingToday = (now = new Date()) => pacific.format(now);
export function validDay(value: string) {
  return datePattern.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export const shiftDay = (value: string, days: number) => new Date(Date.parse(value) + days * dayMs).toISOString().slice(0, 10);
export function reportingRange(preset: string, start: string, end: string, now = new Date()): Range | null {
  const last = shiftDay(reportingToday(now), -1);
  if (preset === "custom") return validDay(start) && validDay(end) && start >= "2005-02-14" && start <= end && end <= last &&
    Date.parse(end) - Date.parse(start) <= 365 * dayMs ? { start, end } : null;
  if (!presets.includes(preset as typeof presets[number])) return null;
  return { start: shiftDay(last, 1 - Number(preset)), end: last };
}
export function orderedDays(range: Range) {
  return Array.from({ length: Math.round((Date.parse(range.end) - Date.parse(range.start)) / dayMs) + 1 },
    (_, index) => shiftDay(range.start, index));
}
export function sumAvailable(values: (number | null | undefined)[]) {
  return values.length && values.every(value => value != null) ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
}
export function combineReports(reports: ChannelReport[], allowPooled: boolean) {
  // Authorization for one channel does not allow pooling it with other owners.
  const eligible = reports.length === 1 || allowPooled;
  const sum = (read: (snapshot: Snapshot) => number | null | undefined) =>
    eligible ? sumAvailable(reports.map(report => report.snapshot ? read(report.snapshot) : null)) : null;
  const lifetime = (metric: "views" | "videos" | "subscribers") =>
    eligible ? sumAvailable(reports.map(report => (report.currentChannel ?? report.snapshot?.channel)?.[metric])) : null;
  return { views: lifetime("views"), videos: lifetime("videos"),
    subscribers: lifetime("subscribers"), periodViews: sum(data => data.totals?.views),
    minutes: sum(data => data.totals?.minutes), gained: sum(data => data.totals?.gained), lost: sum(data => data.totals?.lost),
    likes: sum(data => data.totals?.likes), comments: sum(data => data.totals?.comments) };
}
export function count(value: number | null) { return value === null ? "Unavailable" : new Intl.NumberFormat("en").format(value); }
