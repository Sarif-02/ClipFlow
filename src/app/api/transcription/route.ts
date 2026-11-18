import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { transcribeClip } from "@/lib/integrations/assemblyai";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    return Response.json(await transcribeClip(await smallJson(request), request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
