import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { changeTemplate } from "@/lib/planning/template-store";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    return Response.json(await changeTemplate(await smallJson(request, 65536)), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
