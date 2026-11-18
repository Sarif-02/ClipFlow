import { NextResponse, type NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(request.headers.get("host") ?? "")) {
    return new Response("ClipFlow is available only on this computer.", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const response = NextResponse.next();
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Cross-Origin-Resource-Policy", "same-origin");
  if (request.nextUrl.pathname === "/integrations" || request.nextUrl.pathname === "/accounts") {
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
}

// API routes validate Host and Origin themselves; keeping uploads out preserves streaming.
export const config = { matcher: ["/((?!api/|_next/).*)"] };
