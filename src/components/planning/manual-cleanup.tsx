"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { formatBytes } from "@/lib/clips/types";
import { planningRequest } from "./draft-actions";

export function ManualCleanup({ candidates }: { candidates: { id: string; size: number }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<typeof candidates>([]);
  async function clean() {
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await planningRequest("/api/retention", "POST", { confirm: true, ids: selection.map(item => item.id) });
      setOpen(false);
      setNotice(`${result.removed} removed · ${result.skipped} skipped · ${result.failed} could not be removed.`);
      router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Cleanup failed. Try again."); }
    finally { setBusy(false); }
  }
  return <div className="plan-stack settings-note">
    <Modal title="Remove eligible stored videos?"
      description={`${selection.length} ${selection.length === 1 ? "local copy uses" : "local copies use"} ${formatBytes(selection.reduce((sum, item) => sum + item.size, 0))}. ClipFlow checks each clip again and preserves originals and publication history.`}
      open={open} busy={busy} onOpenChange={value => { setError(""); if (value) setSelection(candidates.slice(0, 100)); setOpen(value); }}
      trigger={<Button disabled={!candidates.length} className="tone-error">Review eligible cleanup</Button>}>
      {error && <p className="clip-dialog-body body-6 form-error" role="alert">{error}</p>}
      <footer className="clip-dialog-footer"><Button disabled={busy} onClick={() => setOpen(false)}>Keep videos</Button>
        <Button className="tone-error" disabled={busy} onClick={() => void clean()}>{busy ? "Removing" : "Remove eligible copies"}</Button></footer>
    </Modal>
    {notice && <p className="caption-2" role="status">{notice}</p>}
  </div>;
}
