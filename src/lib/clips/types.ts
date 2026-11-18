export type ClipInfo = {
  id: string; originalFilename: string; displayName: string; mimeType: string; size: number;
  duration: number | null; width: number | null; height: number | null; codec: string | null;
  aspectRatio: string | null; audioCodec: string | null; audioChannels: number | null;
  source: string; status: string; createdAt: string; hasThumbnail: boolean;
};

export const clipMedia = (id: string, kind: "video" | "thumbnail" | "download") =>
  `/api/clips/${id}/media?kind=${kind}`;

export function formatBytes(bytes: number) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = bytes ? Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1) : 0;
  return `${Number((bytes / 1024 ** index).toFixed(index > 0 ? 1 : 0))} ${units[index]}`;
}

export function formatDuration(seconds: number | null) {
  if (seconds === null) return "Unknown duration";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const remainder = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
}

const date = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "Asia/Kolkata" });
export const formatClipDate = (value: string) => date.format(new Date(value));
export const formatResolution = (clip: Pick<ClipInfo, "width" | "height">) =>
  clip.width && clip.height ? `${clip.width} × ${clip.height}` : "Unknown resolution";
