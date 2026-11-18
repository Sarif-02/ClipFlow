"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FilmStripIcon } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { ClipPreview, ClipThumbnail } from "@/components/clips/clip-preview";
import { UploadButton } from "@/components/clips/upload";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { formatDuration, formatResolution, type ClipInfo } from "@/lib/clips/types";
import { blankContent, displayTime, limits, platformName, platforms, publishingContent, schedule, targetPublishingContent, titleFromClipName, wallTime, youtubeMetadataIssues, type Content, type Destination, type DraftForm, type DraftPost, type SavedDraft, type ScheduleMode } from "@/lib/planning/model";
import { renderTemplate, templateKinds, type Template } from "@/lib/planning/templates";
import { ContentFields, ContentSummary, fieldsByPlatform } from "./content-fields";
import { planningRequest } from "./draft-actions";
import { GeminiPanel } from "./gemini-panel";

const steps = ["Select clips", "Select accounts", "Prepare content", "Schedule", "Review"];
type Props = { initial: DraftForm | SavedDraft; clips: ClipInfo[]; missing: string[]; accounts: Destination[];
  groups: { id: string; name: string; accountIds: string[] }[]; uploadLimit: number; templates: Template[]; preferredTemplate: string;
  gemini: { ready: boolean; model?: string; used: number }; assemblyReady: boolean };

