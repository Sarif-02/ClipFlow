import { Suspense } from "react";
import { connection } from "next/server";
import { AnalyticsDashboard } from "@/components/analytics/dashboard";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { cachedReports } from "@/lib/analytics/cache";
import { presets, reportingRange } from "@/lib/analytics/model";
import { runtimeSettings } from "@/lib/integrations/config";

export const metadata = { title: "Analytics" };
async function AnalyticsData({ searchParams }: { searchParams: PageProps<"/analytics">["searchParams"] }) {
  await connection();
  const params = await searchParams;
  const text = (value: string | string[] | undefined) => typeof value === "string" ? value : "";
  const requested = text(params.range);
  const preset = presets.includes(requested as typeof presets[number]) ? requested : "28";
  const start = text(params.start);
  const end = text(params.end);
  const range = reportingRange(preset, start, end);
  const [reports, { timezone }] = await Promise.all([cachedReports(range), runtimeSettings()]);
  const channel = text(params.channel);
  const selected = reports.some(report => report.id === channel) ? channel : "";
  return <AnalyticsDashboard key={JSON.stringify([selected, preset, start, end])} reports={reports} range={range}
    preset={preset} start={start} end={end} selected={selected} timezone={timezone} />;
}
export default function Page({ searchParams }: PageProps<"/analytics">) {
  return <Suspense fallback={<WorkspaceLoading />}><AnalyticsData searchParams={searchParams} /></Suspense>;
}
