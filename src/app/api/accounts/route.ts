import { clipError, ClipError, smallJson, verifyLocal } from "@/lib/clips/http";
import { db } from "@/lib/clips/db";
import { validId } from "@/lib/planning/drafts";
import { verifyAccount } from "@/lib/integrations/oauth";
import { ProviderError } from "@/lib/integrations/network";

export async function POST(request: Request) {
  try {
    verifyLocal(request, true);
    const input = await smallJson(request) as { id?: unknown; action?: unknown; name?: unknown; ids?: unknown; groupId?: unknown } | null;
    if (!input) throw new ClipError(400, "Invalid account request.");
    if (input.action === "verify" && validId(input.id)) return Response.json({ verified: await verifyAccount(input.id) });
    if (input.action === "disconnect" && validId(input.id)) {
      const id = input.id;
      await db().$transaction(async tx => {
        if (await tx.job.count({ where: { target: { accountId: id }, leaseOwner: { not: null } } })) throw new ClipError(409, "Wait for the active provider request to finish before disconnecting.");
        await tx.socialAccount.updateMany({ where: { id }, data: { status: "DISCONNECTED", canPublish: false, canAnalyze: false, authIssue: null } });
        await tx.oAuthCredential.deleteMany({ where: { accountId: id } });
        await tx.analyticsCache.deleteMany({ where: { accountId: id } });
        await tx.job.updateMany({ where: { target: { accountId: id }, state: { in: ["QUEUED", "SCHEDULED", "RETRY", "PROCESSING", "AWAITING_PROVIDER"] } },
          data: { state: "PAUSED_AUTH", errorKind: "authorization", error: "Account disconnected. Reconnect before resuming." } });
      });
      return Response.json({});
    }
    if (input.action === "deleteGroup" && validId(input.groupId)) {
      await db().accountGroup.deleteMany({ where: { id: input.groupId } }); return Response.json({});
    }
    if (input.action === "group" && typeof input.name === "string" && input.name.trim() && input.name.trim().length <= 80 &&
      Array.isArray(input.ids) && input.ids.length <= 24 && input.ids.length > 0 && input.ids.every(validId)) {
      const name = input.name.trim(), ids = [...new Set<string>(input.ids)], groupId = validId(input.groupId) ? input.groupId : null;
      await db().$transaction(async tx => {
        if (await tx.socialAccount.count({ where: { id: { in: ids } } }) !== ids.length) throw new ClipError(400, "Some accounts no longer exist.");
        if (await tx.accountGroup.count({ where: { name, ...(groupId ? { id: { not: groupId } } : {}) } })) throw new ClipError(409, "An account group already uses this name.");
        const members = { create: ids.map(accountId => ({ accountId })) };
        if (groupId) {
          await tx.accountGroupMember.deleteMany({ where: { groupId } });
          await tx.accountGroup.update({ where: { id: groupId }, data: { name, members } });
        } else await tx.accountGroup.create({ data: { name, members } });
      });
      return Response.json({});
    }
    throw new ClipError(400, "Choose a valid account or group action.");
  } catch (error) {
    if (error instanceof ProviderError) return clipError(new ClipError(422, error.message));
    return clipError(error);
  }
}
