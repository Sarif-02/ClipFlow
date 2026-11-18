import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { copyDraft, removeDraft, saveDraft } from "@/lib/planning/drafts";
type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try { verifyLocal(request, true); return Response.json(await saveDraft(await smallJson(request, 8 * 1024 * 1024), (await params).id)); }
  catch (error) { return clipError(error); }
}
export async function POST(request: Request, { params }: Context) {
  try { verifyLocal(request, true); return Response.json(await copyDraft((await params).id), { status: 201 }); }
  catch (error) { return clipError(error); }
}
export async function DELETE(request: Request, { params }: Context) {
  try { verifyLocal(request, true); await removeDraft((await params).id); return new Response(null, { status: 204 }); }
  catch (error) { return clipError(error); }
}
