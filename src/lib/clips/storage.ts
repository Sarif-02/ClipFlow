import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, rename, stat, unlink } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { inPublicDirectory, maxUploadBytes, storageRoot } from "@/lib/local-config";
import { ClipError } from "./http";
import { db } from "./db";
import { makeThumbnail, probeVideo, verifyMp4 } from "./media";
import type { ClipInfo } from "./types";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const live = { notIn: ["IMPORTING", "DELETING", "PURGING", "MEDIA_REMOVED"] };
const filename = (id: string, kind: "video" | "thumbnail") => kind === "video" ? `${id}.mp4` : `${id}.jpg`;
const folder = (kind: "video" | "thumbnail") => kind === "video" ? "videos" : "thumbnails";
const mediaRelative = (id: string, kind: "video" | "thumbnail") => `${folder(kind)}/${filename(id, kind)}`;
const staleMs = 24 * 60 * 60 * 1000;
let recovered: Promise<void> | undefined;
let recoveredAt = 0;
let activeUploads = 0;

type Row = NonNullable<Awaited<ReturnType<ReturnType<typeof db>["clip"]["findFirst"]>>>;
function view(row: Row): ClipInfo {
  return { id: row.id, originalFilename: row.originalFilename, displayName: row.displayName, mimeType: row.mimeType,
    size: row.size, duration: row.duration, width: row.width, height: row.height, codec: row.codec,
    aspectRatio: row.aspectRatio, audioCodec: row.audioCodec, audioChannels: row.audioChannels,
    source: row.source, status: row.status, createdAt: row.createdAt.toISOString(), hasThumbnail: Boolean(row.thumbnailPath) };
}

async function directory(name: "videos" | "thumbnails" | "temp") {
  const root = storageRoot();
  await mkdir(root, { recursive: true });
  const base = await realpath(root);
  if (inPublicDirectory(base)) throw new ClipError(500, "Media must not be stored inside public.");
  const path = join(base, name);
  await mkdir(path, { recursive: true });
  if ((await lstat(path)).isSymbolicLink() || relative(base, await realpath(path)) !== name) {
    throw new ClipError(500, "A media directory is not safe to use. Check the storage configuration.");
  }
  return path;
}

function assertId(id: string) {
  if (!uuid.test(id)) throw new ClipError(404, "Clip not found.");
}

async function existing(id: string) {
  assertId(id);
  const row = await db().clip.findFirst({ where: { id, status: live } });
  if (!row) throw new ClipError(404, "Clip not found.");
  return row;
}

async function checkedMedia(id: string, kind: "video" | "thumbnail") {
  assertId(id);
  const base = await directory(folder(kind));
  const name = filename(id, kind);
  const path = join(base, name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1) throw new ClipError(404, "Media not found.");
  const actual = await realpath(path);
  const fromBase = relative(base, actual);
  if (isAbsolute(fromBase) || fromBase !== name) throw new ClipError(404, "Media not found.");
  return { path, info };
}

