import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { saveDraft } from "@/lib/planning/drafts";

export async function POST(request: Request) {
  try { verifyLocal(request, true); return Response.json(await saveDraft(await smallJson(request, 8 * 1024 * 1024)), { status: 201 }); }
  catch (error) { return clipError(error); }
}
