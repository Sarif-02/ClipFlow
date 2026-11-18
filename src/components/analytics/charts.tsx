import { Card } from "@/components/ui/card";
import { count } from "@/lib/analytics/model";
import type { ReactNode } from "react";

type Point = { label: string; value: number | null };
export function ReportChart({ title, points, unit = "", bars = false, controls }: { title: string; points: Point[]; unit?: string; bars?: boolean; controls?: ReactNode }) {
  const measured = points.flatMap((point, index) => point.value === null ? [] : [{ ...point, value: point.value, index }]);
  const max = Math.max(0, ...measured.map(point => point.value));
  const min = Math.min(0, ...measured.map(point => point.value));
  const x = (index: number) => 36 + (points.length > 1 ? index / (points.length - 1) : 0.5) * 252;
  const y = (value: number) => 96 - (value - min) / (max - min || 1) * 80;
  return <Card className="overview-panel plan-stack">
    <div className="plan-row"><h3 className="dashboard-section">{title}</h3>{controls}</div>
    {!measured.length ? <p className="chart-empty body-6 muted">No reported data for this selection.</p> : <>
      {bars ? <ul className="plan-list">{measured.map(point => <li className="chart-bar-row" key={point.label}>
        <span className="title-5">{point.label}</span>
        <meter min={0} max={max || 1} value={point.value} aria-label={point.label} />
        <span className="caption-5 technical">{count(point.value)}</span>
      </li>)}</ul> : <svg className="report-chart" viewBox="0 0 300 120" role="img" aria-label={`${title}. ${measured.length} of ${points.length} days reported.`}>
        <path d="M36 16V96H288" fill="none" stroke="var(--muted)" strokeWidth=".7" />
        <text x="3" y="19">{Intl.NumberFormat("en", { notation: "compact" }).format(max)}</text>
        {min !== max && <text x="3" y="97">{Intl.NumberFormat("en", { notation: "compact" }).format(min)}</text>}
        <text x="36" y="111">{points[0].label.slice(5)}</text>
        <text x="288" y="111" textAnchor="end">{points.at(-1)?.label.slice(5)}</text>
        {measured.map((point, index) => {
          const previous = measured[index - 1];
          return <g key={point.label}>
            {previous && previous.index === point.index - 1 && <path d={`M${x(previous.index)} ${y(previous.value)}L${x(point.index)} ${y(point.value)}`}
              fill="none" stroke="currentColor" strokeWidth="1.5" />}
            <circle cx={x(point.index)} cy={y(point.value)} r={2} fill="currentColor">
              <title>{`${point.label}: ${count(point.value)}${unit ? ` ${unit}` : ""}`}</title>
            </circle>
          </g>;
        })}
      </svg>}
      <details><summary className="caption-1">View reported values</summary>
        <dl className="plan-stack chart-values">{points.map(point => <div className="plan-row" key={point.label}>
          <dt className="caption-5">{point.label}</dt><dd className="caption-5 technical">{count(point.value)}{point.value !== null && unit ? ` ${unit}` : ""}</dd>
        </div>)}</dl>
      </details>
    </>}
  </Card>;
}
