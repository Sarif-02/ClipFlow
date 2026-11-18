import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { analyseClip, renameClip } from "@/lib/clips/storage";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    verifyLocal(request, true);
    const body = await smallJson(request) as { name?: unknown } | null;
    await renameClip((await params).id, body?.name);
    return new Response(null, { status: 204 });
  } catch (error) { return clipError(error); }
}

export async function POST(request: Request, { params }: Context) {
  try {
    verifyLocal(request, true);
    await analyseClip((await params).id);
    return new Response(null, { status: 204 });
  } catch (error) { return clipError(error); }
}
