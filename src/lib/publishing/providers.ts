import { Readable } from "node:stream";
import { openMedia } from "@/lib/clips/storage";
import { accountToken, graphRoot } from "@/lib/integrations/oauth";
import { providerConfig } from "@/lib/integrations/config";
import { bearer, ProviderError, providerFetch, providerJson, responseError } from "@/lib/integrations/network";
import { quotaWindow, reelCaption, reserveUpload, validatePublication, type Work } from "./queue";
import { publishingContent, type Content } from "@/lib/planning/model";

export type Checkpoint = { phase?: string; session?: string; container?: string; expires?: number; remoteId?: string };
export type PublishResult = { state: "PROCESSING" | "AWAITING_PROVIDER" | "PUBLISHED"; remoteId?: string; remoteUrl?: string; wait?: number };
export type PublishContext = { work: Work; checkpoint: Checkpoint; signal: AbortSignal; save: (checkpoint: Checkpoint, bytes?: number) => Promise<void> };
export type Publisher = (context: PublishContext) => Promise<PublishResult>;
const uncertain = (message: string) => new ProviderError("uncertain", message);
const resultId = (value: unknown, platform: "youtube" | "meta") => {
  if (typeof value !== "string" || !(platform === "youtube" ? /^[\w-]{11}$/ : /^\d{4,40}$/).test(value)) throw uncertain("The provider accepted a request but did not return a usable ID.");
  return value;
};
const safeSession = (value: string) => {
  let url: URL;
  try { url = new URL(value); } catch { throw uncertain("The provider returned an invalid resumable upload URL."); }
  if (url.origin !== "https://www.googleapis.com" || url.username || url.password || url.pathname !== "/upload/youtube/v3/videos" ||
      !url.searchParams.has("upload_id")) throw uncertain("The provider returned an unexpected upload endpoint.");
  return url;
};
const chunkBytes = 8 * 1024 * 1024;

