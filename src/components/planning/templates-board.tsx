"use client";

import Link from "next/link";
import { StackIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import type { Content } from "@/lib/planning/model";
import { fieldsFor, placeholders, templateKinds, type Template, type TemplateKind } from "@/lib/planning/templates";
import { planningRequest } from "./draft-actions";

const blank: Template = { id: "", name: "", kind: "PRESET", isDefault: false, revision: 0, values: {} };
const labels = { title: "YouTube title", description: "YouTube description", tags: "YouTube tags", caption: "Instagram caption", hashtags: "Instagram hashtags" };
type Item = { id: string; name: string };

export function TemplatesBoard({ templates, groups, drafts, seed }: { templates: Template[]; groups: Item[]; drafts: Item[]; seed: Template | null }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Template | null>(seed);
  const [removing, setRemoving] = useState<Template>();
  const [applying, setApplying] = useState<Template>();
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [notice, setNotice] = useState("");
  const shown = templates.filter(item => `${item.name} ${templateKinds[item.kind]}`.toLowerCase().includes(search.trim().toLowerCase()));
  function close() { setEditing(null); setRemoving(undefined); setApplying(undefined); setProblem(""); }
  function values(patch: Partial<Template["values"]>) { if (editing) setEditing({ ...editing, values: { ...editing.values, ...patch } }); }
  function content(key: keyof Content, value: string) { values({ content: { ...editing?.values.content, [key]: value } }); }
  async function change(payload: object, message: string) {
    setBusy(true); setProblem(""); setNotice("");
    try {
      await planningRequest("/api/templates", "POST", payload);
      close(); setNotice(message);
      if (seed) router.replace("/templates"); else router.refresh();
    } catch (error) { setProblem(error instanceof Error ? error.message : "Template could not be updated."); }
    finally { setBusy(false); }
  }
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Templates</h1><p className="body-6 muted">Reuse metadata, Gemini instructions, and publishing preferences.</p></div>
      <Button variant="primary" onClick={() => { close(); setEditing(blank); }}>New template</Button></header>
    <Card className="overview-panel plan-stack"><label className="clip-form-label title-4 plan-name">Search templates
      <input className="clip-field body-6" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name or type" /></label>
      {notice && <p role="status" className="caption-2 tone-success">{notice}</p>}
      {problem && !editing && !removing && <p role="alert" className="caption-2 form-error">{problem}</p>}
      {shown.length ? <ul className="plan-list">{shown.map(item => <li key={item.id} className="plan-row">
        <div><p className="title-3">{item.name}</p><p className="caption-5 muted">{templateKinds[item.kind]}{item.isDefault && " · Default"}</p></div>
        <div className="plan-actions"><Button onClick={() => { close(); setApplying(item); setDraft(""); }}>Use in draft</Button><Button onClick={() => { close(); setEditing(item); }}>Edit</Button>
          <Button disabled={busy} onClick={() => void change({ action: "duplicate", id: item.id }, "Template duplicated.")}>Duplicate</Button>
          <Button className="tone-error" onClick={() => { close(); setRemoving(item); }}>Delete</Button></div>
      </li>)}</ul> : <EmptyState icon={<StackIcon size={24} />} title={search ? "No matching templates" : "No templates yet"}
        description={search ? "Try another name or type." : "Create a template to reuse it when preparing a draft."} />}
    </Card>
    {editing && <Modal open busy={busy} onOpenChange={open => { if (!open) close(); }} title={editing.id ? "Edit template" : "New template"} description="Apply saved templates in the composer.">
      <form onSubmit={event => { event.preventDefault(); const { id, ...fields } = editing; void change({ ...fields, action: "save", ...(id ? { id } : {}) }, "Template saved."); }}>
        <div className="clip-dialog-body plan-stack">
          <label className="clip-form-label title-4">Template name<input className="clip-field body-6" required maxLength={100} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} /></label>
          <label className="clip-form-label title-4">Template type<select aria-label="Template type" className="clip-field body-6" disabled={Boolean(editing.id)} value={editing.kind}
            onChange={event => setEditing({ ...editing, kind: event.target.value as TemplateKind })}>{Object.entries(templateKinds).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {fieldsFor[editing.kind].map(field => <label className="clip-form-label title-4" key={field}>{labels[field]}
            <textarea className="clip-field body-6" rows={2} value={editing.values.content?.[field] ?? ""} onChange={event => content(field, event.target.value)} /></label>)}
          {["AI", "PRESET"].includes(editing.kind) && <label className="clip-form-label title-4">AI instructions<textarea className="clip-field body-6" rows={3} maxLength={2000}
            value={editing.values.instructions ?? ""} onChange={event => values({ instructions: event.target.value })} /></label>}
          {editing.kind === "PRESET" && <div className="plan-fields">
            <label className="clip-form-label title-4">Account group<select className="clip-field body-6" value={editing.values.groupId ?? ""} onChange={event => values({ groupId: event.target.value })}>
              <option value="">Keep current destinations</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
            <label className="clip-form-label title-4">Content template<select className="clip-field body-6" value={editing.values.templateId ?? ""} onChange={event => values({ templateId: event.target.value })}>
              <option value="">None</option>{templates.filter(item => item.kind !== "PRESET").map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="clip-form-label title-4">Visibility<select className="clip-field body-6" value={editing.values.content?.visibility ?? ""} onChange={event => content("visibility", event.target.value)}>
              <option value="">Keep current</option><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label>
            <label className="clip-form-label title-4">Posting interval in minutes<input className="clip-field body-6" type="number" min={1} max={10080} value={editing.values.interval || ""} onChange={event => values({ interval: Number(event.target.value) })} /></label>
            <label className="clip-form-label title-4">YouTube category ID<input className="clip-field body-6" inputMode="numeric" pattern="[0-9]{1,4}" maxLength={4} value={editing.values.content?.category ?? ""} onChange={event => content("category", event.target.value)} /></label>
            <label className="clip-form-label title-4">Audience<select className="clip-field body-6" value={editing.values.content?.audience ?? ""} onChange={event => content("audience", event.target.value)}>
              <option value="">Keep current</option><option value="general">Not made for kids</option><option value="kids">Made for kids</option></select></label>
          </div>}
          <label className="plan-check body-6"><input type="checkbox" checked={editing.isDefault} onChange={event => setEditing({ ...editing, isDefault: event.target.checked })} /> Default for this type</label>
          <details><summary className="title-4">Supported placeholders</summary><p className="caption-2 muted">{placeholders.map(token => `{{${token}}}`).join(" · ")}</p></details>
          {problem && <p className="body-6 form-error" role="alert">{problem}</p>}
        </div>
        <footer className="clip-dialog-footer"><Button disabled={busy} onClick={close}>Cancel</Button><Button variant="primary" type="submit" disabled={busy}>{busy ? "Saving" : "Save template"}</Button></footer>
      </form>
    </Modal>}
    {removing && <Modal open busy={busy} onOpenChange={open => { if (!open) close(); }} title="Delete template?" description={`${removing.name} will be removed. Existing drafts keep their content.`}>
      {problem && <p className="clip-dialog-body body-6 form-error" role="alert">{problem}</p>}
      <footer className="clip-dialog-footer"><Button disabled={busy} onClick={close}>Keep template</Button>
        <Button className="tone-error" disabled={busy} onClick={() => void change({ action: "delete", id: removing.id }, "Template deleted.")}>Delete template</Button></footer>
    </Modal>}
    {applying && <Modal open onOpenChange={open => { if (!open) close(); }} title="Use template in a draft" description="Review and apply the template in the composer.">
      <div className="clip-dialog-body"><label className="clip-form-label title-4">Draft<select className="clip-field body-6" value={draft} onChange={event => setDraft(event.target.value)}>
        <option value="">New draft</option>{drafts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
      <footer className="clip-dialog-footer"><Button onClick={close}>Cancel</Button><Link className={buttonVariants({ variant: "primary" })} href={`/compose?${draft ? `draft=${draft}` : "new=1"}&template=${applying.id}`}>Open composer</Link></footer>
    </Modal>}
  </div>;
}
