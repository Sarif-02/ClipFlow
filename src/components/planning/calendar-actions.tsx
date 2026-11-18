"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { wallTime } from "@/lib/planning/model";
import { planningRequest } from "./draft-actions";

export function CalendarActions({ id, date, timezone }: { id: string; date: string; timezone: string }) {
  const [mode, setMode] = useState<"date" | "cancel">();
  const [local, setLocal] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();
  async function save() {
    setBusy(true); setError("");
    try {
      await planningRequest(`/api/plans/${id}`, "PATCH", mode === "cancel" ? { cancel: true } : { local });
      setMode(undefined); router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "The plan could not be changed."); }
    finally { setBusy(false); }
  }
  function dialog(value: "date" | "cancel") {
    const cancel = value === "cancel";
    return <Modal open={mode === value} busy={busy} onOpenChange={open => {
      setMode(open ? value : undefined); setLocal(wallTime(new Date(date), timezone)); setError("");
    }} title={cancel ? "Cancel local plan?" : "Reschedule local plan"}
      description={cancel ? "The calendar entry will be removed. The draft and its clips will stay saved." : `Choose a new date and time in ${timezone}.`}
      trigger={<Button>{cancel ? "Cancel plan" : "Reschedule"}</Button>}>
      <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <div className="clip-dialog-body">
          {!cancel && <label className="clip-form-label title-4">New date and time
            <input required type="datetime-local" className="clip-field body-6 technical" value={local} disabled={busy}
              onChange={event => setLocal(event.target.value)} /></label>}
          {error && <p className="body-6 form-error" role="alert">{error}</p>}
        </div>
        <footer className="clip-dialog-footer"><Button disabled={busy} onClick={() => setMode(undefined)}>Keep current plan</Button>
          <Button type="submit" variant="primary" disabled={busy}>{cancel ? "Confirm cancellation" : "Save new time"}</Button></footer>
      </form>
    </Modal>;
  }
  return <div className="plan-actions">{dialog("date")}{dialog("cancel")}</div>;
}