async function remove(path: string) {
  try { await unlink(path); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
}

async function purge(id: string) {
  assertId(id);
  for (const kind of ["video", "thumbnail"] as const) {
    await remove(join(await directory(folder(kind)), filename(id, kind)));
  }
  await db().clip.deleteMany({ where: { id, status: "DELETING" } });
}

export async function hasClipMedia(id: string) {
  try { const file = await openMedia(id, "video"); await file.handle.close(); return true; }
  catch { return false; }
}

export async function finishRetainedMediaRemoval(id: string) {
  const row = await db().clip.findFirst({ where: { id, status: "PURGING" } });
  if (!row) return false;
  assertId(id);
  if (row.storagePath !== mediaRelative(id, "video") ||
      (row.thumbnailPath !== null && row.thumbnailPath !== mediaRelative(id, "thumbnail"))) {
    throw new ClipError(409, "Stored media paths do not match this clip.");
  }
  for (const kind of ["video", "thumbnail"] as const) {
    if (kind === "thumbnail" && !row.thumbnailPath) continue;
    try { await remove((await checkedMedia(id, kind)).path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  return (await db().clip.updateMany({ where: { id, status: "PURGING" },
    data: { status: "MEDIA_REMOVED", activeChecksum: null, thumbnailPath: null, mediaRemovedAt: new Date() } })).count === 1;
}

async function recover() {
  const base = await directory("temp");
  for (const entry of await readdir(base, { withFileTypes: true })) {
    const [id, suffix, extra] = entry.name.split(".");
    if (!entry.isFile() || !uuid.test(id) || extra !== undefined || !["part", "jpg"].includes(suffix)) continue;
    const path = join(base, entry.name);
    try {
      if (Date.now() - (await lstat(path)).mtimeMs > staleMs) await remove(path);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  await db().clip.updateMany({ where: { status: "IMPORTING", updatedAt: { lt: new Date(Date.now() - staleMs) } },
    data: { status: "DELETING" } });
  const deleting = await db().clip.findMany({ where: { status: "DELETING" }, select: { id: true } });
  await Promise.allSettled(deleting.map(({ id }) => purge(id)));
}

export async function maintainStorage() {
  if (!recovered || Date.now() - recoveredAt > 60 * 60 * 1000) {
    recoveredAt = Date.now();
    recovered = recover().catch(() => { recovered = undefined; console.error("Local media cleanup could not finish."); });
  }
  await recovered;
}

export async function listClips() {
  await maintainStorage();
  return (await db().clip.findMany({ where: { status: live }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] })).map(view);
}

export async function clipSummary() {
  await maintainStorage();
  const where = { status: live };
  const [totals, recent] = await db().$transaction([
    db().clip.aggregate({ where, _count: true, _sum: { size: true } }),
    db().clip.findMany({ where, take: 4, orderBy: [{ createdAt: "desc" }, { id: "desc" }] }),
  ]);
  return { count: totals._count, bytes: totals._sum.size ?? 0, recent: recent.map(view) };
}

export function validateIds(ids: unknown): string[] {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 ||
    ids.some(id => typeof id !== "string" || !uuid.test(id))) throw new ClipError(400, "Select between 1 and 100 valid clips.");
  return [...new Set<string>(ids)];
}

export async function deleteClips(ids: string[]) {
  const rows = await db().$transaction(async transaction => {
    if (await transaction.post.count({ where: { clipId: { in: ids }, OR: [
      { status: { not: "SUCCEEDED" } }, { draft: { status: "ACTIVE" } },
      { targets: { some: { status: { not: "SUCCEEDED" } } } },
    ] } })) {
      throw new ClipError(409, "A selected clip is referenced by a draft or post. Remove its draft reference first.");
    }
    const preserved = await transaction.clip.updateManyAndReturn({ where: { id: { in: ids }, status: live,
      posts: { some: {} } }, data: { status: "PURGING" }, select: { id: true } });
    for (const { id } of preserved) {
      const cleanup = { dueAt: new Date(), requestedByPostId: null };
      await transaction.cleanupTask.upsert({ where: { clipId: id }, create: { clipId: id, ...cleanup }, update: { ...cleanup, state: "PENDING" } });
    }
    const removed = await transaction.clip.updateManyAndReturn({ where: { id: { in: ids }, status: live },
      data: { status: "DELETING" }, select: { id: true } });
    return { preserved, removed };
  });
  const result = await Promise.allSettled([...rows.removed.map(({ id }) => purge(id)),
    ...rows.preserved.map(({ id }) => finishRetainedMediaRemoval(id))]);
  if (result.some(item => item.status === "rejected")) {
    recovered = undefined;
    throw new ClipError(503, "Selected clips were removed from the library. Some stored files could not be deleted immediately.");
  }
}

export async function renameClip(id: string, name: unknown) {
  if (typeof name !== "string" || !name.trim() || name.trim().length > 255 || /[\p{Cc}]/u.test(name)) {
    throw new ClipError(400, "Choose a display name between 1 and 255 characters.");
  }
  await existing(id);
  const { count } = await db().clip.updateMany({ where: { id, status: live }, data: { displayName: name.trim() } });
  if (!count) throw new ClipError(404, "Clip not found.");
}

export async function openMedia(id: string, kind: "video" | "thumbnail") {
  const row = await existing(id);
  if ((kind === "video" ? row.storagePath : row.thumbnailPath) !== mediaRelative(id, kind)) {
    throw new ClipError(404, "Media not found.");
  }
  try {
    const { path, info } = await checkedMedia(id, kind);
    const handle = await open(path, "r");
    try {
      const actual = await handle.stat();
      if (actual.ino !== info.ino || actual.dev !== info.dev || actual.nlink !== 1 || !actual.size) throw new ClipError(404, "Media not found.");
      return { handle, path, size: actual.size, name: row.originalFilename };
    } catch (error) { await handle.close(); throw error; }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new ClipError(404, "The stored file could not be found.");
    throw error;
  }
}

const analysing = new Set<string>();
export async function analyseClip(id: string) {
  const row = await existing(id);
  if (row.status === "READY" && row.thumbnailPath) return;
  if (analysing.has(id)) throw new ClipError(409, "This clip is already being analysed.");
  analysing.add(id);
  let temp: string | undefined;
  let promoted = false;
  try {
    temp = join(await directory("temp"), `${randomUUID()}.jpg`);
    const thumb = join(await directory("thumbnails"), filename(id, "thumbnail"));
    const { path } = await checkedMedia(id, "video");
    let metadata;
    try { metadata = await probeVideo(path); }
    catch (error) {
      if (error instanceof ClipError && error.status === 422) {
        await db().clip.updateMany({ where: { id, status: live }, data: { status: "INVALID" } });
      }
      throw error;
    }
    if (!metadata) throw new ClipError(503, "FFprobe is unavailable. Install it or configure its path, then try again.");
    if (await makeThumbnail(path, temp, metadata.duration)) {
      await rename(temp, thumb);
      promoted = true;
    }
    const { count } = await db().clip.updateMany({ where: { id, status: live },
      data: { ...metadata, status: "READY", thumbnailPath: promoted ? mediaRelative(id, "thumbnail") : null } });
    if (!count) {
      if (promoted) await remove(thumb);
      throw new ClipError(404, "Clip not found.");
    }
    if (!promoted) throw new ClipError(422, "Video analysed. FFmpeg could not create a thumbnail. Check FFmpeg and try again.");
  } finally {
    analysing.delete(id);
    if (temp) await remove(temp);
  }
}

export async function importClip(request: Request, limit = maxUploadBytes()): Promise<ClipInfo & { reused?: true }> {
  const encoded = request.headers.get("x-clip-filename");
  let originalFilename = "";
  try { originalFilename = encoded ? decodeURIComponent(encoded).split(/[\\/]/).at(-1) ?? "" : ""; } catch {}
  if (!originalFilename || originalFilename.length > 255 || /[\p{Cc}]/u.test(originalFilename) ||
    !originalFilename.toLowerCase().endsWith(".mp4")) throw new ClipError(400, "Choose an MP4 file with a valid filename.");
  if (activeUploads >= 4) throw new ClipError(429, "Too many uploads are running. Retry after one finishes.");
  activeUploads++;
  const id = randomUUID();
  const cleanup: string[] = [];
  let reserved = false;
  try {
    await maintainStorage();
    const temp = join(await directory("temp"), `${id}.part`);
    const tempThumb = join(await directory("temp"), `${id}.jpg`);
    cleanup.push(temp, tempThumb);
    const hash = createHash("sha256");
    let size = 0;
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(30 * 60 * 1000)]);
    await pipeline(Readable.fromWeb(request.body as unknown as import("node:stream/web").ReadableStream),
      new Transform({ transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > limit) return done(new ClipError(413, "This video exceeds the upload limit."));
        hash.update(chunk);
        done(null, chunk);
      } }), createWriteStream(temp, { flags: "wx" }), { signal });
    const length = request.headers.get("content-length");
    if (!size || (length !== null && Number(length) !== size)) throw new ClipError(400, "The upload did not complete. Try again.");
    const checksum = hash.digest("hex");
    const duplicate = await db().clip.findUnique({ where: { activeChecksum: checksum } });
    if (duplicate) {
      if (duplicate.status === "READY" && await db().publicationHistory.findFirst({
        where: { status: "SUCCEEDED", publishedAt: { not: null }, target: { post: { clipId: duplicate.id } } }, select: { id: true },
      }) && await hasClipMedia(duplicate.id)) {
        return { ...view(duplicate), reused: true };
      }
      throw new ClipError(409, "This video is already in the library or awaiting cleanup.");
    }
    await verifyMp4(temp, size);
    const metadata = await probeVideo(temp);
    const hasThumbnail = metadata ? await makeThumbnail(temp, tempThumb, metadata.duration) && (await stat(tempThumb)).size > 0 : false;
    if (signal.aborted) throw new ClipError(408, "The upload was interrupted. Try again.");
    await db().clip.create({ data: { id, originalFilename, displayName: originalFilename,
      storedFilename: filename(id, "video"), storagePath: mediaRelative(id, "video"),
      thumbnailPath: hasThumbnail ? mediaRelative(id, "thumbnail") : null,
      mimeType: "video/mp4", size, checksum, activeChecksum: checksum, status: "IMPORTING", ...metadata } });
    reserved = true;
    const video = join(await directory("videos"), filename(id, "video"));
    await rename(temp, video);
    cleanup.push(video);
    if (hasThumbnail) {
      const thumb = join(await directory("thumbnails"), filename(id, "thumbnail"));
      await rename(tempThumb, thumb);
      cleanup.push(thumb);
    }
    if (signal.aborted) throw new ClipError(408, "The upload was interrupted. Try again.");
    const row = await db().clip.update({ where: { id }, data: { status: metadata ? "READY" : "PENDING_ANALYSIS" } });
    reserved = false;
    cleanup.splice(2);
    return view(row);
  } catch (error) {
    if ((error as { code?: string }).code === "P2002") throw new ClipError(409, "This video is already in the library.");
    if ((error as { name?: string }).name === "AbortError") throw new ClipError(408, "The upload was interrupted. Try again.");
    throw error;
  } finally {
    activeUploads--;
    const removed = await Promise.allSettled(cleanup.map(remove));
    if (reserved) {
      try {
        if (removed.slice(2).every(item => item.status === "fulfilled")) {
          await db().clip.deleteMany({ where: { id, status: "IMPORTING" } });
        } else {
          await db().clip.updateMany({ where: { id, status: "IMPORTING" }, data: { status: "DELETING" } });
          recovered = undefined;
        }
      } catch { console.error("A staged clip needs storage cleanup."); }
    }
  }
}
