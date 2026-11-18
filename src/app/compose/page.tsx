import { NotePencilIcon } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { DraftActions } from "@/components/planning/draft-actions";
import { Wizard } from "@/components/planning/wizard";
import { db } from "@/lib/clips/db";
import { hasClipMedia, listClips } from "@/lib/clips/storage";
import { loadDraft, validId } from "@/lib/planning/drafts";
import { blankContent, displayTime, emptyDraft, platforms, type Platform } from "@/lib/planning/model";
import { providerConfig, runtimeSettings } from "@/lib/integrations/config";
import { supportsClipGeneration } from "@/lib/integrations/ai-model";
import { aiRequestCount } from "@/lib/integrations/gemini";
import { listTemplates } from "@/lib/planning/template-store";

export const metadata = { title: "Create Post" };

async function ComposeData({ searchParams }: { searchParams: PageProps<"/compose">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const draftId = typeof params.draft === "string" ? params.draft : null;
  const focusClip = validId(params.clip) ? params.clip : null;
  const preferredTemplate = validId(params.template) ? params.template : "";
  if (draftId || params.new === "1" || focusClip) {
    const [draft, clips, accounts, groups, settings, templates, gemini, used, assemblyReady] = await Promise.all([
      draftId ? loadDraft(draftId) : runtimeSettings().then(settings => emptyDraft(settings.timezone)),
      listClips(), db().socialAccount.findMany({ where: { platform: { in: [...platforms] } }, orderBy: { name: "asc" } }),
      db().accountGroup.findMany({ orderBy: { name: "asc" }, include: { members: { select: { accountId: true } } } }),
      runtimeSettings(), listTemplates(), providerConfig("GEMINI").then(config => ({ model: config.values.model,
        ready: Boolean(config.secret && supportsClipGeneration(config.values.model)) })).catch(() => ({ ready: false })), aiRequestCount(),
      providerConfig("ASSEMBLYAI").then(config => Boolean(config.secret)).catch(() => false),
    ]);
    if (!draft) return <Card className="not-found"><h1 className="heading-4">Draft not found</h1>
      <p className="body-6 muted">The draft may have been deleted.</p>
      <Link href="/compose" className={buttonVariants()}>Back to saved drafts</Link></Card>;
    const missing: string[] = [];
    for (let start = 0; start < clips.length; start += 24) {
      const batch = clips.slice(start, start + 24);
      const results = await Promise.all(batch.map(clip => hasClipMedia(clip.id)));
      batch.forEach((clip, index) => { if (!results[index]) missing.push(clip.id); });
    }
    const selected = focusClip && clips.find(clip => clip.id === focusClip && clip.status !== "INVALID" && !missing.includes(clip.id));
    if (!draftId && selected) draft.posts = [{ clipKey: selected.id, filename: selected.originalFilename,
      content: { ...blankContent }, targets: [], cancelled: false, plannedAt: null }];
    if (preferredTemplate && draft.posts.length && templates.some(template => template.id === preferredTemplate)) draft.step = 3;
    const connected = new Set(accounts.filter(account => account.status === "CONNECTED" && account.canPublish).map(account => account.id));
    return <Wizard key={`${draftId ?? focusClip ?? "new"}:${preferredTemplate}`} initial={draft} clips={clips} missing={missing} uploadLimit={settings.uploadMib * 1048576}
      templates={templates} preferredTemplate={preferredTemplate} gemini={{ ...gemini, used }} assemblyReady={assemblyReady}
      accounts={accounts.map(account => ({ id: account.id, name: account.name, platform: account.platform as Platform, connected: connected.has(account.id) }))}
      groups={groups.map(group => ({ id: group.id, name: group.name, accountIds: group.members.map(member => member.accountId).filter(id => connected.has(id)) })).filter(group => group.accountIds.length)} />;
  }
  const drafts = await db().publishingDraft.findMany({ where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { posts: true } } } });
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Create Post</h1>
      <p className="body-6 muted">Start a local draft or continue preparing a saved post.</p></div>
      <Link href="/compose?new=1" className={buttonVariants({ variant: "primary" })}>New draft</Link></header>
    <Card className="overview-panel plan-stack" aria-labelledby="saved-drafts">
      <h2 className="dashboard-section" id="saved-drafts">Saved drafts</h2>
      {drafts.length ? <ul className="plan-list">{drafts.map(draft => <li className="plan-row" key={draft.id}>
        <div><Link href={`/compose?draft=${draft.id}`} className="workspace-link title-4">{draft.name}</Link>
          <p className="caption-5 muted">{draft._count.posts} clips · Step {draft.step} of 5 · {displayTime(draft.updatedAt.toISOString(), draft.timezone)}</p></div>
        <DraftActions id={draft.id} name={draft.name} />
      </li>)}</ul> : <EmptyState icon={<NotePencilIcon size={24} />} title="No drafts yet" description="Create a draft to select clips, prepare captions, and plan posting times." />}
    </Card>
  </div>;
}

export default function Page({ searchParams }: PageProps<"/compose">) {
  return <Suspense fallback={<WorkspaceLoading />}><ComposeData searchParams={searchParams} /></Suspense>;
}
