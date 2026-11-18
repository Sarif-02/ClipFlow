"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export async function planningRequest(path: string, method: string, body?: object) {
  const result = await fetch(path, { method, body: body && JSON.stringify(body),
    headers: body ? { "Content-Type": "application/json" } : undefined });
  const data = result.status === 204 ? null : await result.json();
  if (!result.ok) throw new Error(data?.error ?? "The change could not be saved.");
  return data;
}

export function DraftActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function perform(method: "POST" | "DELETE") {
    setBusy(true);
    setError("");
    try {
      const result = await planningRequest(`/api/drafts/${id}`, method);
      setOpen(false);
      if (result) router.push(`/compose?draft=${result.id}`);
      router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "The draft could not be changed."); }
    finally { setBusy(false); }
  }
  return <div className="plan-actions">
    <Button disabled={busy} title="Copy content and selections without copying planned times" onClick={() => void perform("POST")}>Duplicate</Button>
    <Modal title="Delete draft?" description={`“${name}” and its local calendar plans will be removed. Your clip files will stay in the library.`}
      open={open} onOpenChange={value => { setOpen(value); setError(""); }} busy={busy} trigger={<Button disabled={busy}>Delete</Button>}>
      {error && <p className="clip-dialog-body body-6 form-error" role="alert">{error}</p>}
      <div className="clip-dialog-footer"><Button disabled={busy} onClick={() => setOpen(false)}>Keep draft</Button>
        <Button variant="primary" disabled={busy} onClick={() => void perform("DELETE")}>Delete draft</Button></div>
    </Modal>
    {!open && error && <p className="body-6 form-error" role="alert">{error}</p>}
  </div>;
}
