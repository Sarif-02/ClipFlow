import { clipError, ClipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { isProvider, writeConfig, saveRuntime } from "@/lib/integrations/config";
import { validateIntegration } from "@/lib/integrations/validation";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    const input = await smallJson(request) as Record<string, unknown> | null;
    if (!input) throw new ClipError(400, "Expected configuration.");
    if (input.provider === "LOCAL") { await saveRuntime(input); return Response.json({}); }
    if (!isProvider(input.provider)) throw new ClipError(400, "Unknown provider.");
    if (input.test === true) return Response.json(await validateIntegration(input.provider, input), { headers: { "Cache-Control": "no-store" } });
    await writeConfig(input.provider, input);
    return Response.json({}, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
