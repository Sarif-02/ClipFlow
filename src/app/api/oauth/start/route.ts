import { clipError, ClipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { NextResponse } from "next/server";
import { applicationOrigin } from "@/lib/integrations/config";
import { beginOAuth, bindingCookie, newBrowserBinding } from "@/lib/integrations/oauth";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    if (request.headers.get("origin") !== applicationOrigin()) throw new ClipError(400, `Open ClipFlow at ${applicationOrigin()} before connecting accounts.`);
    const input = await smallJson(request) as { provider?: unknown; accountId?: unknown } | null;
    if (input?.provider !== "YOUTUBE" && input?.provider !== "INSTAGRAM") throw new ClipError(400, "Unknown provider.");
    const browser = newBrowserBinding();
    const url = await beginOAuth(input.provider, browser, typeof input.accountId === "string" ? input.accountId : undefined);
    const response = NextResponse.json({ url }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(bindingCookie, browser, { httpOnly: true, sameSite: "lax", path: "/api/oauth", maxAge: 600, secure: false });
    return response;
  } catch (error) { return clipError(error); }
}