export function Wizard({ initial, clips, missing, accounts, groups, uploadLimit, templates, preferredTemplate, gemini, assemblyReady }: Props) {
  const [form, setForm] = useState<DraftForm | SavedDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [removeAfterPublish, setRemoveAfterPublish] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submission, setSubmission] = useState<{ id: string; revision: number; key: string; removeAfterPublish: boolean } | null>(null);
  const [search, setSearch] = useState("");
  const [clipKey, setClipKey] = useState("");
  const [accountChoice, setAccountChoice] = useState("");
  const [templateId, setTemplateId] = useState(preferredTemplate || templates.find(item => item.isDefault && item.kind === "PRESET")?.id ||
    templates.find(item => item.isDefault)?.id || "");
  const [context, setContext] = useState("");
  const [transcripts, setTranscripts] = useState<Record<string, string>>({});
  const [undo, setUndo] = useState<{ posts: DraftPost[]; intervalMinutes: number }>();
  const [templateNotice, setTemplateNotice] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const router = useRouter();
  const activePost = form.posts.find(post => post.clipKey === clipKey) ?? form.posts[0];
  const suggestedTitle = activePost && titleFromClipName(activePost.filename);
  const catalog = new Map(clips.map(clip => [clip.id, clip]));
  const directory = new Map(accounts.map(account => [account.id, account]));
  const missingIds = new Set(missing);
  const unavailable = form.posts.filter(post => !catalog.has(post.clipKey) || missingIds.has(post.clipKey) || catalog.get(post.clipKey)?.status === "INVALID");
  const potential = form.posts.filter(post => !post.cancelled && !unavailable.includes(post))
    .reduce((total, post) => total + post.targets.filter(target => directory.get(target.accountId)?.connected).length, 0);
  const plan = schedule(form);
  const selectedOverride = activePost?.targets.find(target => target.accountId === accountChoice);
  const selectedAccount = directory.get(accountChoice);
  const selectedTemplate = templates.find(item => item.id === templateId);
  const presetGroup = groups.find(group => group.id === selectedTemplate?.values.groupId);
  const id = "id" in form ? form.id : undefined;
  const metadataWarnings = form.posts.flatMap(post => post.cancelled ? [] : post.targets.flatMap(target => {
    const account = directory.get(target.accountId);
    if (!account?.connected) return [];
    const content = targetPublishingContent(post.content, target.override, post.filename);
    const issues = account.platform === "YOUTUBE" ? youtubeMetadataIssues(content) :
      [content.caption.trim(), content.hashtags.trim()].filter(Boolean).join("\n\n").length > 2200 ? ["Shorten the caption and hashtags to 2200 characters."] : [];
    return issues.length ? [{ post, account, target, issues }] : [];
  }));
  const canSubmit = potential > 0 && !unavailable.length && !plan.warning &&
    !metadataWarnings.length &&
    form.posts.filter(post => !post.cancelled).every(post => catalog.get(post.clipKey)?.status === "READY" && post.targets.length > 0 &&
      post.targets.every(target => directory.get(target.accountId)?.connected));

  function update(patch: Partial<DraftForm>, preserveUndo = false) {
    if (!preserveUndo && (patch.posts || patch.intervalMinutes !== undefined)) setUndo(undefined);
    setSubmission(null); setError(""); setMessage(""); setForm(current => ({ ...current, ...patch }));
  }
  function updatePost(key: string, change: (post: DraftPost) => DraftPost) {
    update({ posts: form.posts.map(post => post.clipKey === key ? change(post) : post) });
  }
  function applySuggestion(clipId: string, suggestion: Partial<Content>, targetId?: string) {
    const account = targetId ? directory.get(targetId) : undefined;
    const patch = account ? Object.fromEntries(Object.entries(suggestion).filter(([field]) => fieldsByPlatform[account.platform].includes(field as keyof Content))) : suggestion;
    setUndo({ posts: form.posts, intervalMinutes: form.intervalMinutes });
    update({ posts: form.posts.map(post => post.clipKey !== clipId ? post : targetId ? {
      ...post, targets: post.targets.map(target => target.accountId === targetId ? { ...target, override: { ...target.override, ...patch } } : target),
    } : { ...post, content: { ...post.content, ...patch } }) }, true);
  }
  function applyTemplate() {
    if (!selectedTemplate || !activePost) return;
    if (selectedTemplate.kind === "AI") { setTemplateNotice("These instructions will be included in Gemini requests."); return; }
    const { values, kind } = selectedTemplate;
    if (values.groupId && !presetGroup?.accountIds.length) { setError("This preset’s account group has no available publishing destinations."); return; }
    const linked = templates.find(item => item.id === values.templateId);
    const fields = Object.entries({ ...linked?.values.content, ...values.content }) as [keyof Content, string][];
    let problem = "";
    const posts = form.posts.map(post => {
      if (post.cancelled || (kind !== "PRESET" && post.clipKey !== activePost.clipKey)) return post;
      const clip = catalog.get(post.clipKey);
      const groupIds = presetGroup?.accountIds ?? [];
      const targets: DraftPost["targets"] = [...post.targets, ...groupIds.filter(id => !post.targets.some(target => target.accountId === id)).map(accountId => ({ accountId, override: {} }))];
      const content = { ...post.content };
      const resolved = (field: keyof Content, value: string, account?: Destination) => {
        if (!account && /{{\s*(channel_name|platform)\s*}}/.test(value)) { problem = "Select a destination to use the channel name or platform placeholder."; return value; }
        if (!context.trim() && /{{\s*context\s*}}/.test(value)) { problem = "Enter a clip description to use the context placeholder."; return value; }
        const output = renderTemplate(value, { clip_name: clip?.displayName ?? post.filename, source_title: post.filename,
          channel_name: account?.name ?? "", platform: account ? platformName[account.platform] : "", context: context.trim(), date: wallTime(new Date(), form.timezone).slice(0, 10) });
        if (output.length > limits[field]) problem = `A template value is too long for ${field} after expanding its placeholders.`;
        return output;
      };
      for (const [field, value] of fields) if (!/{{\s*(channel_name|platform)\s*}}/.test(value) && !(kind !== "PRESET" && selectedAccount)) content[field] = resolved(field, value);
      if (!targets.length && fields.some(([, value]) => /{{\s*(channel_name|platform)\s*}}/.test(value))) problem = "Select a destination to use the channel name or platform placeholder.";
      return { ...post, content, targets: targets.map(target => {
        const account = directory.get(target.accountId);
        if (!account || (kind !== "PRESET" && selectedAccount && account.id !== selectedAccount.id)) return target;
        const override = { ...target.override };
        for (const [field, value] of fields) if (fieldsByPlatform[account.platform].includes(field) &&
          (kind !== "PRESET" && selectedAccount || /{{\s*(channel_name|platform)\s*}}/.test(value))) override[field] = resolved(field, value, account);
        return { ...target, override };
      }) };
    });
    if (problem) { setError(problem); return; }
    setUndo({ posts: form.posts, intervalMinutes: form.intervalMinutes });
    update({ posts, intervalMinutes: values.interval ?? form.intervalMinutes }, true);
    setTemplateNotice(kind === "PRESET" ? "Preset applied to this draft. Review destinations and timing before scheduling." : "Template applied. Review and edit the metadata below.");
  }
  function destinations(ids: string[], add: boolean) {
    update({ posts: form.posts.map(post => ({
      ...post, targets: add ? [...post.targets, ...ids.filter(id => !post.targets.some(target => target.accountId === id))
        .map(accountId => ({ accountId, override: {} }))] : post.targets.filter(target => !ids.includes(target.accountId)),
    })) });
  }
  function move(step: number) {
    if (step > form.step && form.step === 1 && (!form.posts.length || unavailable.length)) {
      setError("Select at least one available clip. Remove any missing clips before continuing."); return;
    }
    if (step > form.step && form.step === 4 && plan.warning) { setError(plan.warning); return; }
    update({ step });
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function save(complete = false) {
    if (complete && (!form.posts.length || unavailable.length || plan.warning)) {
      setError(plan.warning || "Select available clips before saving from Review.");
      return;
    }
    setSaving(true); setError(""); setMessage("");
    try {
      const saved = await planningRequest(id ? `/api/drafts/${id}` : "/api/drafts", id ? "PATCH" : "POST", { ...form, complete }) as SavedDraft;
      setForm(saved);
      if (!id) router.replace(`/compose?draft=${saved.id}`, { scroll: false });
      setMessage("Draft saved on this computer.");
      if (id) router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Could not save the draft."); }
    finally { setSaving(false); }
  }

  async function submit() {
    setSaving(true); setSubmitting(true); setError("");
    try {
      let pending = submission;
      if (!pending) {
        const saved = await planningRequest(id ? `/api/drafts/${id}` : "/api/drafts", id ? "PATCH" : "POST", { ...form, complete: true }) as SavedDraft;
        setForm(saved);
        pending = { id: saved.id, revision: saved.revision, key: crypto.randomUUID(), removeAfterPublish };
        setSubmission(pending);
      }
      const result = await planningRequest("/api/queue", "POST", { draftId: pending.id, revision: pending.revision, key: pending.key,
        removeAfterPublish: pending.removeAfterPublish });
      setConfirm(false);
      router.push(`/queue?added=${result.count}`);
    } catch (problem) { setError(problem instanceof Error ? problem.message : "The queue submission failed."); }
    finally { setSaving(false); setSubmitting(false); }
  }

  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Create Post</h1>
      <p className="body-6 muted">Prepare content and plan times in a local draft.</p></div>
      <Link className={buttonVariants({ variant: "outline" })} href="/compose">Saved drafts</Link></header>
    <ol className="card wizard-outline" aria-label="Publishing steps">
      {steps.map((step, index) => <li className="title-4" key={step} aria-current={index + 1 === form.step ? "step" : undefined}>
        <span className="caption-3 technical">{index + 1}</span>{step}</li>)}
    </ol>
    <Card className="overview-panel plan-editor">
      <h2 className="dashboard-section" tabIndex={-1} ref={heading}>{steps[form.step - 1]}</h2>
      <fieldset disabled={saving} className="plan-editor">
        <label className="clip-form-label title-4 plan-name">Draft name
          <input className="clip-field body-6" maxLength={120} value={form.name} placeholder="Untitled draft" onChange={event => update({ name: event.target.value })} />
        </label>
        {form.step === 1 && <>
          <div className="plan-actions"><UploadButton limit={uploadLimit} primary={false} />
            <label className="clip-form-label title-4">Find clips<input type="search" className="clip-field body-6" value={search}
              onChange={event => setSearch(event.target.value)} placeholder="Search by filename" /></label></div>
          {unavailable.map(post => <div className="availability body-6" key={post.clipKey}>
            <span>{post.filename || "Selected clip"} is unavailable.</span>
            <Button onClick={() => update({ posts: form.posts.filter(item => item.clipKey !== post.clipKey) })}>Remove selection</Button>
          </div>)}
          {clips.length ? <ul className="plan-list">{clips.filter(clip => clip.displayName.toLowerCase().includes(search.toLowerCase()) ||
            clip.originalFilename.toLowerCase().includes(search.toLowerCase())).map(clip => {
            const checked = form.posts.some(post => post.clipKey === clip.id);
            const disabled = missingIds.has(clip.id) || clip.status === "INVALID";
            return <li key={clip.id} className="plan-row">
              <label className="plan-row-main">
                <input type="checkbox" disabled={disabled || (!checked && form.posts.length >= 30)} checked={checked}
                  onChange={() => update({ posts: checked ? form.posts.filter(post => post.clipKey !== clip.id) :
                    [...form.posts, { clipKey: clip.id, filename: clip.originalFilename, content: { ...blankContent },
                      targets: (form.posts[0]?.targets ?? []).map(target => ({ accountId: target.accountId, override: {} })), plannedAt: null, cancelled: false }] })} />
                <ClipThumbnail clip={clip} /><span><span className="title-4">{clip.displayName}</span>
                  <span className="caption-5 muted technical">{disabled ? "File unavailable" : `${formatDuration(clip.duration)} · ${formatResolution(clip)}`}</span></span>
              </label>
              {!disabled && <ClipPreview clip={clip} />}
            </li>;
          })}</ul> : <EmptyState icon={<FilmStripIcon size={24} />} title="No clips yet" description="Upload an MP4 or save this draft and return later." />}
          <p className="caption-5 muted">{form.posts.length} selected. Bulk posting follows selection order.</p>
        </>}
        {form.step === 2 && <>
          {!accounts.some(account => account.connected) && <p className="availability body-6">No accounts are connected. You can continue planning or save an incomplete draft.</p>}
          {groups.length > 0 && <div className="plan-actions">{groups.map(group => <Button key={group.name}
            onClick={() => destinations(group.accountIds, true)}>Select {group.name}</Button>)}</div>}
          {platforms.map(platform => <div className="plan-stack" key={platform}>
            <h3 className="title-3">{platformName[platform]}</h3>
            {accounts.filter(account => account.platform === platform).map(account =>
              <label key={account.id} className="body-6 plan-check"><input type="checkbox" disabled={!account.connected}
                checked={form.posts.length > 0 && form.posts.every(post => post.targets.some(target => target.accountId === account.id))}
                onChange={event => destinations([account.id], event.target.checked)} /> {account.name}{!account.connected && " · Disconnected"}</label>)}
            {!accounts.some(account => account.platform === platform) && <p className="caption-2 muted">No {platformName[platform]} accounts available.</p>}
          </div>)}
        </>}
        {form.step === 3 && <>
          {activePost ? <>
            <label className="clip-form-label title-4 plan-name">Edit metadata for clip
              <select className="clip-field body-6" value={activePost.clipKey} onChange={event => { setClipKey(event.target.value); setAccountChoice(""); }}>
                {form.posts.map(post => <option value={post.clipKey} key={post.clipKey}>{post.filename}</option>)}
              </select>
            </label>
            <label className="clip-form-label title-4 plan-name">Metadata scope
              <select className="clip-field body-6" value={selectedOverride ? accountChoice : ""} onChange={event => setAccountChoice(event.target.value)}>
                <option value="">Platform defaults for this clip</option>
                {activePost.targets.map(target => <option key={target.accountId} value={target.accountId}>{directory.get(target.accountId)?.name ?? "Unavailable account"}</option>)}
              </select>
            </label>
            <div className="plan-stack">
              <label className="clip-form-label title-4 plan-name">Template or preset<select className="clip-field body-6" value={templateId}
                onChange={event => { setTemplateId(event.target.value); setTemplateNotice(""); }}><option value="">No template</option>
                {templates.map(item => <option key={item.id} value={item.id}>{item.name} · {templateKinds[item.kind]}{item.isDefault ? " · Default" : ""}</option>)}</select></label>
              {selectedTemplate?.kind === "PRESET" && <p className="caption-2 muted">{presetGroup?.accountIds.length ?
                `Adds ${presetGroup.accountIds.map(id => directory.get(id)?.name).filter(Boolean).join(", ")} to each clip. ` : ""}
                {selectedTemplate.values.interval ? `Sets the bulk posting interval to ${selectedTemplate.values.interval} minutes. ` : ""}Review all destinations on the final step.</p>}
              <div className="plan-actions">{selectedTemplate && <Button onClick={applyTemplate}>{selectedTemplate.kind === "PRESET" ? "Apply preset" : "Apply template"}</Button>}
                <Link href="/templates" className="workspace-link caption-2">Manage templates</Link>
                {undo && <Button onClick={() => { update(undo); setUndo(undefined); setTemplateNotice("Previous content restored."); }}>Restore previous content</Button>}</div>
              {templateNotice && <p role="status" className="caption-2 tone-success">{templateNotice}</p>}
            </div>
            {selectedAccount && selectedOverride ? <ContentFields platform={selectedAccount.platform} value={selectedOverride.override}
              inherited={publishingContent(activePost.content)} suggestedTitle={suggestedTitle} update={(key, value) => updatePost(activePost.clipKey, post => ({ ...post,
                targets: post.targets.map(target => {
                  if (target.accountId !== accountChoice) return target;
                  const override = { ...target.override };
                  if (value === undefined) delete override[key]; else override[key] = value;
                  return { ...target, override };
                }) }))} /> : platforms.map(platform => <section className="plan-stack" key={platform}>
                  <h3 className="title-3">{platformName[platform]}</h3>
                  <ContentFields platform={platform} value={publishingContent(activePost.content)} suggestedTitle={suggestedTitle} update={(key, value) =>
                    updatePost(activePost.clipKey, post => ({ ...post, content: { ...post.content, [key]: value ?? "" } }))} />
                </section>)}
            <GeminiPanel post={activePost} posts={form.posts} clip={catalog.get(activePost.clipKey)} {...gemini} context={context} onContext={setContext}
              transcripts={transcripts} onTranscript={(id, text) => setTranscripts(current => ({ ...current, [id]: text }))}
              assemblyReady={assemblyReady} accountId={selectedOverride?.accountId} templateId={templateId} onApply={applySuggestion} />
          </> : <p className="body-6 muted">Select a clip to prepare its metadata.</p>}
        </>}
        {form.step === 4 && <>
          <p className="body-6 muted">Timezone: <span className="technical">{form.timezone}</span>. Calendar entries are local plans.</p>
          <label className="clip-form-label title-4 plan-name">Timing
            <select className="clip-field body-6" value={form.scheduleMode} onChange={event => update({
              scheduleMode: event.target.value as ScheduleMode, posts: form.posts.map(post => ({ ...post, cancelled: false })),
            })}>
              <option value="NOW">Publish now</option><option value="AT">Schedule a date and time</option>
              <option value="BULK">Plan at intervals</option>{form.scheduleMode === "CUSTOM" && <option value="CUSTOM">Custom times from Calendar</option>}
            </select>
          </label>
          {["AT", "BULK"].includes(form.scheduleMode) && <label className="clip-form-label title-4 plan-name">Planned start
            <input className="clip-field body-6 technical" type="datetime-local" value={form.scheduleLocal}
              onChange={event => update({ scheduleLocal: event.target.value })} /></label>}
          {form.scheduleMode === "BULK" && <label className="clip-form-label title-4 plan-name">Interval in minutes
            <input className="clip-field body-6 technical" type="number" min={1} max={10080} step={1} value={form.intervalMinutes || ""}
              onChange={event => update({ intervalMinutes: Number(event.target.value) })} /></label>}
          {form.posts.length > 0 && <ul className="plan-list">{form.posts.map((post, index) => <li key={post.clipKey} className="plan-row body-6">
            <span>{post.filename}</span><span className="technical muted">{post.cancelled ? "Cancelled" : displayTime(plan.times[index], form.timezone)}</span>
          </li>)}</ul>}
          {plan.warning && <p className="caption-2 form-error">{plan.warning}</p>}
          <p className="body-6">Destination publications: <strong className="technical">{potential}</strong> · {form.posts.filter(post => !post.cancelled).length} clips</p>
        </>}
        {form.step === 5 && <>
          <p className="availability body-6">Saving keeps this as a draft. Confirming sends the selected destinations to the publishing worker.</p>
          <p className="body-6">Destination publications: <strong className="technical">{potential}</strong></p>
          {!potential && <p className="body-6 muted">No eligible destination accounts are selected. This draft can still be saved.</p>}
          {plan.warning && <p className="body-6 form-error">{plan.warning}</p>}
          {metadataWarnings.length > 0 && <ul className="plan-list">{metadataWarnings.map(({ post, account, target, issues }) => <li className="plan-row" key={`${post.clipKey}:${account.id}`}>
            <div><p className="title-4">{post.filename} · {account.name}</p><p className="caption-2 form-error">{issues.join(" ")}</p></div>
            <Button onClick={() => { setClipKey(post.clipKey); setAccountChoice(Object.keys(target.override).length ? account.id : ""); move(3); }}>Edit publishing details</Button>
          </li>)}</ul>}
          {unavailable.length > 0 && <p className="body-6 form-error">One or more selected clips are missing. Return to Select clips to fix this.</p>}
          {form.posts.map((post, index) => <section className="card overview-panel plan-stack" key={post.clipKey}>
            <div className="plan-row"><div><h3 className="title-3">{post.filename}</h3>
              <p className="caption-5 muted technical">{post.cancelled ? "Cancelled" : form.scheduleMode === "NOW" ? "Publish now intent · Not queued" : displayTime(plan.times[index], form.timezone)}</p></div>
              {catalog.has(post.clipKey) && !missingIds.has(post.clipKey) && <ClipPreview clip={catalog.get(post.clipKey)!} />}</div>
            {!post.cancelled && post.targets.some(target => directory.get(target.accountId)?.platform === "YOUTUBE") && <>
              <ContentFields platform="YOUTUBE" value={publishingContent(post.content)} fields={["title", "audience", "visibility"]}
                suggestedTitle={titleFromClipName(post.filename)} update={(key, value) => updatePost(post.clipKey, current => ({
                  ...current, content: { ...current.content, [key]: value ?? "" },
                  targets: key === "audience" && value ? current.targets.map(target => target.override.audience === ""
                    ? { ...target, override: { ...target.override, audience: value } } : target) : current.targets,
                }))} />
              <div className="plan-actions"><Button className="tone-ai" onClick={() => {
                setClipKey(post.clipKey); setAccountChoice(""); move(3);
                requestAnimationFrame(() => document.getElementById("gemini-title")?.focus());
              }}>Write with Gemini</Button></div>
            </>}
            {platforms.map(platform => <details key={platform}><summary className="title-4">{platformName[platform]} defaults</summary>
              <ContentSummary content={publishingContent(post.content, platform === "YOUTUBE" ? post.filename : undefined)} platform={platform} /></details>)}
            {post.targets.map(target => {
              const account = directory.get(target.accountId);
              return account ? <details key={target.accountId}><summary className="title-4">{account.name} · {platformName[account.platform]}{!account.connected && " · Disconnected"}</summary>
                <ContentSummary content={targetPublishingContent(post.content, target.override, post.filename)} platform={account.platform} /></details> :
                <p key={target.accountId} className="caption-2 muted">Destination unavailable</p>;
            })}
          </section>)}
          {!canSubmit && <p className="caption-2 muted">Resolve the issues above to enable publishing.</p>}
        </>}
      </fieldset>
      {error && <p role="alert" className="body-6 form-error">{error}</p>}
      {message && <p role="status" className="body-6">{message}</p>}
      <footer className="plan-actions plan-footer">
        {form.step > 1 && <Button disabled={saving} onClick={() => move(form.step - 1)}>Back</Button>}
        <Button disabled={saving} variant="outline" onClick={() => void save(form.step === 5)}>
          {saving && !submitting ? "Saving" : form.step === 5 ? "Save reviewed draft" : "Save draft"}</Button>
        {form.step === 3 && form.scheduleMode === "NOW" && <Button disabled={saving} onClick={() => move(4)}>Set a schedule</Button>}
        {form.step < 5 && <Button disabled={saving} variant="primary" onClick={() => move(form.step === 3 && form.scheduleMode === "NOW" ? 5 : form.step + 1)}>
          {form.step === 3 && form.scheduleMode === "NOW" ? "Review and publish" : "Continue"}
        </Button>}
        {form.step === 5 && <Modal title={form.scheduleMode === "NOW" ? "Confirm publication" : "Confirm schedule"}
          description={`This creates ${potential} destination jobs across ${form.posts.filter(post => !post.cancelled).length} clips. The worker may publish them externally.`}
          open={confirm} busy={saving} onOpenChange={setConfirm}
          trigger={<Button disabled={!canSubmit || saving} variant="primary">{form.scheduleMode === "NOW" ? "Publish now" : "Schedule publications"}</Button>}>
          <div className="clip-dialog-body">
            <fieldset className="plan-stack" disabled={saving || Boolean(submission)} aria-describedby="publication-retention-help">
              <legend className="title-4 mb-2">After publishing</legend>
              <label className="body-6 plan-check"><input type="radio" name="publication-retention" checked={!removeAfterPublish}
                onChange={() => setRemoveAfterPublish(false)} /> Keep in Clip Library</label>
              <label className="body-6 plan-check"><input type="radio" name="publication-retention" checked={removeAfterPublish}
                onChange={() => setRemoveAfterPublish(true)} /> Remove from Clip Library</label>
              <p className="caption-2 muted" id="publication-retention-help">Removal waits for every destination to succeed and for any drafts or pending posts using these clips. Publication history and original files are kept.</p>
            </fieldset>
          </div>
          {error && <p className="clip-dialog-body body-6 form-error" role="alert">{error}</p>}
          <div className="clip-dialog-footer"><Button disabled={saving} onClick={() => {
            setConfirm(false); setSubmission(null); setError(""); if (id) router.replace(`/compose?draft=${id}`);
          }}>Keep editing</Button>
            <Button disabled={saving} variant="primary" onClick={() => void submit()}>{saving ? "Submitting" : "Confirm and queue"}</Button></div>
        </Modal>}
      </footer>
    </Card>
  </div>;
}
