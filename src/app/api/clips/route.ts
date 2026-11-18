import { clipError, smallJson, validateUpload, verifyLocal } from "@/lib/clips/http";
import { deleteClips, importClip, validateIds } from "@/lib/clips/storage";
import { runtimeSettings } from "@/lib/integrations/config";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    const limit = (await runtimeSettings()).uploadMib * 1048576;
    validateUpload(request, limit);
    const clip = await importClip(request, limit);
    return Response.json(clip, { status: clip.reused ? 200 : 201 });
  } catch (error) { return clipError(error); }
}

export async function DELETE(request: Request) {
  try {
    verifyLocal(request, true);
    const body = await smallJson(request) as { ids?: unknown } | null;
    await deleteClips(validateIds(body?.ids));
    return new Response(null, { status: 204 });
  } catch (error) { return clipError(error); }
}
