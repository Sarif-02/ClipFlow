import { db } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { hasClipMedia } from "@/lib/clips/storage";
import { blankContent, limits, localInstant, platforms, schedule, type Content, type DraftForm, type DraftPost, type SavedDraft, type ScheduleMode } from "./model";
import { runtimeSettings } from "@/lib/integrations/config";

const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function validId(input: unknown): input is string { return typeof input === "string" && uuid.test(input); }
const bad = (message = "Check the draft fields and try again.") => new ClipError(400, message);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw bad();
  return value as Record<string, unknown>;
};
const allowed: Partial<Record<keyof Content, string[]>> = {
  visibility: ["", "private", "unlisted", "public"], audience: ["", "kids", "general"], synthetic: ["", "yes", "no"],
};
function content(value: unknown, sparse = false) {
  const data = object(value);
  const result: Partial<Content> = {};
  for (const field of Object.keys(limits) as (keyof Content)[]) {
    const entry = data[field];
    if (entry === undefined && sparse) continue;
    if (typeof entry !== "string" || entry.length > limits[field] ||
      (allowed[field] && !allowed[field]?.includes(entry)) ||
      (field === "category" && !/^\d*$/.test(entry))) throw bad("One or more content fields are invalid.");
    result[field] = entry;
  }
  return result;
}

function parse(value: unknown, timezone: string): DraftForm {
  const input = object(value);
  const { name, step, scheduleMode, scheduleLocal, intervalMinutes, posts } = input;
  if (typeof name !== "string" || name.length > 120 || typeof step !== "number" || !Number.isInteger(step) || step < 1 || step > 5 ||
      typeof scheduleMode !== "string" || !["NOW", "AT", "BULK", "CUSTOM"].includes(scheduleMode) ||
      typeof scheduleLocal !== "string" || scheduleLocal.length > 16 ||
      typeof intervalMinutes !== "number" || !Number.isInteger(intervalMinutes) || intervalMinutes < 0 || intervalMinutes > 10080 ||
      !Array.isArray(posts) || posts.length > 30) throw bad();
  const seen = new Set<string>();
  const selections: DraftPost[] = posts.map(value => {
    const post = object(value);
    const key = post.clipKey;
    if (!validId(key) || seen.has(key) || !Array.isArray(post.targets) || post.targets.length > 24) throw bad("Select up to 30 different clips and 24 accounts per clip.");
    seen.add(key);
    const accounts = new Set<string>();
    return { clipKey: key, filename: "", content: { ...blankContent, ...content(post.content) }, cancelled: false, plannedAt: null,
      targets: post.targets.map(value => {
        const target = object(value);
        if (!validId(target.accountId) || accounts.has(target.accountId)) throw bad("Choose distinct destination accounts.");
        accounts.add(target.accountId);
        return { accountId: target.accountId, override: content(target.override, true) };
      }) };
  });
  return { name: name.trim() || "Untitled draft", step, scheduleMode: scheduleMode as ScheduleMode,
    scheduleLocal, intervalMinutes, timezone, posts: selections };
}

const active = { status: "ACTIVE" };
const editable = ["DRAFT", "PLANNED", "CANCELLED"];
const draftInclude = { posts: { orderBy: { position: "asc" as const }, include: { targets: { orderBy: { accountId: "asc" as const } } } } };

export async function loadDraft(id: string): Promise<SavedDraft | null> {
  if (!validId(id)) return null;
  const row = await db().publishingDraft.findFirst({ where: { id, ...active }, include: draftInclude });
  if (!row) return null;
  return { id, name: row.name, revision: row.revision, step: row.step, scheduleMode: row.scheduleMode as ScheduleMode,
    scheduleLocal: row.scheduleLocal, intervalMinutes: row.intervalMinutes, timezone: row.timezone,
    posts: row.posts.map(post => ({ clipKey: post.clipKey, filename: post.filename,
      content: post.content as Content, plannedAt: post.scheduledAt?.toISOString() ?? null, cancelled: post.status === "CANCELLED",
      targets: post.targets.map(target => ({ accountId: target.accountId, override: target.content as Partial<Content> })) })) };
}

