"use client";

import { ArrowClockwiseIcon, CloudArrowUpIcon, FilmStripIcon, UploadSimpleIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatBytes } from "@/lib/clips/types";

type Upload = { id: string; file: File; sent: number; state: "queued" | "sending" | "processing" | "done" | "error" | "cancelled"; message?: string; invalid?: boolean };
const states = { queued: "Ready to upload", sending: "Uploading", processing: "Checking video",
  done: "Imported", error: "Upload failed", cancelled: "Cancelled" };

export function UploadButton({ limit, label = "Upload clips", primary = true }: { limit: number; label?: string; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Upload[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef<{ id: string; xhr: XMLHttpRequest } | null>(null);
  const skipped = useRef(new Set<string>());
  const stop = useRef(false);
  const router = useRouter();
  const total = rows.reduce((sum, row) => sum + (row.invalid ? 0 : row.file.size), 0);
  const sent = rows.reduce((sum, row) => sum + row.sent, 0);
  const candidates = rows.filter(row => !row.invalid && ["queued", "error", "cancelled"].includes(row.state));
  const update = (id: string, value: Partial<Upload>) =>
    setRows(current => current.map(row => row.id === id ? { ...row, ...value } : row));

  function add(files: FileList | File[]) {
    const selected = Array.from(files).map(file => {
      const message = !file.name.toLowerCase().endsWith(".mp4") ? "Choose an MP4 video."
        : !file.size ? "This file is empty." : file.size > limit ? `Limit is ${formatBytes(limit)} per video.` : undefined;
      return { id: crypto.randomUUID(), file, sent: 0, state: message ? "error" as const : "queued" as const, message, invalid: Boolean(message) };
    });
    setRows(current => [...current, ...selected]);
    if (input.current) input.current.value = "";
  }

  function send(row: Upload) {
    return new Promise<boolean>(resolve => {
      update(row.id, { state: "sending", message: undefined, sent: 0 });
      const xhr = new XMLHttpRequest();
      active.current = { id: row.id, xhr };
      xhr.open("POST", "/api/clips");
      xhr.setRequestHeader("Content-Type", "video/mp4");
      xhr.setRequestHeader("X-Clip-Filename", encodeURIComponent(row.file.name));
      xhr.responseType = "json";
      xhr.timeout = 31 * 60 * 1000;
      xhr.upload.onprogress = event => update(row.id, { sent: Math.min(event.loaded, row.file.size) });
      xhr.upload.onload = () => update(row.id, { sent: row.file.size, state: "processing" });
      xhr.onload = () => {
        const success = xhr.status === 200 || xhr.status === 201;
        const message = xhr.status === 200 ? "Already in the Clip Library and ready to publish again."
          : xhr.response?.status === "PENDING_ANALYSIS" ? "Saved. Metadata analysis is pending." : "Saved to the Clip Library.";
        update(row.id, success ? { state: "done", sent: row.file.size, message }
          : { state: "error", message: xhr.response?.error ?? "ClipFlow could not save this video. Retry the upload." });
        resolve(success);
      };
      xhr.onerror = xhr.ontimeout = () => {
        update(row.id, { state: "error", message: "The upload connection closed. Retry the upload." });
        resolve(false);
      };
      xhr.onabort = () => {
        update(row.id, { state: "cancelled", message: "Upload cancelled." });
        resolve(false);
      };
      try { xhr.send(row.file); }
      catch { update(row.id, { state: "error", message: "The upload could not start." }); resolve(false); }
    });
  }

  async function start(batch: Upload[]) {
    if (busy || !batch.length) return;
    setBusy(true);
    stop.current = false;
    skipped.current.clear();
    try {
      let changed = false;
      for (const row of batch) {
        if (stop.current) break;
        if (skipped.current.has(row.id)) continue;
        if (await send(row)) changed = true;
        active.current = null;
      }
      if (changed) router.refresh();
    } finally { active.current = null; setBusy(false); }
  }

  const percent = total ? Math.floor(sent / total * 100) : 0;
  return (
    <Modal open={open} onOpenChange={value => { setOpen(value); if (!value) setRows([]); }}
      title="Upload clips" description={`Add MP4 videos from your computer. Up to ${formatBytes(limit)} per clip.`} busy={busy}
      trigger={<Button variant={primary ? "primary" : "outline"}><UploadSimpleIcon size={18} aria-hidden="true" />{label}</Button>}>
      <div className="clip-dialog-body">
        <div className="upload-drop" data-drag={drag} onDragOver={event => { event.preventDefault(); if (!busy) setDrag(true); }}
          onDragLeave={() => setDrag(false)} onDrop={event => { event.preventDefault(); setDrag(false); if (!busy) add(event.dataTransfer.files); }}>
          <CloudArrowUpIcon size={28} aria-hidden="true" />
          <p className="title-4">Drop MP4 videos here</p>
          <Button disabled={busy} onClick={() => input.current?.click()}>Browse files</Button>
          <input ref={input} hidden type="file" multiple accept=".mp4,video/mp4" aria-label="Choose MP4 videos"
            onChange={event => { if (event.currentTarget.files) add(event.currentTarget.files); }} />
        </div>
        {rows.length > 0 && <>
          <div className="batch-progress">
            <p className="caption-3">Batch transfer <span className="technical">{percent}%</span></p>
            <progress aria-label="Batch transfer" max={100} value={percent} />
          </div>
          <ul className="upload-list">
            {rows.map(row => (
              <li key={row.id} className="upload-row">
                <FilmStripIcon size={20} aria-hidden="true" />
                <div className="upload-file">
                  <p className="title-4">{row.file.name}</p>
                  <p className={`caption-5 ${row.state === "error" ? "form-error" : "muted"}`} role={row.state === "error" ? "alert" : "status"}>
                    {states[row.state]} · {row.message ?? formatBytes(row.file.size)}
                  </p>
                  <progress aria-label={`Transfer for ${row.file.name}`} value={row.sent} max={row.file.size || 1} />
                </div>
                {busy && row.state === "sending" && <Button variant="ghost" onClick={() => active.current?.xhr.abort()}>Cancel</Button>}
                {busy && row.state === "queued" && <Button variant="ghost" onClick={() => {
                  skipped.current.add(row.id); update(row.id, { state: "cancelled" });
                }}>Skip</Button>}
                {!busy && ["error", "cancelled"].includes(row.state) && !row.invalid &&
                  <Button size="icon" variant="ghost" aria-label={`Retry ${row.file.name}`} onClick={() => void start([row])}><ArrowClockwiseIcon size={18} /></Button>}
              </li>
            ))}
          </ul>
        </>}
      </div>
      <footer className="clip-dialog-footer">
        {busy ? <Button onClick={() => {
          stop.current = true;
          active.current?.xhr.abort();
          setRows(current => current.map(row => row.state === "queued" ? { ...row, state: "cancelled" } : row));
        }}>Cancel batch</Button> : <Button onClick={() => { setOpen(false); setRows([]); }}>Done</Button>}
        <Button variant="primary" disabled={busy || !candidates.length} onClick={() => void start(candidates)}>
          {busy ? "Uploading" : candidates.length ? `Upload ${candidates.length} ${candidates.length === 1 ? "clip" : "clips"}` : "Upload clips"}
        </Button>
      </footer>
    </Modal>
  );
}
