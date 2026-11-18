"use client";

import Link from "next/link";
import { MicrophoneIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import type { ClipInfo } from "@/lib/clips/types";
import { transcriptLimit, transcriptionMaxSeconds } from "@/lib/integrations/transcript-limits";

export function TranscriptionInput({ clip, ready, text, onChange }: { clip?: ClipInfo; ready: boolean; text: string; onChange: (id: string, text: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [feedback, setFeedback] = useState<{ id: string; message: string; error?: boolean }>();
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);

  async function transcribe(id: string) {
    if (running.current) return;
    const controller = new AbortController();
    running.current = controller;
    setConfirm(false); setBusy(id); setFeedback(undefined);
    try {
      const response = await fetch("/api/transcription", { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clipId: id, confirm: true }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not transcribe this clip.");
      onChange(id, result.text);
      setFeedback({ id, message: ["Transcript ready. Review the text before generating metadata.",
        result.truncated && "The transcript was shortened to fit Gemini's input field.",
        !result.cleanupConfirmed && "AssemblyAI did not confirm deletion of the remote transcript."].filter(Boolean).join(" ") });
    } catch (error) {
      setFeedback({ id, message: controller.signal.aborted ? "Transcription cancelled." : error instanceof Error ? error.message : "Transcription failed.",
        error: !controller.signal.aborted });
    } finally { running.current = null; setBusy(undefined); }
  }

  const usable = clip?.status === "READY" && Boolean(clip.audioCodec) && Boolean(clip.duration && clip.duration <= transcriptionMaxSeconds);
  return <div className="plan-stack">
    <label className="clip-form-label title-4">Transcript for selected clip<textarea className="clip-field body-6" rows={3} maxLength={transcriptLimit}
      placeholder="Paste a transcript or transcribe the clip audio" value={text} disabled={busy === clip?.id && Boolean(busy)}
      onChange={event => { if (clip) onChange(clip.id, event.target.value); }} /></label>
    <div className="plan-actions">
      {ready ? <Button disabled={Boolean(busy) || !usable} onClick={() => setConfirm(true)}><MicrophoneIcon size={16} aria-hidden="true" />Transcribe clip audio</Button> :
        <Link href="/integrations" className="workspace-link caption-2">Set up AssemblyAI</Link>}
      {busy && <Button onClick={() => running.current?.abort()}>Cancel transcription</Button>}
    </div>
    {busy && <p className="caption-2 muted" role="status">Extracting audio and waiting for AssemblyAI…</p>}
    {ready && !usable && <p className="caption-2 muted">Transcription needs an analyzed clip with audio, up to 10 minutes long.</p>}
    {feedback && feedback.id === clip?.id && <p className={`caption-2 ${feedback.error ? "form-error" : "muted"}`} role={feedback.error ? "alert" : "status"}>{feedback.message}</p>}
    {confirm && clip && <Modal open onOpenChange={setConfirm} title="Send audio to AssemblyAI?" description={`ClipFlow will extract and send the audio from ${clip.originalFilename}. AssemblyAI usage can consume credits.${text.trim() ? " This will replace the current transcript when it succeeds." : ""}`}>
      <footer className="clip-dialog-footer"><Button onClick={() => setConfirm(false)}>Cancel</Button>
        <Button variant="primary" onClick={() => void transcribe(clip.id)}>Send audio and transcribe</Button></footer>
    </Modal>}
  </div>;
}
