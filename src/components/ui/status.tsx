import type { ReactNode } from "react";

export type Tone = "success" | "error" | "warning" | "info" | "ai" | "neutral";
const tones: Record<string, Tone> = {
  CONNECTED: "success", VERIFIED: "success", SUCCEEDED: "success", PUBLISHED: "success", ONLINE: "success", READY: "success", DONE: "success",
  FAILED: "error", DISCONNECTED: "error", INVALID: "error", INVALID_CREDENTIALS: "error", OFFLINE: "error",
  AUTH_REQUIRED: "warning", PAUSED_AUTH: "warning", NEEDS_REVIEW: "warning", UNCERTAIN: "warning", PERMISSIONS: "warning",
  EXPIRED: "warning", RETRY: "warning", RATE_LIMITED: "warning", CONNECTION_FAILED: "warning", API_DISABLED: "warning",
  QUEUED: "info", SCHEDULED: "info", UPLOADING: "info", PROCESSING: "info", AWAITING_PROVIDER: "info",
  GENERATING: "ai", SUGGESTION: "ai",
};
export function Status({ children, state, tone }: { children: ReactNode; state?: string; tone?: Tone }) {
  const flavor = tone ?? (state ? tones[state] : undefined) ?? "neutral";
  return <span className={`status-pill semantic-status caption-5 tone-${flavor}`}>
    <span className="semantic-dot" aria-hidden="true" />{children}
  </span>;
}
