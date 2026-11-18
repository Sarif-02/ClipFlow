import { db } from "@/lib/clips/db";
import type { Prisma } from "@/generated/prisma/client";
import type { ChannelReport, Range, Snapshot } from "./model";
import { collectChannel, YouTubeReportError, type YouTubeAnalyticsProvider } from "./youtube";
import { ProviderError } from "@/lib/integrations/network";

const hardDays = 30 * 86400000;
const key = (range: Range) => `youtube:${range.start}:${range.end}`;
function cacheHours() {
  const hours = Number(process.env.YOUTUBE_ANALYTICS_CACHE_HOURS || 24);
  return Number.isFinite(hours) && hours >= 1 && hours <= 720 ? hours : 24;
}

export async function clearAnalytics(accountId?: string) {
  await db().analyticsCache.deleteMany({ where: accountId ? { accountId } : {} });
}

export async function expireAnalytics(now = new Date()) {
  await db().analyticsCache.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { syncedAt: { lte: new Date(+now - hardDays) } },
    { account: { status: { not: "CONNECTED" } } }] } });
}

export async function cachedReports(range: Range | null, now = new Date()): Promise<ChannelReport[]> {
  await expireAnalytics(now);
  const accounts = await db().socialAccount.findMany({ where: { platform: "YOUTUBE" }, orderBy: { name: "asc" },
    include: { analytics: { where: { expiresAt: { gt: now } }, orderBy: [{ syncedAt: "desc" }, { key: "asc" }], take: 8 } } });
  return accounts.map(account => {
    const latest = account.analytics[0];
    const result = range ? account.analytics.find(item => item.key === key(range)) : undefined;
    const current = account.status === "CONNECTED" && latest ? latest.data as unknown as Snapshot : null;
    return { id: account.id, name: account.name, syncedAt: latest?.syncedAt.toISOString() ?? null,
      state: account.status !== "CONNECTED" ? "disconnected" : !result ? "unavailable" :
        +now - +result.syncedAt > cacheHours() * 1800000 ? "stale" : "current",
      snapshot: account.status === "CONNECTED" && result ? result.data as unknown as Snapshot : null,
      currentChannel: current?.channel, currentVideos: current?.videos.map(video => ({ ...video, periodViews: null })) };
  });
}

export async function refreshAnalytics(range: Range, providerFor: (accountId: string) => Promise<YouTubeAnalyticsProvider>, channelIds?: string[],
  options: { pageBudget?: number; signal?: AbortSignal } = {}) {
  const now = new Date();
  await expireAnalytics(now);
  const accounts = await db().socialAccount.findMany({ where: { platform: "YOUTUBE", status: "CONNECTED", canAnalyze: true,
    ...(channelIds ? { id: { in: channelIds } } : {}) }, orderBy: { id: "asc" }, take: 20 });
  const results: { id: string; state: "synced" | "quota" | "authorization" | "provider" }[] = [];
  let quota = false;
  for (const account of accounts) {
    if (options.signal?.aborted) break;
    if (quota) { results.push({ id: account.id, state: "quota" }); continue; }
    try {
      const snapshot = await collectChannel(await providerFor(account.id), account.remoteId, range, options.pageBudget);
      if (options.signal?.aborted) break;
      const syncedAt = new Date();
      const data = { accountId: account.id, key: key(range), data: JSON.parse(JSON.stringify(snapshot)) as Prisma.InputJsonValue,
        syncedAt, expiresAt: new Date(+syncedAt + cacheHours() * 3600000) };
      await db().$transaction(async tx => {
        if (!(await tx.socialAccount.count({ where: { id: account.id, status: "CONNECTED" } }))) {
          throw new YouTubeReportError("authorization");
        }
        await tx.socialAccount.update({ where: { id: account.id }, data: { lastApiAt: syncedAt } });
        await tx.analyticsCache.upsert({ where: { accountId_key: { accountId: account.id, key: data.key } }, create: data, update: data });
        const old = await tx.analyticsCache.findMany({ where: { accountId: account.id }, orderBy: [{ syncedAt: "desc" }, { key: "asc" }],
          select: { key: true }, skip: 8 });
        await tx.analyticsCache.deleteMany({ where: { accountId: account.id, key: { in: old.map(item => item.key) } } });
      });
      results.push({ id: account.id, state: "synced" });
    } catch (error) {
      const state = error instanceof YouTubeReportError ? error.kind :
        error instanceof ProviderError && (error.kind === "authorization" || error.kind === "quota") ? error.kind : "provider";
      if (state === "authorization") await clearAnalytics(account.id);
      if (state === "quota") quota = true;
      results.push({ id: account.id, state });
    }
  }
  return results;
}