export async function saveDraft(value: unknown, id?: string) {
  const raw = object(value);
  const previous = id ? await loadDraft(id) : null;
  if (id && !previous) throw new ClipError(404, "This draft is no longer available.");
  const form = parse(raw, previous?.timezone ?? (await runtimeSettings()).timezone);
  const previousPosts = new Map(previous?.posts.map(post => [post.clipKey, post]));
  const preservePlan = previous && previous.scheduleMode === form.scheduleMode &&
    previous.scheduleLocal === form.scheduleLocal && previous.intervalMinutes === form.intervalMinutes &&
    previous.posts.map(post => post.clipKey).join() === form.posts.map(post => post.clipKey).join();
  if (!previous && form.scheduleMode === "CUSTOM") throw bad();
  if (form.scheduleMode === "CUSTOM" && previous?.scheduleMode !== "CUSTOM") throw bad();
  for (const post of form.posts) {
    const before = previousPosts.get(post.clipKey);
    if (preservePlan || form.scheduleMode === "CUSTOM") {
      post.plannedAt = before?.plannedAt ?? null;
      post.cancelled = before?.cancelled ?? false;
    }
  }
  const calculated = schedule(form);
  if (calculated.warning && raw.complete === true) throw bad(calculated.warning);
  if (raw.complete === true && form.intervalMinutes < 1 && form.scheduleMode === "BULK") throw bad("Choose a valid interval.");
  const times = preservePlan && calculated.warning ? form.posts.map(post => post.plannedAt) : calculated.times;
  const files = new Map(await Promise.all(form.posts.map(async post => [post.clipKey, await hasClipMedia(post.clipKey)] as const)));
  if (raw.complete === true && (!form.posts.length || form.posts.some(post => !files.get(post.clipKey)))) {
    throw bad("Select available clips before saving from Review.");
  }
  const draftId = await db().$transaction(async tx => {
    const connectionChanges = id ? await tx.publishingDraft.updateMany({ where: { id, ...active, revision: previous && raw.revision === previous.revision ? previous.revision : -1 },
      data: { revision: { increment: 1 } } }) : null;
    if (connectionChanges && !connectionChanges.count) throw new ClipError(409, "This draft changed in another tab. Reopen it before editing.");
    const draftFields = { name: form.name, step: form.step, scheduleMode: form.scheduleMode,
      scheduleLocal: form.scheduleLocal, intervalMinutes: form.intervalMinutes, timezone: form.timezone };
    const draft = id ? await tx.publishingDraft.update({ where: { id }, data: draftFields }) :
      await tx.publishingDraft.create({ data: draftFields });
    if (await tx.post.count({ where: { draftId: draft.id, OR: [
      { status: { notIn: editable } }, { targets: { some: { status: { notIn: editable } } } },
    ] } })) {
      throw new ClipError(409, "A publication has started and its draft is locked.");
    }
    await tx.post.deleteMany({ where: { draftId: draft.id, clipKey: { notIn: form.posts.map(post => post.clipKey) } } });
    const accountIds = [...new Set(form.posts.flatMap(post => post.targets.map(target => target.accountId)))];
    const accounts = await tx.socialAccount.findMany({ where: { id: { in: accountIds }, platform: { in: [...platforms] } } });
    const available = new Map(accounts.map(account => [account.id, account.status === "CONNECTED"]));
    for (const [position, post] of form.posts.entries()) {
      const before = previousPosts.get(post.clipKey);
      const clip = await tx.clip.findFirst({ where: { id: post.clipKey, status: { notIn: ["IMPORTING", "DELETING", "PURGING", "MEDIA_REMOVED", "INVALID"] } },
        select: { id: true, originalFilename: true } });
      if ((!clip || !files.get(post.clipKey)) && (!before || raw.complete === true)) {
        throw new ClipError(409, "A selected clip is missing. Remove it or restore the stored file.");
      }
      const scheduledAt = times[position] ? new Date(times[position]!) : null;
      const status = post.cancelled ? "CANCELLED" : scheduledAt ? "PLANNED" : "DRAFT";
      const data = { position, clipId: clip?.id ?? null, filename: clip?.originalFilename ?? before!.filename,
        content: post.content, status, scheduledAt };
      const saved = await tx.post.upsert({ where: { draftId_clipKey: { draftId: draft.id, clipKey: post.clipKey } },
        update: data, create: { ...data, draftId: draft.id, clipKey: post.clipKey } });
      await tx.postTarget.deleteMany({ where: { postId: saved.id, accountId: { notIn: post.targets.map(target => target.accountId) } } });
      for (const target of post.targets) {
        if (!available.get(target.accountId) && !before?.targets.some(old => old.accountId === target.accountId)) {
          throw bad("A selected account is not connected.");
        }
        if (!available.has(target.accountId)) continue;
        await tx.postTarget.upsert({ where: { postId_accountId: { postId: saved.id, accountId: target.accountId } },
          update: { content: target.override, status },
          create: { postId: saved.id, accountId: target.accountId, content: target.override, status } });
      }
    }
    return draft.id;
  });
  return (await loadDraft(draftId))!;
}

