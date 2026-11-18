import { connection, NextResponse, type NextRequest } from "next/server";
import { verifyLocal } from "@/lib/clips/http";
import { applicationOrigin } from "@/lib/integrations/config";
import { bindingCookie, consumeOAuth, finishOAuth } from "@/lib/integrations/oauth";
import { ProviderError } from "@/lib/integrations/network";

export async function GET(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  await connection();
  const provider = (await params).provider.toUpperCase();
  if (provider !== "YOUTUBE" && provider !== "INSTAGRAM") return new Response(null, { status: 404 });
  let status = "connected";
  try {
    verifyLocal(request);
    const query = request.nextUrl.searchParams;
    const state = await consumeOAuth(provider, query.get("state") ?? "", request.cookies.get(bindingCookie)?.value ?? "");
    const code = query.get("code");
    if (query.has("error") || !code || code.length > 2048) status = "denied";
    else await finishOAuth(provider, state, code);
  } catch (error) {
    status = error instanceof ProviderError ? (error.reason === "API_DISABLED" ? "api" : error.kind === "quota" ? "quota" :
      error.kind === "temporary" ? "network" : error.reason === "INVALID_CREDENTIALS" ? "credentials" :
      error.reason === "PERMISSIONS" ? "permissions" : "provider") : "session";
  }
  const response = NextResponse.redirect(`${applicationOrigin()}/accounts?oauth=${status}`, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  response.cookies.set(bindingCookie, "", { httpOnly: true, sameSite: "lax", path: "/api/oauth", maxAge: 0 });
  return response;
}
