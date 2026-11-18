"use client";

import Link from "next/link";
import { DotsThreeIcon, FilmStripIcon, ListBulletsIcon, MagnifyingGlassIcon, PlayIcon, SquaresFourIcon } from "@phosphor-icons/react";
import { useRouter } from "next/navigation";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Modal } from "@/components/ui/modal";
import { clipMedia, formatBytes, formatClipDate, formatDuration, formatResolution, type ClipInfo } from "@/lib/clips/types";
import { sendClipAction } from "./api";
import { ClipPreview, ClipThumbnail } from "./clip-preview";
import { UploadButton } from "./upload";

const preference = "clipflow-library-view";
const subscribe = (update: () => void) => {
  window.addEventListener(preference, update);
  window.addEventListener("storage", update);
  return () => { window.removeEventListener(preference, update); window.removeEventListener("storage", update); };
};
let fallback: "grid" | "list" | undefined;
function readView() {
  if (fallback) return fallback;
  try { return localStorage.getItem(preference) === "list" ? "list" : "grid"; }
  catch { return "grid"; }
}
const serverView = () => "grid" as const;
const sorts = ["Newest", "Oldest", "Filename", "Duration", "Size"] as const;
type Sort = typeof sorts[number];
const comparators: Record<Sort, (first: ClipInfo, second: ClipInfo) => number> = {
  Newest: (first, second) => second.createdAt.localeCompare(first.createdAt),
  Oldest: (first, second) => first.createdAt.localeCompare(second.createdAt),
  Filename: (first, second) => first.displayName.localeCompare(second.displayName, undefined, { numeric: true, sensitivity: "base" }),
  Duration: (first, second) => (second.duration ?? -1) - (first.duration ?? -1),
  Size: (first, second) => second.size - first.size,
};
const sourceName = (source: string) => source === "LOCAL" ? "Local file" : source;
type Action = { type: "rename"; clip: ClipInfo } | { type: "delete"; ids: string[] };

