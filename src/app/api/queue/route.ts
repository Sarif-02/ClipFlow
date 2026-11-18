import { clipError, ClipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { queueDraft, changeJob } from "@/lib/publishing/queue";
import { updateRuntime } from "@/lib/integrations/config";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    const input = await smallJson(request) as { draftId?: unknown; key?: unknown; revision?: unknown; removeAfterPublish?: unknown;
      action?: string; ids?: unknown; utc?: unknown } | null;
    if (!input) throw new ClipError(400, "Invalid queue request.");
    if (typeof input.draftId === "string") return Response.json(await queueDraft(input.draftId, input));
    if (input.action === "pause" || input.action === "resume") { await updateRuntime({ paused: input.action === "pause" }); return Response.json({}); }
    if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 50 || input.ids.some(id => typeof id !== "string")) throw new ClipError(400, "Select up to 50 jobs.");
    const results = [];
    for (const id of new Set<string>(input.ids)) {
      try { await changeJob(id, input); results.push({ id, ok: true }); }
      catch (error) { if (!(error instanceof ClipError)) throw error; results.push({ id, ok: false, error: error.message }); }
    }
    return Response.json({ results });
  } catch (error) { return clipError(error); }
}
