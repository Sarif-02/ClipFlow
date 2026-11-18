import { clipError, ClipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { validateIds } from "@/lib/clips/storage";
import { cleanupVerifiedMedia } from "@/lib/planning/retention";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    const input = await smallJson(request) as { confirm?: boolean; ids?: unknown } | null;
    if (input?.confirm !== true) throw new ClipError(400, "Confirm the cleanup selection.");
    const ids = validateIds(input.ids);
    let removed = 0, failed = 0;
    for (const id of ids) {
      try { if (await cleanupVerifiedMedia(id, new Date(), true)) removed++; }
      catch { failed++; }
    }
    return Response.json({ removed, failed, skipped: ids.length - removed - failed }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
