import { clipError, verifyLocal } from "@/lib/clips/http";
import { clearAnalytics } from "@/lib/analytics/cache";

export async function DELETE(request: Request) {
  try {
    verifyLocal(request, true);
    await clearAnalytics();
    return new Response(null, { status: 204 });
  } catch (error) { return clipError(error); }
}
