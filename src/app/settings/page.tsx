import { Suspense } from "react";
import { connection } from "next/server";
import { join } from "node:path";
import { Card } from "@/components/ui/card";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { mediaTools } from "@/lib/clips/media";
import { clipSummary } from "@/lib/clips/storage";
import { formatBytes } from "@/lib/clips/types";
import { storageRoot } from "@/lib/local-config";
import { runtimeSettings } from "@/lib/integrations/config";
import Link from "next/link";
import { ManualCleanup } from "@/components/planning/manual-cleanup";
import { cleanupSummary } from "@/lib/planning/retention";

export const metadata = { title: "Settings" };

async function StorageSettings() {
  await connection();
  const [summary, tools, runtime, cleanup] = await Promise.all([clipSummary(), mediaTools(), runtimeSettings(), cleanupSummary()]);
  const rows = [
    ["Video directory", join(storageRoot(), "videos")],
    ["Stored clips", String(summary.count)],
    ["Video storage used", formatBytes(summary.bytes)],
    ["Eligible for cleanup", String(cleanup.candidates.length)],
    ["Video space reclaimed", formatBytes(cleanup.reclaimedBytes)],
    ["Upload limit per clip", formatBytes(runtime.uploadMib * 1048576)],
    ["FFmpeg", tools.ffmpeg ? "Available" : "Unavailable"],
    ["FFprobe", tools.ffprobe ? "Available" : "Unavailable"],
  ];
  return <>
    <Card className="overview-panel" aria-labelledby="local-storage">
      <header className="panel-header"><div><h2 className="dashboard-section" id="local-storage">Local storage</h2>
        <p className="caption-2 muted">Clips stay in the library unless you choose removal during publishing or remove them manually.</p></div></header>
      <dl className="settings-data">
        {rows.map(([label, value]) => <div key={label}><dt className="title-4">{label}</dt><dd className="body-6 technical">{value}</dd></div>)}
      </dl>
      <ManualCleanup candidates={cleanup.candidates.slice(0, 100)} />
      <p className="caption-2 muted settings-note">Change the upload limit in <Link className="workspace-link" href="/integrations">Integrations</Link>.</p>
      {(!tools.ffmpeg || !tools.ffprobe) && <p className="caption-2 settings-note">
        Install the Windows FFmpeg build, add its bin directory to PATH or set <code>FFMPEG_PATH</code> and <code>FFPROBE_PATH</code>, then restart and retry analysis from the library.
      </p>}
    </Card>
  </>;
}

export default function Page() {
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Settings</h1><p className="body-6 muted">Storage and media tools for this ClipFlow workspace.</p></div></header>
    <Suspense fallback={<WorkspaceLoading />}><StorageSettings /></Suspense>
  </div>;
}
