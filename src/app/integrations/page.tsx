import { Suspense } from "react";
import { connection } from "next/server";
import { IntegrationCard, LocalConfig } from "@/components/integrations/setup";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { applicationOrigin, integrationViews, isOAuthProvider, oauthRedirect, runtimeSettings } from "@/lib/integrations/config";
import { storageRoot } from "@/lib/local-config";
import { db } from "@/lib/clips/db";

export const metadata = { title: "Integrations" };
async function Setup() {
  await connection();
  const now = new Date().getTime();
  const [views, settings, heartbeat] = await Promise.all([integrationViews(), runtimeSettings(),
    db().workerHeartbeat.findFirst({ orderBy: { seenAt: "desc" } })]);
  return <div className="overview">
    <header><h1 className="heading-4">Integrations</h1><p className="body-6 muted">Configure services and check connections for this local workspace.</p></header>
    <div className="report-grid">{views.map(item => <IntegrationCard key={item.provider} item={item}
      callback={isOAuthProvider(item.provider) ? oauthRedirect(item.provider) : undefined} />)}</div>
    <LocalConfig initial={settings} address={applicationOrigin()} storage={storageRoot()} ffmpeg={process.env.FFMPEG_PATH || "ffmpeg on PATH"}
      ffprobe={process.env.FFPROBE_PATH || "ffprobe on PATH"} online={Boolean(heartbeat && now - +heartbeat.seenAt < 15000)} />
  </div>;
}
export default function Page() { return <Suspense fallback={<WorkspaceLoading />}><Setup /></Suspense>; }