export function ClipLibrary({ clips, limit }: { clips: ClipInfo[]; limit: number }) {
  const router = useRouter();
  const view = useSyncExternalStore(subscribe, readView, serverView);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("");
  const [sort, setSort] = useState<Sort>("Newest");
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(new Set<string>());
  const [action, setAction] = useState<Action>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [dialogError, setDialogError] = useState("");
  const actionFocus = useRef<HTMLElement | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const visible = clips.filter(clip => (!source || clip.source === source) &&
    [clip.displayName, clip.originalFilename].some(value => value.toLocaleLowerCase().includes(query))).sort(comparators[sort]);
  const selectedIds = clips.filter(clip => selected.has(clip.id)).map(clip => clip.id);
  const allVisible = visible.length > 0 && visible.every(clip => selected.has(clip.id));

  function changeView(value: "grid" | "list") {
    try { localStorage.setItem(preference, value); } catch { fallback = value; }
    window.dispatchEvent(new Event(preference));
  }

  function select(ids: string[], checked: boolean) {
    setSelected(current => {
      const next = new Set(current);
      ids.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
  }

  function begin(value: Action, focus: HTMLElement | null) {
    actionFocus.current = focus;
    setDialogError("");
    setAction(value);
  }

  function close() {
    setAction(undefined);
    requestAnimationFrame(() => {
      const target = actionFocus.current;
      if (target?.isConnected && !target.hasAttribute("disabled")) target.focus();
      else heading.current?.focus();
    });
  }

  async function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    const name = new FormData(event.currentTarget).get("name");
    setDialogError("");
    setError("");
    setMessage("");
    setBusy(true);
    try {
      if (action.type === "rename") {
        if (typeof name !== "string" || !name.trim()) throw new Error("Enter a display name.");
        await sendClipAction(`/api/clips/${action.clip.id}`, "PATCH", { name });
        setMessage("Display name updated.");
      } else {
        for (let index = 0; index < action.ids.length; index += 100) {
          const ids = action.ids.slice(index, index + 100);
          await sendClipAction("/api/clips", "DELETE", { ids });
          select(ids, false);
        }
        setMessage(action.ids.length === 1 ? "Clip deleted." : `${action.ids.length} clips deleted.`);
      }
      close();
    } catch (problem) {
      setDialogError(problem instanceof Error ? problem.message : "The operation failed.");
    } finally { setBusy(false); router.refresh(); }
  }

  async function analyse(id: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await sendClipAction(`/api/clips/${id}`, "POST");
      setMessage("Video analysis complete.");
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Analysis did not finish."); }
    finally { setBusy(false); router.refresh(); }
  }

  return <div className="overview">
    <header className="overview-header">
      <div><h1 className="heading-4" ref={heading} tabIndex={-1}>Clip Library</h1>
        <p className="body-6 muted"><span className="technical">{clips.length}</span> {clips.length === 1 ? "clip" : "clips"} in your workspace</p>
      </div>
      <UploadButton limit={limit} />
    </header>
    <Card className="library-toolbar" aria-label="Library controls">
      <label className="library-search">
        <MagnifyingGlassIcon size={18} aria-hidden="true" />
        <input className="body-6" type="search" aria-label="Search clips" placeholder="Search by filename" value={search} onChange={event => setSearch(event.target.value)} />
      </label>
      <div className="library-filters">
        <label className="caption-5 muted">Source
          <select className="clip-field body-6" value={source} onChange={event => setSource(event.target.value)}>
            <option value="">All sources</option>
            {[...new Set(["LOCAL", ...clips.map(clip => clip.source)])].map(item => <option key={item} value={item}>{sourceName(item)}</option>)}
          </select>
        </label>
        <label className="caption-5 muted">Sort by
          <select className="clip-field body-6" value={sort} onChange={event => setSort(event.target.value as Sort)}>
            {sorts.map(item => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
      <div className="library-toolbar-actions">
        <div className="theme-switcher" role="group" aria-label="Library view">
          <button type="button" aria-label="Grid view" title="Grid view" aria-pressed={view === "grid"} onClick={() => changeView("grid")}><SquaresFourIcon size={18} /></button>
          <button type="button" aria-label="List view" title="List view" aria-pressed={view === "list"} onClick={() => changeView("list")}><ListBulletsIcon size={18} /></button>
        </div>
        <Button disabled={!clips.length || busy} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected(new Set()); }}>
          {selecting ? "Exit selection" : "Select clips"}
        </Button>
      </div>
    </Card>
    {selecting && <div className="selection-bar">
      <label className="body-6"><input type="checkbox" checked={allVisible} disabled={!visible.length}
        onChange={event => select(visible.map(clip => clip.id), event.target.checked)} /> Select all visible</label>
      <p className="caption-1 muted"><span className="technical">{selectedIds.length}</span> selected</p>
      <Button disabled={!selectedIds.length || busy} onClick={event => begin({ type: "delete", ids: selectedIds }, event.currentTarget)}>Delete selected</Button>
    </div>}
    {message && <p role="status" className="body-6">{message}</p>}
    {error && <p role="alert" className="body-6 form-error">{error}</p>}
    {!visible.length ? <Card className="overview-panel">
      <EmptyState icon={<FilmStripIcon size={24} />} title={clips.length ? "No matching clips" : "No clips yet"}
        description={clips.length ? "Try a different filename or source." : "Upload an MP4 to add it to your workspace."} />
    </Card> : <ul className="clip-collection" data-view={view} aria-label="Clips">
      {visible.map(clip => <li key={clip.id} className="card clip-tile">
        <div className="clip-visual">
          <ClipPreview clip={clip} trigger={<button type="button" className="clip-play" aria-label={`Preview ${clip.displayName}`}>
            <ClipThumbnail clip={clip} /><span className="clip-play-icon"><PlayIcon size={16} weight="fill" /></span>
          </button>} />
          {selecting && <label className="clip-select"><input type="checkbox" aria-label={`Select ${clip.displayName}`}
            checked={selected.has(clip.id)} onChange={event => select([clip.id], event.target.checked)} /></label>}
        </div>
        <div className="clip-tile-body">
          <div className="clip-title-row">
            <div className="clip-name">
              <p className="title-4" title={clip.displayName}>{clip.displayName}</p>
              {clip.displayName !== clip.originalFilename && <p className="caption-5 muted" title={clip.originalFilename}>{clip.originalFilename}</p>}
            </div>
            <details className="clip-actions" onKeyDown={event => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}>
              <summary className="button button-icon button-ghost" aria-label={`Actions for ${clip.displayName}`}><DotsThreeIcon size={22} weight="bold" /></summary>
              <div className="clip-action-list">
                <ClipPreview clip={clip} trigger={<Button variant="ghost">View details</Button>} />
                {clip.status !== "INVALID" && <Link className={buttonVariants({ variant: "ghost" })} href={`/compose?clip=${clip.id}`}>Create post</Link>}
                <Button variant="ghost" disabled={busy} onClick={event => {
                  const menu = event.currentTarget.closest("details"); if (menu) menu.open = false;
                  begin({ type: "rename", clip }, menu?.querySelector("summary") ?? null);
                }}>Rename</Button>
                <a className={buttonVariants({ variant: "ghost" })} href={clipMedia(clip.id, "download")} download
                  onClick={event => {
                    const menu = event.currentTarget.closest("details");
                    if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); }
                  }}>Download original</a>
                {!clip.hasThumbnail && <Button variant="ghost" disabled={busy} onClick={event => {
                  const menu = event.currentTarget.closest("details"); if (menu) { menu.open = false; menu.querySelector("summary")?.focus(); }
                  void analyse(clip.id);
                }}>Retry analysis</Button>}
                <Button variant="ghost" disabled={busy} onClick={event => {
                  const menu = event.currentTarget.closest("details"); if (menu) menu.open = false;
                  begin({ type: "delete", ids: [clip.id] }, menu?.querySelector("summary") ?? null);
                }}>Delete clip</Button>
              </div>
            </details>
          </div>
          <div className="clip-metadata caption-5 muted">
            <span className="technical">{formatDuration(clip.duration)}</span>
            <span className="technical">{formatResolution(clip)}</span>
            <span className="technical">{formatBytes(clip.size)}</span>
            <span>{sourceName(clip.source)}</span>
            <span className="technical">{formatClipDate(clip.createdAt)}</span>
          </div>
          {clip.status !== "READY" && <p className={`caption-5 ${clip.status === "INVALID" ? "form-error" : "muted"}`}>{clip.status === "INVALID" ? "Analysis failed" : "Analysis pending"}</p>}
        </div>
      </li>)}
    </ul>}
    {action && <Modal open onOpenChange={value => { if (!value) close(); }} busy={busy}
      title={action.type === "rename" ? "Rename clip" : action.ids.length > 1 ? `Delete ${action.ids.length} clips?` : "Delete clip?"}
      description={action.type === "rename" ? "Only the name shown in ClipFlow will change." : "This removes the stored copies from ClipFlow. Your original files will not be touched."}>
      <form onSubmit={apply}>
        <div className="clip-dialog-body">
          {action.type === "rename" && <label className="clip-form-label title-4">Display name
            <input className="clip-field body-6" name="name" required maxLength={255} defaultValue={action.clip.displayName} disabled={busy} />
          </label>}
          {dialogError && <p className="body-6 form-error" role="alert">{dialogError}</p>}
        </div>
        <footer className="clip-dialog-footer">
          <Button disabled={busy} onClick={close}>Cancel</Button>
          <Button type="submit" disabled={busy} variant="primary">{busy ? "Working" : action.type === "rename" ? "Save name" : "Delete stored copies"}</Button>
        </footer>
      </form>
    </Modal>}
  </div>;
}
