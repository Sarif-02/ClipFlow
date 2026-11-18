import { Readable } from "node:stream";
import { ClipError, clipError, verifyLocal } from "@/lib/clips/http";
import { openMedia } from "@/lib/clips/storage";

type Context = { params: Promise<{ id: string }> };

function readRange(value: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  const start = match[1] ? first : Math.max(0, size - last);
  const end = match[1] && match[2] ? Math.min(last, size - 1) : size - 1;
  return start <= end && start < size ? { start, end } : null;
}

async function send(request: Request, { params }: Context) {
  let file: Awaited<ReturnType<typeof openMedia>> | undefined;
  try {
    verifyLocal(request);
    const kind = new URL(request.url).searchParams.get("kind") ?? "video";
    if (kind !== "video" && kind !== "thumbnail" && kind !== "download") throw new ClipError(404, "Media not found.");
    file = await openMedia((await params).id, kind === "thumbnail" ? "thumbnail" : "video");
    const { handle, size, name } = file;
    const headers = new Headers({
      "Content-Type": kind === "thumbnail" ? "image/jpeg" : "video/mp4",
      "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache, no-transform",
      "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin",
    });
    if (kind === "download") {
      const encoded = encodeURIComponent(name).replace(/[!'()*]/g, value => "%" + value.charCodeAt(0).toString(16));
      headers.set("Content-Disposition", `attachment; filename="clip.mp4"; filename*=UTF-8''${encoded}`);
    }
    const requestedRange = request.headers.get("range");
    const range = requestedRange ? readRange(requestedRange, size) : null;
    if (requestedRange && !range) {
      await handle.close();
      headers.set("Content-Range", `bytes */${size}`);
      return new Response(null, { status: 416, headers });
    }
    const { start, end } = range ?? { start: 0, end: size - 1 };
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    headers.set("Content-Length", String(end - start + 1));
    if (request.method === "HEAD") await handle.close();
    const body = request.method === "HEAD" ? null : Readable.toWeb(
      handle.createReadStream({ start, end, signal: request.signal }),
      { strategy: { highWaterMark: 64 * 1024, size: (chunk: Buffer) => chunk.byteLength } },
    );
    const response = new Response(body as unknown as BodyInit | null, { status: range ? 206 : 200, headers });
    file = undefined;
    return response;
  } catch (error) {
    await file?.handle.close().catch(() => {});
    return clipError(error);
  }
}

export function GET(request: Request, context: Context) { return send(request, context); }
export function HEAD(request: Request, context: Context) { return send(request, context); }
