import { db } from "@/lib/clips/db";
import { accountToken } from "@/lib/integrations/oauth";
import { refreshAnalytics } from "./cache";
import { reportingRange } from "./model";
import { youtubeProvider } from "./youtube";

export async function refreshAutomaticAnalytics(hours: number, now: Date, signal: AbortSignal) {
  if (!hours || signal.aborted) return;
  const range = reportingRange("28", "", "", now)!;
  const key = "analytics:auto";
  const threshold = new Date(+now - hours * 3600000);
  const accounts = await db().$transaction(async tx => {
    const setting = await tx.appSetting.findUnique({ where: { key } });
    if (setting && +setting.updatedAt > +threshold) return [];
    const ids = await tx.socialAccount.findMany({ where: { platform: "YOUTUBE", status: "CONNECTED", canAnalyze: true,
      analytics: { none: { key: `youtube:${range.start}:${range.end}`, syncedAt: { gte: threshold }, expiresAt: { gt: now } } } },
      select: { id: true }, take: 12, orderBy: { id: "asc" } });
    if (ids.length) await tx.appSetting.upsert({ where: { key }, create: { key, value: {}, updatedAt: now }, update: { updatedAt: now } });
    return ids.map(account => account.id);
  });
  if (accounts.length) await refreshAnalytics(range, async id => {
    const token = await accountToken(id);
    return youtubeProvider(async () => token, fetch, signal);
  }, accounts, { pageBudget: 8, signal });
}