export async function copyDraft(id: string) {
  if (!validId(id)) throw new ClipError(404, "Draft not found.");
  return db().$transaction(async tx => {
    const original = await tx.publishingDraft.findFirst({ where: { id, ...active }, include: draftInclude });
    if (!original) throw new ClipError(404, "Draft not found.");
    const { name, step, timezone, intervalMinutes } = original;
    const draft = await tx.publishingDraft.create({ data: {
      name: name.slice(0, 115) + " copy", step: Math.min(step, 4), timezone, intervalMinutes,
      posts: { create: original.posts.map(post => {
        return { clipId: post.clipId, clipKey: post.clipKey, filename: post.filename, position: post.position,
          content: post.content!,
          targets: { create: post.targets.map(target => ({ accountId: target.accountId, content: target.content! })) } };
      }) },
    } });
    return { id: draft.id };
  });
}

export async function removeDraft(id: string) {
  if (!validId(id)) throw new ClipError(404, "Draft not found.");
  await db().$transaction(async tx => {
    if (!(await tx.publishingDraft.count({ where: { id, ...active } }))) throw new ClipError(404, "Draft not found.");
    if (await tx.post.count({ where: { draftId: id, OR: [
      { status: { notIn: editable } }, { targets: { some: { status: { notIn: editable } } } },
    ] } })) throw new ClipError(409, "A publication has started and this draft is locked.");
    await tx.post.deleteMany({ where: { draftId: id } });
    await tx.publishingDraft.delete({ where: { id } });
  });
}

export async function changePlan(id: string, value: unknown) {
  if (!validId(id)) throw new ClipError(404, "Plan not found.");
  const input = object(value);
  await db().$transaction(async tx => {
    const post = await tx.post.findFirst({ where: { id, status: "PLANNED", draft: active }, include: { draft: true } });
    if (!post?.draft) throw new ClipError(404, "Plan not found.");
    if (await tx.postTarget.count({ where: { postId: id, status: { notIn: editable } } })) {
      throw new ClipError(409, "A publication has started and this plan is locked.");
    }
    const cancel = input.cancel === true;
    const scheduledAt = !cancel && typeof input.local === "string" ? localInstant(input.local, post.draft.timezone) : null;
    if (!cancel && (!scheduledAt || +scheduledAt <= Date.now())) throw bad("Choose a valid future date and time.");
    const status = cancel ? "CANCELLED" : "PLANNED";
    await tx.publishingDraft.update({ where: { id: post.draft.id }, data: { scheduleMode: "CUSTOM", revision: { increment: 1 } } });
    await tx.post.update({ where: { id }, data: { scheduledAt, status } });
    await tx.postTarget.updateMany({ where: { postId: id }, data: { status } });
  });
}