export function youtubePublisher(transport = fetch, credentials = accountToken, quota = reserveUpload): Publisher {
  return async ({ work, checkpoint, signal, save }) => {
    const account = work.target.account;
    const clip = work.target.post.clip;
    if (!clip) throw new ProviderError("permanent", "The local clip is missing.");
    const content = publishingContent(work.target.content as Content, work.target.post.filename);
    validatePublication("YOUTUBE", content, clip);
    const token = await credentials(account.id);
    const headers = bearer(token);
    const remote = checkpoint.remoteId ?? work.remoteId;
    if (remote) {
      const id = resultId(remote, "youtube");
      const result = await providerJson<{ items?: { snippet?: { channelId: string }; status?: { uploadStatus?: string; privacyStatus?: string; publishAt?: string } }[] }>(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,status&id=${id}`, { headers, signal }, transport);
      const video = result.items?.[0];
      if (!video && Date.now() - +work.createdAt > 86400000) throw uncertain("YouTube did not return the expected video. Review the channel before retrying.");
      if (!video) return { state: "PROCESSING", remoteId: id, wait: 60000 };
      if (video.snippet?.channelId !== account.remoteId) throw uncertain("The uploaded video could not be verified for the intended channel.");
      if (["failed", "rejected", "deleted"].includes(video.status?.uploadStatus ?? "")) throw new ProviderError("permanent", "YouTube rejected or failed to process the video.");
      if (video.status?.uploadStatus !== "processed") {
        if (Date.now() - +work.updatedAt > 86400000 || work.attempts > 2000) throw uncertain("YouTube has not confirmed processing. Review the existing video in YouTube Studio.");
        return { state: "PROCESSING", remoteId: id, wait: 45000 };
      }
      if (video.status.privacyStatus !== content.visibility) {
        if (work.nativeSchedule && content.visibility === "public" && video.status.privacyStatus === "private" &&
          work.scheduledAt && Date.now() < +work.scheduledAt + 10 * 60000) {
          return { state: "AWAITING_PROVIDER", remoteId: id, wait: 60000 };
        }
        throw uncertain("YouTube processed the video with a different visibility. Verify it in YouTube Studio.");
      }
      return { state: "PUBLISHED", remoteId: id, remoteUrl: `https://www.youtube.com/watch?v=${id}` };
    }
    const file = await openMedia(clip.id, "video");
    try {
      if (file.size !== clip.size) throw new ProviderError("permanent", "The stored video changed after import.");
      let url = checkpoint.session ? safeSession(checkpoint.session) : null;
      let offset = 0;
      async function acknowledge(response: Response) {
        if (response.status === 308) {
          const range = response.headers.get("range");
          const end = range ? /^bytes=0-(\d+)$/.exec(range)?.[1] : undefined;
          if (range && !end) throw uncertain("YouTube returned an invalid uploaded byte range.");
          const next = end ? Number(end) + 1 : 0;
          if (next > file.size) throw uncertain("YouTube returned an invalid uploaded byte count.");
          return { offset: next };
        }
        if (response.ok) {
          const id = resultId((await response.json().catch(() => null))?.id, "youtube");
          await save({ phase: "accepted", remoteId: id }, file.size);
          return { id };
        }
        if ([404, 410].includes(response.status)) throw uncertain("The YouTube upload session expired. Review YouTube Studio before retrying.");
        throw await responseError(response);
      }
      if (!url) {
        await quota(work);
        const native = work.nativeSchedule && work.scheduledAt && +work.scheduledAt > Date.now();
        const start = await providerFetch("https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status", {
          method: "POST", signal, headers: { ...headers, "Content-Type": "application/json", "X-Upload-Content-Length": String(file.size), "X-Upload-Content-Type": "video/mp4" },
          body: JSON.stringify({ snippet: { title: content.title.trim(), description: content.description,
            tags: content.tags.split(",").map(tag => tag.trim()).filter(Boolean), categoryId: content.category },
          status: { privacyStatus: native ? "private" : content.visibility, ...(native ? { publishAt: work.scheduledAt!.toISOString() } : {}),
            selfDeclaredMadeForKids: content.audience === "kids",
            ...(content.synthetic ? { containsSyntheticMedia: content.synthetic === "yes" } : {}) } }),
        }, 25000, transport);
        if (!start.ok) throw await responseError(start);
        url = safeSession(start.headers.get("location") ?? "");
        checkpoint = { phase: "uploading", session: url.href };
        await save(checkpoint, 0);
      } else {
        const previous = await acknowledge(await providerFetch(url, { method: "PUT", signal, headers: { ...headers, "Content-Length": "0", "Content-Range": `bytes */${file.size}` } }, 25000, transport));
        if (previous.id) return { state: "PROCESSING", remoteId: previous.id, wait: 15000 };
        offset = previous.offset!;
      }
      while (offset < file.size) {
        const size = Math.min(chunkBytes, file.size - offset);
        const payload = Buffer.allocUnsafe(size);
        let read = 0;
        while (read < size) {
          const result = await file.handle.read(payload, read, size - read, offset + read);
          if (!result.bytesRead) throw new ProviderError("permanent", "The stored video ended early.");
          read += result.bytesRead;
        }
        const response = await providerFetch(url, { method: "PUT", signal, headers: { ...headers, "Content-Type": "video/mp4",
          "Content-Length": String(size), "Content-Range": `bytes ${offset}-${offset + size - 1}/${file.size}` }, body: payload }, 65000, transport);
        const next = await acknowledge(response);
        if (next.id) return { state: "PROCESSING", remoteId: next.id, wait: 15000 };
        if (next.offset! <= offset) throw new ProviderError("temporary", "YouTube has not confirmed the last upload chunk.");
        offset = next.offset!;
        await save(checkpoint, offset);
      }
      throw new ProviderError("temporary", "YouTube has not yet confirmed the video ID.");
    } finally { await file.handle.close(); }
  };
}

export function instagramPublisher(transport = fetch, credentials = accountToken, quota = reserveUpload,
  configuration = () => providerConfig("INSTAGRAM")): Publisher {
  return async ({ work, checkpoint, signal, save }) => {
    const account = work.target.account, clip = work.target.post.clip;
    if (!clip) throw new ProviderError("permanent", "The local clip is missing.");
    const content = work.target.content as Content;
    validatePublication("INSTAGRAM", content, clip);
    const token = await credentials(account.id);
    const config = await configuration();
    const version = config.values.version ?? "v27.0";
    if (!/^v(?:2[2-7])\.0$/.test(version)) throw new ProviderError("permanent", "The configured Meta version is unsupported.");
    const root = graphRoot(version);
    const identity = resultId(account.remoteId, "meta");
    const headers = bearer(token);
    const get = <T,>(path: string) => providerJson<T>(`${root}/${path}`, { headers, signal }, transport);
    const post = <T,>(path: string, body: Record<string, unknown>) => providerJson<T>(`${root}/${path}`, {
      method: "POST", body: JSON.stringify(body), headers: { ...headers, "Content-Type": "application/json" }, signal,
    }, transport);
    if (checkpoint.remoteId || work.remoteId) {
      const id = resultId(checkpoint.remoteId ?? work.remoteId, "meta");
      const media = await get<{ id: string; permalink?: string }>(`${id}?fields=id,permalink`);
      if (media.id !== id) throw uncertain("Instagram did not verify the expected media ID.");
      const url = media.permalink && /^https:\/\/(www\.)?instagram\.com\//.test(media.permalink) ? media.permalink : undefined;
      return { state: "PUBLISHED", remoteId: id, remoteUrl: url };
    }
    if (checkpoint.phase === "creating") throw uncertain("Instagram container creation was interrupted before returning its ID.");
    let container = checkpoint.container;
    if (!container) {
      const allowed = await get<{ data?: { quota_usage?: number; config?: { quota_total?: number } }[] }>(
        `${identity}/content_publishing_limit?fields=quota_usage,config`);
      const limit = allowed.data?.[0];
      if (typeof limit?.quota_usage === "number" && limit.quota_usage >= (limit.config?.quota_total ?? 100)) {
        throw new ProviderError("quota", "Instagram’s rolling publishing limit is exhausted.", 0, 3600000);
      }
      await quota(work);
      await save({ phase: "creating" });
      let created: { id: string };
      try { created = await post(`${identity}/media`, { media_type: "REELS", upload_type: "resumable", caption: reelCaption(content) }); }
      catch (error) {
        if (error instanceof ProviderError && error.kind !== "temporary") { await save({}); throw error; }
        throw uncertain("Instagram did not confirm whether it created the media container.");
      }
      container = resultId(created.id, "meta");
      checkpoint = { phase: "upload", container, expires: Date.now() + 23 * 3600000 };
      await save(checkpoint, 0);
    }
    const id = resultId(container, "meta");
    if (checkpoint.expires && checkpoint.expires < Date.now()) throw uncertain("The Instagram container expired. Review the account before retrying.");
    if (checkpoint.phase === "upload") {
      const file = await openMedia(clip.id, "video");
      try {
        if (file.size !== clip.size) throw new ProviderError("permanent", "The stored video changed after import.");
        await save({ ...checkpoint, phase: "sending" });
        const stream = file.handle.createReadStream({ autoClose: false, signal });
        try {
          const response = await providerFetch(`https://rupload.facebook.com/ig-api-upload/${version}/${id}`, {
            method: "POST", signal, headers: { Authorization: `OAuth ${token}`, offset: "0", file_size: String(file.size),
              "Content-Type": "application/octet-stream", "Content-Length": String(file.size) },
            body: Readable.toWeb(stream, { strategy: { highWaterMark: 65536, size: (chunk: Buffer) => chunk.byteLength } }) as unknown as BodyInit,
            duplex: "half",
          } as RequestInit, 120000, transport);
          if (!response.ok) {
            const failure = await responseError(response);
            if (failure.kind !== "temporary") { await save(checkpoint); throw failure; }
            throw failure;
          }
          await save({ ...checkpoint, phase: "poll" }, file.size);
        } finally { stream.destroy(); }
      } finally { await file.handle.close(); }
      return { state: "PROCESSING", wait: 60000 };
    }
    const report = await get<{ status_code?: string }>(`${id}?fields=status_code`);
    if (report.status_code === "PUBLISHED") throw uncertain("The Instagram container is published, but no media ID was returned. Verify the Reel in Instagram.");
    if (checkpoint.phase === "publishing") throw uncertain("Instagram did not confirm the publish request. Review the existing container before retrying.");
    if (report.status_code === "ERROR" || report.status_code === "EXPIRED") throw new ProviderError("permanent", "Instagram rejected the container or it expired.");
    if (report.status_code !== "FINISHED") {
      if (checkpoint.phase === "sending" && work.attempts > 8) throw uncertain("Instagram did not confirm the local file transfer.");
      return { state: "PROCESSING", wait: 60000 };
    }
    await save({ ...checkpoint, phase: "publishing" });
    let published: { id: string };
    try { published = await post(`${identity}/media_publish`, { creation_id: id }); }
    catch (error) {
      if (error instanceof ProviderError && error.kind !== "temporary") { await save({ ...checkpoint, phase: "poll" }); throw error; }
      throw error;
    }
    const remoteId = resultId(published.id, "meta");
    await save({ phase: "accepted", remoteId });
    return { state: "PROCESSING", remoteId, wait: 10000 };
  };
}

export function providerRetryDelay(platform: string, error: ProviderError, attempts: number, now = new Date()) {
  if (error.kind === "quota" && platform === "YOUTUBE" && /quota|daily/i.test(error.reason)) {
    return Math.max(error.retryAfter, +quotaWindow("America/Los_Angeles", now).reset - +now);
  }
  return Math.max(error.retryAfter, error.kind === "quota" ? 30 * 60000 : 15000 * 2 ** Math.min(attempts, 8) + Math.random() * 10000);
}
