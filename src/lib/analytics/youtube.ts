import type { ChannelStats, Daily, Range, Snapshot, Totals, VideoStats } from "./model";

export const youtubeReadScopes = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
] as const;
export interface YouTubeAnalyticsProvider {
  channel(channelId: string): Promise<ChannelStats>;
  uploads(playlistId: string): AsyncIterable<string[]>;
  videos(ids: string[]): Promise<VideoStats[]>;
  daily(channelId: string, range: Range): Promise<Daily[]>;
  totals(channelId: string, range: Range): Promise<Totals | null>;
  topVideos(channelId: string, range: Range): Promise<Map<string, number | null>>;
}

type DataItem = { id: string; snippet?: { title?: string; publishedAt?: string; channelId?: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string } } };
  statistics?: { viewCount?: string; videoCount?: string; subscriberCount?: string; hiddenSubscriberCount?: boolean; likeCount?: string; commentCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string }; videoId?: string } };
type DataList = { items?: DataItem[]; nextPageToken?: string };
type Report = { columnHeaders?: { name: string }[]; rows?: (string | number | null)[][] };
const metrics = "views,estimatedMinutesWatched,subscribersGained,subscribersLost";
const numeric = (value: unknown) => (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value))) &&
  Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

export class YouTubeReportError extends Error {
  readonly kind: "quota" | "authorization" | "provider";
  constructor(kind: YouTubeReportError["kind"]) { super(kind); this.kind = kind; }
}

export function youtubeProvider(accessToken: () => Promise<string>, transport = fetch, parent?: AbortSignal): YouTubeAnalyticsProvider {
  async function request<T>(base: string, path: string, values: Record<string, string>): Promise<T> {
    const timeout = AbortSignal.timeout(20000);
    const response = await transport(`${base}/${path}?${new URLSearchParams(values)}`, {
      headers: { Authorization: `Bearer ${await accessToken()}` }, cache: "no-store", redirect: "error", signal: parent ? AbortSignal.any([parent, timeout]) : timeout,
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null) as { error?: { errors?: { reason: string }[] } } | null;
      const quota = response.status === 429 || body?.error?.errors?.some(item => /quota|limit/i.test(item.reason));
      throw new YouTubeReportError(quota ? "quota" : [401, 403].includes(response.status) ? "authorization" : "provider");
    }
    return response.json();
  }
  const data = (endpoint: string, query: Record<string, string>) => request<DataList>("https://www.googleapis.com/youtube/v3", endpoint, query);
  async function report(channelId: string, range: Range, values: Record<string, string>) {
    const output = await request<Report>("https://youtubeanalytics.googleapis.com/v2", "reports", {
      ids: `channel==${channelId}`, startDate: range.start, endDate: range.end, ...values,
    });
    return (output.rows ?? []).map(row => Object.fromEntries((output.columnHeaders ?? []).map((head, index) => [head.name, row[index]])));
  }
  const totals = (row: Record<string, unknown>): Totals => ({ views: numeric(row.views), minutes: numeric(row.estimatedMinutesWatched),
    gained: numeric(row.subscribersGained), lost: numeric(row.subscribersLost) });
  return {
    async channel(channelId) {
      const { items } = await data("channels", { part: "snippet,statistics,contentDetails", id: channelId });
      const channel = items?.find(item => item.id === channelId);
      if (!channel) throw new YouTubeReportError("authorization");
      const stats = channel.statistics;
      return { id: channel.id, name: channel.snippet?.title ?? channel.id, avatar: channel.snippet?.thumbnails?.default?.url,
        uploads: channel.contentDetails?.relatedPlaylists?.uploads, views: numeric(stats?.viewCount), videos: numeric(stats?.videoCount),
        subscribers: stats?.hiddenSubscriberCount ? null : numeric(stats?.subscriberCount), hiddenSubscribers: stats?.hiddenSubscriberCount === true };
    },
    async *uploads(playlistId) {
      let pageToken = "";
      const seen = new Set<string>();
      do {
        const result = await data("playlistItems", { part: "contentDetails", playlistId, maxResults: "50", ...(pageToken ? { pageToken } : {}) });
        yield (result.items ?? []).flatMap(item => item.contentDetails?.videoId ? [item.contentDetails.videoId] : []);
        pageToken = result.nextPageToken ?? "";
        if (seen.has(pageToken)) throw new YouTubeReportError("provider");
        seen.add(pageToken);
      } while (pageToken);
    },
    async videos(ids) {
      const result: VideoStats[] = [];
      for (let start = 0; start < ids.length; start += 50) {
        const { items } = await data("videos", { part: "snippet,statistics", id: ids.slice(start, start + 50).join(",") });
        result.push(...(items ?? []).map(item => ({ id: item.id, channelId: item.snippet?.channelId ?? "",
          title: item.snippet?.title ?? item.id, thumbnail: item.snippet?.thumbnails?.medium?.url, published: item.snippet?.publishedAt ?? "",
          lifetimeViews: numeric(item.statistics?.viewCount), periodViews: null, likes: numeric(item.statistics?.likeCount),
          comments: numeric(item.statistics?.commentCount) })));
      }
      return result;
    },
    async daily(id, range) {
      return (await report(id, range, { dimensions: "day", metrics, sort: "day" }))
        .flatMap(row => typeof row.day === "string" ? [{ day: row.day, ...totals(row) }] : []);
    },
    async totals(id, range) {
      const [row] = await report(id, range, { metrics: `${metrics},likes,comments` });
      return row ? { ...totals(row), likes: numeric(row.likes), comments: numeric(row.comments) } : null;
    },
    async topVideos(id, range) {
      const rows = await report(id, range, { dimensions: "video", metrics: "views", sort: "-views", maxResults: "200" });
      return new Map(rows.flatMap(row => typeof row.video === "string" ? [[row.video, numeric(row.views)] as const] : []));
    },
  };
}

export async function collectChannel(provider: YouTubeAnalyticsProvider, channelId: string, range: Range, pageBudget = Number.POSITIVE_INFINITY): Promise<Snapshot> {
  const channel = await provider.channel(channelId);
  const issues: string[] = [];
  async function section<T>(name: string, request: () => Promise<T>, fallback: T) {
    try { return await request(); }
    catch (error) {
      if (error instanceof YouTubeReportError && ["quota", "authorization"].includes(error.kind)) throw error;
      issues.push(name);
      return fallback;
    }
  }
  // Sequential sections stop at the first quota or authorization failure.
  const totals = await section("Period totals unavailable", () => provider.totals(channelId, range), null);
  const days = await section("Daily reports unavailable", () => provider.daily(channelId, range), []);
  const top = await section("Period video views unavailable", () => provider.topVideos(channelId, range), new Map<string, number | null>());
  const videos = await section("Video list unavailable", async () => {
    const ids = new Set(top.keys());
    let pages = 0;
    if (channel.uploads && pageBudget > 0) for await (const batch of provider.uploads(channel.uploads)) {
      batch.forEach(id => ids.add(id));
      if (++pages >= pageBudget) {
        if (channel.videos === null || ids.size < channel.videos) issues.push("Upload scan limited to the current request budget");
        break;
      }
    }
    // The cache keeps only ranked metadata. No YouTube media is downloaded.
    return (await provider.videos([...ids])).filter(video => video.channelId === channelId)
      .map(video => ({ ...video, periodViews: top.get(video.id) ?? null }))
      .sort((first, second) => (second.periodViews ?? -1) - (first.periodViews ?? -1) ||
        (second.lifetimeViews ?? -1) - (first.lifetimeViews ?? -1));
  }, []);
  return { channel, totals, days, videos, issues };
}
