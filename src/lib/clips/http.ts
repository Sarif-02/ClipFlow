import { maxUploadBytes } from "@/lib/local-config";

export class ClipError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export function verifyLocal(request: Request, mutation = false) {
  const host = request.headers.get("host")?.toLowerCase();
  const origin = request.headers.get("origin");
  if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host) ||
      (origin !== null && origin !== `http://${host}`) ||
      (mutation && (origin === null || request.headers.get("sec-fetch-site") === "cross-site"))) {
    throw new ClipError(403, "This request must come from your local ClipFlow workspace.");
  }
}

export function clipError(error: unknown) {
  if (error instanceof ClipError) return Response.json({ error: error.message }, { status: error.status });
  console.error("Clip operation failed", error instanceof Error ? error.name : "Unknown error");
  return Response.json({ error: "ClipFlow could not complete the operation. Check local storage and try again." }, { status: 500 });
}

export function validateUpload(request: Request, maximum = maxUploadBytes()) {
  if (request.headers.get("content-type") !== "video/mp4" || !request.body) {
    throw new ClipError(415, "Choose an MP4 video.");
  }
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) === 0)) throw new ClipError(400, "The upload is empty or invalid.");
  if (length !== null && Number(length) > maximum) throw new ClipError(413, "This video exceeds the upload limit.");
}

export async function smallJson(request: Request, limit = 8192): Promise<unknown> {
  if (request.headers.get("content-type") !== "application/json" || !request.body) throw new ClipError(415, "Expected JSON.");
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let size = 0;
  let json = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new ClipError(413, "The request is too large.");
      json += decoder.decode(value, { stream: true });
    }
    return JSON.parse(json + decoder.decode());
  } catch (error) {
    if (error instanceof ClipError) throw error;
    throw new ClipError(400, "The request is not valid JSON.");
  } finally { void reader.cancel().catch(() => {}); }
}
