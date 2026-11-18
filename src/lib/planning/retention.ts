import { db } from "@/lib/clips/db";
import { finishRetainedMediaRemoval } from "@/lib/clips/storage";
import type { Prisma } from "@/generated/prisma/client";

const eligibility = { id: true, size: true, status: true, posts: {
  select: { id: true, status: true, draft: { select: { status: true } }, targets: {
    select: { status: true, verifiedAt: true, history: { where: { status: "SUCCEEDED", publishedAt: { not: null }, remoteMediaId: { not: "" } },
      select: { id: true }, take: 1 } },
  } },
} } satisfies Prisma.ClipSelect;
type Candidate = Prisma.ClipGetPayload<{ select: typeof eligibility }>;

function eligible(clip: Candidate | null, cutoff: number) {
  if (!clip || !["READY", "PURGING"].includes(clip.status) || !clip.posts.length ||
    clip.posts.some(post => post.draft?.status === "ACTIVE" || (post.status !== "CANCELLED" &&
      (post.status !== "SUCCEEDED" || !post.targets.length || post.targets.some(target => target.status !== "SUCCEEDED" || !target.verifiedAt || !target.history.length))))) return false;
  const verified = clip.posts.filter(post => post.status === "SUCCEEDED").flatMap(post => post.targets);
  return verified.length > 0 && verified.every(target => +target.verifiedAt! <= cutoff);
}

export async function cleanupSummary(now = new Date()) {
  const [rows, removed] = await Promise.all([db().clip.findMany({
    where: { status: { in: ["READY", "PURGING"] }, posts: { some: { status: "SUCCEEDED" } } },
    orderBy: { createdAt: "asc" }, select: eligibility,
  }), db().clip.aggregate({ where: { status: "MEDIA_REMOVED" }, _sum: { size: true } })]);
  const candidates = rows.filter(row => eligible(row, +now)).map(({ id, size }) => ({ id, size }));
  return { candidates, reclaimedBytes: removed._sum.size ?? 0 };
}

export async function cleanupVerifiedMedia(id: string, now = new Date(), manual = false) {
  const claimed = await db().$transaction(async tx => {
    const clip = await tx.clip.findUnique({ where: { id }, select: eligibility });
    if (!clip || !eligible(clip, +now)) return false;
    if (clip.status === "PURGING") return true;
    if (manual) {
      await tx.cleanupTask.upsert({ where: { clipId: id }, create: { clipId: id, dueAt: now },
        update: { state: "PENDING", dueAt: now, requestedByPostId: null } });
    } else {
      const task = await tx.cleanupTask.findUnique({ where: { clipId: id } });
      if (!task || task.state !== "PENDING" || !clip.posts.some(post => post.id === task.requestedByPostId && post.status === "SUCCEEDED")) return false;
    }
    await tx.clip.update({ where: { id }, data: { status: "PURGING" } });
    return true;
  });
  if (!claimed || !(await finishRetainedMediaRemoval(id))) return false;
  await db().cleanupTask.updateMany({ where: { clipId: id }, data: { state: "DONE" } });
  return true;
}
