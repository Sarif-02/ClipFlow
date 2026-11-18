import { Suspense } from "react";
import { connection } from "next/server";
import { Accounts } from "@/components/integrations/accounts";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { db } from "@/lib/clips/db";
import { providerConfig, runtimeSettings } from "@/lib/integrations/config";
import { cachedReports } from "@/lib/analytics/cache";
import { count } from "@/lib/analytics/model";
import { platforms, type Platform } from "@/lib/planning/model";

export const metadata = { title: "Accounts" };

const messages: Record<string, string> = { connected: "Account authorization and identity check succeeded.", denied: "Authorization was declined or no code was returned.",
  session: "Authorization session could not be verified. Start the connection again.", api: "Enable the required API and try again.",
  network: "Could not reach the provider. Try again.", credentials: "The provider rejected the credentials.", quota: "The provider rate limited the request.",
  permissions: "The account did not grant the required permissions.", provider: "The provider could not verify an eligible account. Check app access, permissions, and the selected account." };
async function AccountData({ searchParams }: { searchParams: PageProps<"/accounts">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const [accounts, groups, jobs, settings, reports, googleMode] = await Promise.all([
    db().socialAccount.findMany({ where: { platform: { in: [...platforms] } }, orderBy: { name: "asc" },
      include: { credential: { select: { expiresAt: true, refreshedAt: true } } } }),
    db().accountGroup.findMany({ include: { members: { select: { accountId: true } } }, orderBy: { name: "asc" } }),
    db().job.findMany({ where: { state: { notIn: ["PUBLISHED", "FAILED", "CANCELLED", "NEEDS_REVIEW"] } }, select: { target: { select: { accountId: true } } } }),
    runtimeSettings(), cachedReports(null), providerConfig("YOUTUBE").then(config => config.values.googleMode).catch(() => undefined),
  ]);
  const stats = Object.fromEntries(reports.flatMap(report => report.currentChannel ? [[report.id,
    `Lifetime views: ${count(report.currentChannel.views)} · Videos: ${count(report.currentChannel.videos)} · Subscribers: ${report.currentChannel.hiddenSubscribers ? "Hidden" : count(report.currentChannel.subscribers)}`]] : []));
  return <Accounts accounts={accounts.map(account => ({ id: account.id, name: account.name, platform: account.platform as Platform, remoteId: account.remoteId,
    avatar: account.avatar, status: account.status, canPublish: account.canPublish, canAnalyze: account.canAnalyze, verifiedAt: account.verifiedAt?.toISOString() ?? null,
    expiresAt: account.credential?.expiresAt?.toISOString() ?? null, refreshedAt: account.credential?.refreshedAt?.toISOString() ?? null,
    lastApiAt: (account.lastApiAt ?? account.verifiedAt)?.toISOString() ?? null, issue: account.authIssue,
    queued: jobs.filter(job => job.target.accountId === account.id).length }))}
    groups={groups.map(group => ({ id: group.id, name: group.name, ids: group.members.map(member => member.accountId) }))}
    stats={stats} timezone={settings.timezone} googleMode={googleMode} notice={typeof params.oauth === "string" && Object.hasOwn(messages, params.oauth) ? messages[params.oauth] : ""} />;
}
export default function Page({ searchParams }: PageProps<"/accounts">) {
  return <Suspense fallback={<WorkspaceLoading />}><AccountData searchParams={searchParams} /></Suspense>;
}
