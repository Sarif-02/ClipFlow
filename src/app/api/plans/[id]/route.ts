import { clipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { changePlan } from "@/lib/planning/drafts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try { verifyLocal(request, true); await changePlan((await params).id, await smallJson(request)); return new Response(null, { status: 204 }); }
  catch (error) { return clipError(error); }
}
