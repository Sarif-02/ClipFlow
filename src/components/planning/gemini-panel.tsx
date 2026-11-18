"use client";

import Link from "next/link";
import { SparkleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Status } from "@/components/ui/status";
import type { ClipInfo } from "@/lib/clips/types";
import { aiStyles, freeGeminiModels, inlineVideoBytes, inlineVideoSeconds, localDailyAiRequests } from "@/lib/integrations/ai-model";
import type { Content, DraftPost } from "@/lib/planning/model";
import type { TemplateField } from "@/lib/planning/templates";
import { TranscriptionInput } from "./transcription-input";

const actions = { all: "Generate all content", title: "Generate title", description: "Generate description", tags: "Generate tags", caption: "Generate caption", hashtags: "Generate hashtags" } as const;
type Field = keyof typeof actions;
type Suggestion = Partial<Record<TemplateField, string>>;
type Result = { state: "waiting" | "generating" | "done" | "failed" | "cancelled" | "applied"; data?: Suggestion; error?: string; cached?: boolean; accountId?: string };
type Batch = { ids: string[]; field: Field; video: boolean; accountId?: string };

export function GeminiPanel({ post, posts, clip, model, ready, used, templateId, accountId, context, onContext, onApply, transcripts, onTranscript, assemblyReady }: {
  post: DraftPost; posts: DraftPost[]; clip?: ClipInfo; model?: string; ready: boolean; used: number; templateId: string; accountId?: string;
  context: string; onContext: (value: string) => void; onApply: (clipId: string, data: Partial<Content>, accountId?: string) => void;
  transcripts: Record<string, string>; onTranscript: (id: string, text: string) => void; assemblyReady: boolean;
}) {
  const [style, setStyle] = useState<typeof aiStyles[number]>("Engaging");
  const [selectedModel, setSelectedModel] = useState("");
  const [instructions, setInstructions] = useState("");
  const [selection, setSelection] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, Result>>({});
  const [usage, setUsage] = useState(used);
  const [busy, setBusy] = useState(false);
  const [videoConfirm, setVideoConfirm] = useState(false);
  const running = useRef<AbortController | null>(null);
  const [last, setLast] = useState<Batch | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const eligibleVideo = clip?.status === "READY" && clip.size <= inlineVideoBytes && Boolean(clip.duration && clip.duration <= inlineVideoSeconds);
  const selectable = posts.filter(item => !item.cancelled);
  function setOne(id: string, result: Result) { setResults(current => ({ ...current, [id]: result })); }

  async function run(batch: Batch, regenerate = false, retry = false) {
    if (!ready || running.current || !batch.ids.length) return;
    const controller = new AbortController();
    running.current = controller;
    if (!retry) setLast(batch);
    setBusy(true);
    setResults(current => ({ ...current, ...Object.fromEntries(batch.ids.map(id => [id, { state: "waiting" }])) }));
    const pending = [...batch.ids];
    async function next() {
      while (pending.length && !controller.signal.aborted) {
        const id = pending.shift()!;
        const selected = posts.find(item => item.clipKey === id);
        if (!selected) { setOne(id, { state: "failed", error: "That clip is no longer selected." }); continue; }
        const target = selected.targets.find(item => item.accountId === batch.accountId);
        setOne(id, { state: "generating" });
        try {
          const response = await fetch("/api/ai", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({
            clipId: id, field: batch.field, style, model: selectedModel || undefined, description: context, transcript: transcripts[id], instructions, templateId,
            existing: { ...selected.content, ...target?.override }, video: batch.video, videoConsent: batch.video, regenerate,
          }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error ?? "Gemini could not generate suggestions.");
          setUsage(current => Math.max(current, data.used));
          setOne(id, { state: "done", data: data.suggestion, cached: data.cached, accountId: target?.accountId });
        } catch (error) {
          setOne(id, controller.signal.aborted ? { state: "cancelled" } : { state: "failed", error: error instanceof Error ? error.message : "Generation failed." });
        }
      }
    }
    try { await Promise.all([next(), next()]); }
    finally {
      for (const id of pending) setOne(id, { state: "cancelled" });
      running.current = null; setBusy(false);
    }
  }

  const failed = last?.ids.filter(id => results[id]?.state === "failed" || results[id]?.state === "cancelled") ?? [];
  const rows = posts.filter(item => results[item.clipKey]);
  return <Card className="overview-panel plan-stack ai-panel" aria-labelledby="gemini-title">
    <div className="plan-row"><h3 className="dashboard-section plan-avatar" id="gemini-title" tabIndex={-1}><SparkleIcon size={20} aria-hidden="true" className="tone-ai" /> Gemini suggestions</h3>
      <Status state={busy ? "GENERATING" : ready ? "READY" : "NOT_CONFIGURED"}>{busy ? "Generating" : ready ? "Ready" : "Setup required"}</Status></div>
    <label className="clip-form-label title-4">Clip description or shared batch context<textarea className="clip-field body-6" rows={2} maxLength={2500} value={context} onChange={event => onContext(event.target.value)} /></label>
    <TranscriptionInput clip={clip} ready={assemblyReady} text={transcripts[post.clipKey] ?? ""} onChange={onTranscript} />
    {!ready ? <p className="body-6 muted">Choose a supported Gemini model and verify your key in <Link href="/integrations" className="workspace-link">Integrations</Link>.</p> : <>
      <label className="clip-form-label title-4 plan-name">Gemini model<select className="clip-field body-6" aria-label="Gemini model" value={selectedModel} disabled={busy}
        onChange={event => setSelectedModel(event.target.value)}>
        <option value="">{model} (saved default)</option>{freeGeminiModels.filter(item => item !== model).map(item => <option value={item} key={item}>{item}</option>)}
      </select></label>
      <p className="caption-2 muted">{usage} of {localDailyAiRequests} local requests today. The provider applies its own limits.</p>
      <p className="caption-2 muted">Generation sends the text below, the filename, and relevant draft fields to Google. Verify your project uses free tier before generating.</p>
      <details><summary className="title-4">Generation instructions</summary><div className="plan-stack settings-note">
        <label className="clip-form-label title-4">Custom instructions<textarea className="clip-field body-6" rows={2} maxLength={2000} value={instructions} onChange={event => setInstructions(event.target.value)} /></label>
      </div></details>
      <label className="clip-form-label title-4 plan-name">Content style<select className="clip-field body-6" value={style} onChange={event => setStyle(event.target.value as typeof style)}>
        {aiStyles.map(item => <option key={item}>{item}</option>)}
      </select></label>
      <div className="plan-actions" aria-label="Generation actions">
        {Object.entries(actions).map(([field, label]) => <Button className={field === "all" ? "tone-ai" : undefined} key={field} disabled={busy || post.cancelled}
          onClick={() => void run({ ids: [post.clipKey], field: field as Field, video: false, accountId })}>{label}</Button>)}
        {eligibleVideo && <Button className="tone-ai" disabled={busy || post.cancelled} onClick={() => setVideoConfirm(true)}>Analyze video</Button>}
        {last && !last.video && <Button disabled={busy} onClick={() => void run(last, true)}>Regenerate</Button>}
        {busy && <Button onClick={() => running.current?.abort()}>Cancel generation</Button>}
      </div>
      {!eligibleVideo && <p className="caption-5 muted">Video analysis is available for MP4s up to 8 MiB and 60 seconds.</p>}
      {selectable.length > 1 && <details><summary className="title-4">Generate for multiple clips</summary>
        <div className="plan-stack settings-note">{selectable.map(item => <label className="plan-check body-6" key={item.clipKey}>
          <input type="checkbox" checked={selection.includes(item.clipKey)} onChange={event => setSelection(event.target.checked ? [...selection, item.clipKey] : selection.filter(id => id !== item.clipKey))} />{item.filename}
        </label>)}<div className="plan-actions"><Button className="tone-ai" disabled={busy || !selection.length} onClick={() => void run({ ids: selection, field: "all", video: false })}>Generate for selected clips</Button>
          <Button disabled={busy} onClick={() => setSelection(selectable.map(item => item.clipKey))}>Select all clips</Button></div></div>
      </details>}
      {rows.length > 0 && <ul className="plan-list" aria-label="Generation results" aria-live="polite">{rows.map(item => {
        const result = results[item.clipKey];
        return <li className="plan-stack ai-result" key={item.clipKey}><div className="plan-row"><p className="title-4">{item.filename}</p>
          <Status state={result.state === "done" ? "SUGGESTION" : result.state === "applied" ? "DONE" : result.state === "failed" ? "FAILED" : result.state === "generating" ? "GENERATING" : "QUEUED"}>
            {{ waiting: "Waiting", generating: "Generating", done: result.cached ? "Cached suggestion" : "Suggestion ready", failed: "Generation failed", cancelled: "Cancelled", applied: "Applied" }[result.state]}
          </Status></div>
          {result.error && <p className="caption-2 form-error">{result.error}</p>}
          {result.data && result.state === "done" && <><dl className="plan-stack">{Object.entries(result.data).map(([field, value]) => <div key={field}>
            <dt className="caption-3 muted">{actions[field as TemplateField].replace("Generate ", "")}</dt><dd className="body-6 ai-copy">{value}</dd></div>)}</dl>
          <div><Button className="tone-ai" onClick={() => { onApply(item.clipKey, result.data!, result.accountId); setOne(item.clipKey, { ...result, state: "applied" }); }}>Apply suggestion</Button></div></>}
        </li>;
      })}</ul>}
      {failed.length > 0 && last && !last.video && <div><Button disabled={busy} onClick={() => void run({ ...last, ids: failed }, false, true)}>Retry unsuccessful clips</Button></div>}
    </>}
    {videoConfirm && <Modal open onOpenChange={open => { if (!open) setVideoConfirm(false); }} title="Send this video to Gemini?"
      description={`Google will receive ${post.filename} for analysis. Google may use content sent through unpaid services to improve its products. Choose a description instead for private material.`}>
      <div className="clip-dialog-body"><a className="workspace-link body-6" href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noreferrer">Gemini data terms</a></div>
      <footer className="clip-dialog-footer"><Button onClick={() => setVideoConfirm(false)}>Keep video local</Button>
        <Button variant="primary" onClick={() => { setVideoConfirm(false); void run({ ids: [post.clipKey], field: "all", video: true, accountId }); }}>Send video and generate</Button></footer>
    </Modal>}
  </Card>;
}
