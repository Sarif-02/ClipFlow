"use client";

import { FilmStripIcon, PlayIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { clipMedia, formatBytes, formatClipDate, formatDuration, formatResolution, type ClipInfo } from "@/lib/clips/types";

export function ClipThumbnail({ clip }: { clip: ClipInfo }) {
  return <span className="clip-thumb">
    {clip.hasThumbnail
      // eslint-disable-next-line @next/next/no-img-element
      ? <img src={clipMedia(clip.id, "thumbnail")} alt="" loading="lazy" />
      : <FilmStripIcon size={24} aria-hidden="true" />}
  </span>;
}

export function ClipPreview({ clip, trigger }: { clip: ClipInfo; trigger?: ReactNode }) {
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  return <Modal title={clip.displayName} description={`Original file: ${clip.originalFilename}`}
    open={open} onOpenChange={value => { setOpen(value); if (!value) setError(false); }}
    trigger={trigger ?? <Button><PlayIcon size={16} aria-hidden="true" /> Preview</Button>}>
    <div className="clip-dialog-body clip-preview">
      {clip.status === "INVALID" ? <p className="body-6 form-error">This file did not pass video analysis.</p> :
        <video controls playsInline preload="metadata" aria-label={`Preview ${clip.displayName}`}
          src={clipMedia(clip.id, "video")} poster={clip.hasThumbnail ? clipMedia(clip.id, "thumbnail") : undefined}
          onError={() => setError(true)} />}
      {error && <p role="alert" className="body-6 form-error">This video could not play in your browser. Download the original or export it as an H.264 MP4.</p>}
      <dl className="clip-facts">
        {[
          ["Duration", formatDuration(clip.duration)], ["Resolution", formatResolution(clip)],
          ["Size", formatBytes(clip.size)], ["Imported", formatClipDate(clip.createdAt)],
          ["Video codec", clip.codec ?? "Unknown"], ["Aspect ratio", clip.aspectRatio ?? "Unknown"],
          ["Audio", clip.audioCodec ? `${clip.audioCodec}${clip.audioChannels ? ` · ${clip.audioChannels} ch` : ""}` : "No audio information"],
          ["Source", clip.source === "LOCAL" ? "Local file" : clip.source],
        ].map(([label, value]) => <div key={label}><dt className="caption-5 muted">{label}</dt><dd className="caption-1 technical">{value}</dd></div>)}
      </dl>
    </div>
  </Modal>;
}
