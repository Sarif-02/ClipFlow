export const platforms = ["YOUTUBE", "INSTAGRAM"] as const;
export type Platform = typeof platforms[number];
export const platformName = { YOUTUBE: "YouTube", INSTAGRAM: "Instagram" };
export type Destination = { id: string; name: string; platform: Platform; connected: boolean };
export type Content = {
  title: string; description: string; tags: string; visibility: string; category: string;
  audience: string; synthetic: string; caption: string; hashtags: string;
};
export const blankContent: Content = {
  title: "", description: "", tags: "", visibility: "private", category: "22",
  audience: "", synthetic: "", caption: "", hashtags: "",
};
export function titleFromClipName(filename: string) {
  const title = filename.replace(/\.mp4$/i, "").replace(/[<>\p{Cc}]/gu, "").trim();
  let fitting = "";
  for (const character of title) {
    if (fitting.length + character.length > 100) break;
    fitting += character;
  }
  return fitting.trimEnd() || "Untitled clip";
}

export function publishingContent(content: Content, filename?: string): Content {
  return { ...blankContent, ...content, title: filename && !content.title?.trim() ? titleFromClipName(filename) : content.title ?? "",
    category: content.category || blankContent.category };
}

export function targetPublishingContent(base: Content, override: Partial<Content>, filename: string) {
  return publishingContent({ ...base, ...override, title: override.title?.trim() ? override.title : base.title }, filename);
}

export function youtubeMetadataIssues(content: Content) {
  const issues: string[] = [];
  if (!content.title.trim() || content.title.length > 100 || /[<>]/.test(content.title)) issues.push("Enter a YouTube title of up to 100 characters without angle brackets.");
  if (!/^\d{1,4}$/.test(content.category)) issues.push("Choose a YouTube category.");
  if (!["private", "public", "unlisted"].includes(content.visibility)) issues.push("Choose YouTube visibility.");
  if (!["kids", "general"].includes(content.audience)) issues.push("Choose whether this video is made for kids.");
  if (new TextEncoder().encode(content.description).length > 5000 || /[<>]/.test(content.description)) issues.push("Keep the YouTube description within 5000 bytes and remove angle brackets.");
  const tags = content.tags.split(",").map(value => value.trim()).filter(Boolean);
  if (tags.reduce((length, tag, index) => length + tag.length + (tag.includes(" ") ? 2 : 0) + Number(index > 0), 0) > 500) {
    issues.push("Keep YouTube tags within 500 characters including spaces and separators.");
  }
  return issues;
}
export const limits: Record<keyof Content, number> = {
  title: 100, description: 5000, tags: 500, visibility: 12, category: 12,
  audience: 12, synthetic: 12, caption: 2200, hashtags: 500,
};
export type DraftTarget = { accountId: string; override: Partial<Content> };
export type DraftPost = {
  clipKey: string; filename: string; content: Content; targets: DraftTarget[];
  plannedAt: string | null; cancelled: boolean;
};
export type ScheduleMode = "NOW" | "AT" | "BULK" | "CUSTOM";
export type DraftForm = {
  name: string; step: number; scheduleMode: ScheduleMode; scheduleLocal: string;
  intervalMinutes: number; timezone: string; posts: DraftPost[];
};
export type SavedDraft = DraftForm & { id: string; revision: number };
export const defaultTimezone = "Asia/Kolkata";
export const emptyDraft = (timezone: string): DraftForm => ({
  name: "", step: 1, scheduleMode: "NOW", scheduleLocal: "", intervalMinutes: 60, timezone, posts: [],
});

const formatters = new Map<string, Intl.DateTimeFormat>();
export function wallTime(date: Date, timezone: string) {
  let format = formatters.get(timezone);
  if (!format) {
    format = new Intl.DateTimeFormat("sv-SE", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatters.set(timezone, format);
  }
  return format.format(date).replace(" ", "T");
}

export function localInstant(value: string, timezone: string) {
  if (!/^[2-9]\d{3}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(value + ":00Z");
  if (!Number.isFinite(+parsed) || parsed.toISOString().slice(0, 16) !== value) return null;
  const candidates = new Set<number>();
  for (const delta of [-24, 0, 24]) {
    const sample = +parsed + delta * 3600000;
    const offset = +new Date(wallTime(new Date(sample), timezone) + ":00Z") - sample;
    const result = +parsed - offset;
    if (wallTime(new Date(result), timezone) === value) candidates.add(result);
  }
  return candidates.size === 1 ? new Date([...candidates][0]) : null;
}

export function schedule(form: DraftForm, now = Date.now()) {
  const result: (string | null)[] = form.posts.map(() => null);
  if (form.scheduleMode === "NOW") return { times: result, warning: "" };
  if (form.scheduleMode === "CUSTOM") {
    return {
      times: form.posts.map(post => post.cancelled ? null : post.plannedAt),
      warning: form.posts.some(post => !post.cancelled && post.plannedAt && +new Date(post.plannedAt) <= now)
        ? "A planned time has passed. Choose a future time in Calendar." : "",
    };
  }
  const start = localInstant(form.scheduleLocal, form.timezone);
  if (!start) return { times: result, warning: "Choose a valid date and time. Ambiguous or skipped clock times are not accepted." };
  if (+start <= now) return { times: result, warning: "Choose a time in the future." };
  if (form.scheduleMode === "BULK" && (!Number.isInteger(form.intervalMinutes) || form.intervalMinutes < 1 || form.intervalMinutes > 10080)) {
    return { times: result, warning: "Enter a whole posting interval between 1 and 10080 minutes." };
  }
  return { times: form.posts.map((post, index) => post.cancelled ? null :
    new Date(+start + (form.scheduleMode === "BULK" ? index * form.intervalMinutes * 60000 : 0)).toISOString()), warning: "" };
}

export function displayTime(value: string | null, timezone: string) {
  if (!value) return "No date planned";
  return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
}
