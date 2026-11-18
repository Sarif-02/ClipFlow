import { clipError, ClipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { refreshAnalytics } from "@/lib/analytics/cache";
import { reportingRange } from "@/lib/analytics/model";
import { youtubeProvider } from "@/lib/analytics/youtube";
import { accountToken } from "@/lib/integrations/oauth";
import { validId } from "@/lib/planning/drafts";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    const data = await smallJson(request) as { preset?: string; start?: string; end?: string; channel?: string } | null;
    const range = data && reportingRange(String(data.preset), String(data.start ?? ""), String(data.end ?? ""));
    if (!range) throw new ClipError(400, "Choose a valid reporting range.");
    const ids = validId(data?.channel) ? [data.channel] : undefined;
    return Response.json({ results: await refreshAnalytics(range, async id => {
      const token = await accountToken(id);
      return youtubeProvider(async () => token, fetch, request.signal);
    }, ids, { signal: request.signal }) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
