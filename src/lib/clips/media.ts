import { execFile } from "node:child_process";
import { open } from "node:fs/promises";
import { promisify } from "node:util";
import { ClipError } from "./http";

const execute = promisify(execFile);
const toolPath = (tool: "ffmpeg" | "ffprobe") =>
  process.env[tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"]?.trim() || tool;

async function run(tool: "ffmpeg" | "ffprobe", args: string[], timeout: number) {
  return execute(toolPath(tool), args, { windowsHide: true, timeout, maxBuffer: 1024 * 1024 });
}

async function available(tool: "ffmpeg" | "ffprobe") {
  try { await run(tool, ["-version"], 5000); return true; } catch { return false; }
}

export async function mediaTools() {
  const [ffmpeg, ffprobe] = await Promise.all([available("ffmpeg"), available("ffprobe")]);
  return { ffmpeg, ffprobe };
}

export async function verifyMp4(path: string, size: number) {
  const file = await open(path, "r");
  const header = Buffer.alloc(16);
  let budget = 8192;
  const invalid = () => new ClipError(422, "This file is not a supported MP4 video.");
  async function boxes(start: number, end: number) {
    const result = [];
    while (start < end) {
      if (--budget < 0 || end - start < 8) throw invalid();
      if ((await file.read(header, 0, 8, start)).bytesRead !== 8) throw invalid();
      let length = header.readUInt32BE();
      const type = header.toString("ascii", 4, 8);
      let offset = 8;
      if (length === 1) {
        if (end - start < 16 || (await file.read(header, 8, 8, start + 8)).bytesRead !== 8) throw invalid();
        const extended = header.readBigUInt64BE(8);
        if (extended > BigInt(end - start)) throw invalid();
        length = Number(extended);
        offset = 16;
      } else if (length === 0) length = end - start;
      if (length < offset || length > end - start) throw invalid();
      result.push({ type, start: start + offset, end: start + length });
      start += length;
    }
    return result;
  }
  try {
    const top = await boxes(0, size);
    const ftyp = top.find(box => box.type === "ftyp");
    const moov = top.find(box => box.type === "moov");
    if (!ftyp || ftyp.end - ftyp.start < 8 || !moov || !top.some(box => box.type === "mdat" && box.end > box.start)) throw invalid();
    await file.read(header, 0, 4, ftyp.start);
    if (!/^(isom|iso[2-9]|mp4[12]|avc1|dash|M4V |MSNV)$/.test(header.toString("ascii", 0, 4))) throw invalid();
    for (const track of (await boxes(moov.start, moov.end)).filter(box => box.type === "trak")) {
      const media = (await boxes(track.start, track.end)).find(box => box.type === "mdia");
      if (!media) continue;
      const entries = await boxes(media.start, media.end);
      const handler = entries.find(box => box.type === "hdlr");
      if (!handler || handler.end - handler.start < 12 || !entries.some(box => box.type === "minf")) continue;
      if ((await file.read(header, 0, 4, handler.start + 8)).bytesRead === 4 && header.toString("ascii", 0, 4) === "vide") return;
    }
    throw invalid();
  } finally { await file.close(); }
}

type Stream = { codec_type?: string; codec_name?: string; width?: number; height?: number;
  display_aspect_ratio?: string; channels?: number; duration?: string;
  disposition?: { attached_pic?: number }; side_data_list?: { rotation?: number }[] };

const mp4Input = ["-protocol_whitelist", "file", "-enable_drefs", "0", "-f", "mov"];

export async function extractSpeechAudio(path: string, maxSeconds: number, signal: AbortSignal) {
  try {
    const { stdout } = await execute(toolPath("ffmpeg"), ["-nostdin", "-v", "error", ...mp4Input, "-i", path, "-map", "0:a:0",
      "-vn", "-sn", "-dn", "-t", String(maxSeconds), "-ac", "1", "-ar", "16000", "-b:a", "48k", "-f", "mp3", "pipe:1"],
    { signal, windowsHide: true, timeout: 60000, maxBuffer: 4 * 1024 * 1024, encoding: "buffer" });
    if (stdout.length > 256) return stdout;
  } catch (error) {
    signal.throwIfAborted();
    if (["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) {
      throw new ClipError(503, "FFmpeg is unavailable. Set FFMPEG_PATH or paste a transcript instead.");
    }
  }
  throw new ClipError(422, "Could not extract an audio track. Check the clip or paste a transcript instead.");
}

export async function probeVideo(path: string) {
  let output: string;
  try {
    ({ stdout: output } = await run("ffprobe", ["-v", "error", ...mp4Input,
      "-show_streams", "-show_format", "-of", "json", path], 20000));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "EACCES" || code === "EPERM") return null;
    throw new ClipError(422, "FFprobe could not read this video. Export it as an MP4 and try again.");
  }
  const { streams = [], format } = JSON.parse(output) as { streams?: Stream[]; format?: { duration?: string } };
  const video = streams.find(stream => stream.codec_type === "video" && !stream.disposition?.attached_pic);
  const audio = streams.find(stream => stream.codec_type === "audio");
  const duration = Number(video?.duration ?? format?.duration);
  if (!video?.width || !video.height || !video.codec_name || video.codec_name === "unknown" ||
    !Number.isFinite(duration) || duration <= 0) throw new ClipError(422, "No playable video track was found in this MP4.");
  if (video.width > 8192 || video.height > 8192) throw new ClipError(422, "Video dimensions exceed the 8192 pixel limit.");
  const rotation = video.side_data_list?.find(data => typeof data.rotation === "number")?.rotation ?? 0;
  const rotated = Math.abs(rotation % 180) === 90;
  const [width, height] = rotated ? [video.height, video.width] : [video.width, video.height];
  const aspect = video.display_aspect_ratio?.split(":");
  return { duration, width, height, codec: video.codec_name,
    aspectRatio: aspect?.length === 2 ? (rotated ? aspect.reverse().join(":") : aspect.join(":")) : `${width}:${height}`,
    audioCodec: audio?.codec_name ?? null, audioChannels: audio?.channels ?? null };
}

export async function makeThumbnail(path: string, target: string, duration: number) {
  try {
    await run("ffmpeg", ["-nostdin", "-v", "error", "-y", "-ss", String(Math.min(1, duration / 4)),
      ...mp4Input, "-threads", "2", "-i", path, "-map", "0:V:0", "-an", "-sn", "-dn",
      "-frames:v", "1", "-vf", "scale=480:480:force_original_aspect_ratio=decrease",
      "-threads", "1", "-q:v", "4", "-f", "image2", target], 30000);
    return true;
  } catch { return false; }
}
