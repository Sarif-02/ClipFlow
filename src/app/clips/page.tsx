import { Suspense } from "react";
import { connection } from "next/server";
import { ClipLibrary } from "@/components/clips/library";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { listClips } from "@/lib/clips/storage";
import { runtimeSettings } from "@/lib/integrations/config";

export const metadata = { title: "Clip Library" };

async function LibraryData() {
  await connection();
  const [clips, settings] = await Promise.all([listClips(), runtimeSettings()]);
  return <ClipLibrary clips={clips} limit={settings.uploadMib * 1048576} />;
}

export default function Page() {
  return <Suspense fallback={<WorkspaceLoading />}><LibraryData /></Suspense>;
}
