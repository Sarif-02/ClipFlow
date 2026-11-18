import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { generateSuggestion } from "@/lib/integrations/gemini";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    return Response.json(await generateSuggestion(await smallJson(request, 128 * 1024), request.signal), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
