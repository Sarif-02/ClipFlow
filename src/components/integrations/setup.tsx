"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { YoutubeLogoIcon, InstagramLogoIcon, SparkleIcon, CopyIcon, CpuIcon, MicrophoneIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Status } from "@/components/ui/status";
import { freeGeminiModels, supportsClipGeneration } from "@/lib/integrations/ai-model";
import { planningRequest } from "@/components/planning/draft-actions";
import type { LocalSettings, Provider, ProviderValues } from "@/lib/integrations/config";

export type IntegrationView = { provider: Provider; values: ProviderValues; hasSecret: boolean; status: string; validatedAt?: string;
  connectedAt?: string; error?: string | null; saved: boolean; count: number };
const labels: Record<string, string> = {
  NOT_CONFIGURED: "Not configured", SAVED: "Configuration saved", AUTH_REQUIRED: "Authorization required", CONNECTED: "Connected",
  VERIFIED: "Verified", PERMISSIONS: "Missing permissions", INVALID_CREDENTIALS: "Invalid credentials", EXPIRED: "Expired credentials",
  API_DISABLED: "API not enabled", RATE_LIMITED: "Rate limited", CONNECTION_FAILED: "Connection failed",
};
const guide = {
  YOUTUBE: { name: "YouTube", purpose: "Publish videos and sync channel analytics.", icon: YoutubeLogoIcon, url: "https://console.cloud.google.com/apis/dashboard",
    steps: ["Create or select a Google Cloud project. Enable YouTube Data API v3 and YouTube Analytics API.",
      "Configure Google Auth Platform branding, audience and data access. Add your Google account as a test user if the app is in Testing.",
      "Create an OAuth client for a Web application. Add the exact callback below to Authorized redirect URIs.",
      "Save the client ID and secret. Connect and choose the intended channel. Grant channel read, upload and analytics read access.",
      "Repeat for each channel or Brand Account. Use Test connection for a read check. Google may expire external Testing refresh tokens after seven days."] },
  INSTAGRAM: { name: "Instagram", purpose: "Publish Reels from local video files.", icon: InstagramLogoIcon, url: "https://developers.facebook.com/apps/",
    steps: ["Set up the Instagram API with Facebook Login for Business in your Meta app. Link each Creator or Business profile to a Facebook Page you can manage.",
      "Register the exact HTTPS callback below. Configure a Windows trusted localhost certificate and the two META_TLS environment paths; then restart ClipFlow.",
      "Use the Meta App ID and app secret. Grant instagram_basic, instagram_content_publish, pages_show_list and pages_read_engagement.",
      "For development, use eligible app roles and your managed Pages. Request Advanced Access and App Review when your use case requires access to other accounts.",
      "Save configuration, connect with Facebook, and grant access to each intended linked Page. Use Test connection for a read check."] },
  GEMINI: { name: "Gemini", purpose: "Generate editable titles, descriptions, captions, and tags.", icon: SparkleIcon, url: "https://aistudio.google.com/",
    steps: ["Open Google AI Studio and create a key for a project eligible for free usage.",
      "Paste the key and run Test API key. Choose or enter a model, then use Test model.",
      "Verify your project is on the free tier in AI Studio. Open Step 3 in Create Post to generate and review suggestions."] },
  ASSEMBLYAI: { name: "AssemblyAI", purpose: "Turn a clip's audio into an editable transcript for Gemini.", icon: MicrophoneIcon, url: "https://www.assemblyai.com/dashboard/",
    steps: ["Copy your API key from the AssemblyAI dashboard and save it here.", "Use Test connection to check the key.",
      "In Create Post, open Prepare content and choose Transcribe clip audio. Review the transcript before generating metadata.",
      "Transcription uses your AssemblyAI credits. Check your plan in the provider dashboard."] },
};

export async function connectAccount(provider: string, accountId?: string) {
  const result = await planningRequest("/api/oauth/start", "POST", { provider, accountId });
  window.location.assign(result.url);
}

export function IntegrationCard({ item, callback }: { item: IntegrationView; callback?: string }) {
  const { provider } = item;
  const oauth = provider === "YOUTUBE" || provider === "INSTAGRAM";
  const info = guide[provider];
  const Icon = info.icon;
  const router = useRouter();
  const [values, setValues] = useState(item.values);
  const [secret, setSecret] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [erase, setErase] = useState(false);
  const [result, setResult] = useState<{ status?: string; message: string }>();
  const [error, setError] = useState("");
  async function act(action: "save" | "test" | "clear", keyOnly = false) {
    setBusy(true); setError(""); setResult(undefined);
    try {
      const response = await planningRequest("/api/integrations", "POST", { provider, ...values, secret,
        test: action === "test", clear: action === "clear", keyOnly });
      if (action === "test") { setResult(response); setModels(response.models ?? []); }
      else { setSecret(""); setOpen(false); setErase(false); if (action === "clear") setValues({}); setResult({ message: action === "clear" ? "Configuration cleared." : "Configuration saved." }); }
      router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Configuration could not be changed."); }
    finally { setBusy(false); }
  }
  return <Card className="overview-panel plan-stack">
    <div className="plan-row"><div className="plan-avatar"><Icon size={22} aria-hidden="true" className={provider === "GEMINI" ? "tone-ai" : `platform-${provider.toLowerCase()}`} /><h2 className="dashboard-section">{info.name}</h2></div>
      <Status state={item.status}>{labels[item.status] ?? item.status}</Status></div>
    <p className="body-6 muted">{info.purpose}</p>
    <p className="caption-5 muted">{item.hasSecret ? "Credential saved or configured on server" : "No credential configured"}
      {oauth && ` · ${item.count} connected`}</p>
    <p className="caption-5 muted">Last successful verification: {item.validatedAt ? new Date(item.validatedAt).toLocaleString("en-GB", { timeZone: "Asia/Kolkata" }) : "Never"}</p>
    {provider === "GEMINI" && item.values.model && !supportsClipGeneration(item.values.model) && <p className="caption-2 tone-warning">Choose a supported free tier model to generate suggestions.</p>}
    {item.error && <p className="caption-2 form-error">{item.error}</p>}
    {result && <p role="status" className="body-6">{result.status ? `${labels[result.status] ?? result.status}: ` : ""}{result.message}</p>}
    {!open && error && <p role="alert" className="body-6 form-error">{error}</p>}
    <div className="plan-actions">
      <Modal title={`Configure ${info.name}`} description="Credentials stay on this computer. Saved secrets are never shown."
        open={open} busy={busy} onOpenChange={value => { setOpen(value); setError(""); setErase(false); }}
        trigger={<Button variant="primary">{item.hasSecret ? "Edit configuration" : "Configure"}</Button>}>
        <form onSubmit={event => { event.preventDefault(); void act("save"); }}>
          <div className="clip-dialog-body">
            {oauth && <label className="clip-form-label title-4">{provider === "YOUTUBE" ? "Google OAuth client ID" : "Meta App ID"}
              <input className="clip-field body-6" value={values.clientId ?? ""} onChange={event => setValues({ ...values, clientId: event.target.value })} /></label>}
            <label className="clip-form-label title-4">{oauth ? "Client secret" : `${info.name} API key`}
              <input className="clip-field body-6" type="password" autoComplete="new-password" value={secret}
                placeholder={item.hasSecret ? "Leave blank to keep the saved secret" : "Enter secret"} onChange={event => setSecret(event.target.value)} /></label>
            {provider === "INSTAGRAM" && <label className="clip-form-label title-4">Meta API version
              <input className="clip-field body-6" value={values.version ?? "v27.0"} onChange={event => setValues({ ...values, version: event.target.value })} /></label>}
            {provider === "INSTAGRAM" && <label className="clip-form-label title-4">Facebook Login configuration ID, if required
              <input className="clip-field body-6" inputMode="numeric" value={values.loginConfig ?? ""} onChange={event => setValues({ ...values, loginConfig: event.target.value })} /></label>}
            {provider === "YOUTUBE" && <label className="plan-check body-6"><input type="checkbox" checked={Boolean(values.nativeSchedule)}
              onChange={event => setValues({ ...values, nativeSchedule: event.target.checked })} /> Hand future public schedules to YouTube in advance</label>}
            {provider === "YOUTUBE" && <label className="clip-form-label title-4">Google OAuth publishing status<select className="clip-field body-6" value={values.googleMode ?? ""}
              onChange={event => setValues({ ...values, googleMode: event.target.value as ProviderValues["googleMode"] })}>
              <option value="">Not specified</option><option value="testing">Testing</option><option value="production">In Production</option>
            </select><span className="caption-5 muted">For local diagnostics. Check your Google Cloud Audience page for the current status.</span></label>}
            {provider === "GEMINI" && <label className="clip-form-label title-4">Gemini model
              <input className="clip-field body-6" list="gemini-models" value={values.model ?? ""} onChange={event => setValues({ ...values, model: event.target.value })} />
              <datalist id="gemini-models">{[...new Set([...freeGeminiModels, ...models.filter(supportsClipGeneration)])].map(model => <option value={model} key={model} />)}</datalist></label>}
            {callback && <div className="plan-stack"><label className="clip-form-label title-4">OAuth redirect URI
              <input className="clip-field caption-5 technical" readOnly value={callback} /></label>
              <div><Button onClick={async () => { try { await navigator.clipboard.writeText(callback); setResult({ message: "Redirect URI copied." }); }
                catch { setError("Copy the URI from the field above."); } }}><CopyIcon size={16} aria-hidden="true" />Copy redirect URI</Button></div></div>}
            <details><summary className="title-4">Setup checklist</summary><ol className="integration-checklist">{info.steps.map(step => <li key={step} className="body-6">{step}</li>)}</ol></details>
            <a className="workspace-link body-6" href={info.url} target="_blank" rel="noreferrer">Open provider console</a>
            {result && <p role="status" className="body-6">{result.message}</p>}
            {error && <p role="alert" className="body-6 form-error">{error}</p>}
            {erase && <p className="body-6">Clear saved credentials and prevent environment fallback?{oauth && " Affected accounts will need to reconnect."}</p>}
          </div>
          <footer className="clip-dialog-footer">
            {item.hasSecret && <Button disabled={busy} onClick={() => erase ? void act("clear") : setErase(true)}>{erase ? "Confirm clear" : "Clear saved credentials"}</Button>}
            {provider === "GEMINI" && <Button disabled={busy} onClick={() => void act("test", true)}>Test API key</Button>}
            <Button disabled={busy} onClick={() => void act("test")}>{provider === "GEMINI" ? "Test model" : oauth ? "Test configuration" : "Test API key"}</Button>
            <Button disabled={busy} type="submit" variant="primary">{busy ? "Checking" : "Save configuration"}</Button>
          </footer>
        </form>
      </Modal>
      <Button disabled={busy || !item.hasSecret} onClick={() => void act("test")}>Test connection</Button>
      {oauth && <Button disabled={busy || !item.hasSecret} onClick={async () => {
        setBusy(true); setError("");
        try { await connectAccount(provider); }
        catch (problem) { setError(problem instanceof Error ? problem.message : "Could not start authorization."); setBusy(false); }
      }}>Connect {info.name} account</Button>}
    </div>
    <details><summary className="title-4">Setup instructions</summary><ol className="integration-checklist">{info.steps.map(step => <li key={step} className="body-6">{step}</li>)}</ol>
      <a className="workspace-link body-6" href={info.url} target="_blank" rel="noreferrer">Open provider console</a></details>
  </Card>;
}

export function LocalConfig({ initial, address, storage, ffmpeg, ffprobe, online }: {
  initial: LocalSettings; address: string; storage: string; ffmpeg: string; ffprobe: string; online: boolean;
}) {
  const [settings, setSettings] = useState(initial);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const fields = [["uploadMib", "Upload limit in MiB", 2047], ["concurrency", "Worker concurrency", 6], ["perAccount", "Concurrency per account", 3],
    ["youtubeDaily", "YouTube project upload allowance", 10000], ["accountDaily", "Local daily uploads per account", 100]] as const;
  return <Card className="overview-panel plan-stack">
    <div className="plan-avatar"><CpuIcon size={22} aria-hidden="true" /><h2 className="dashboard-section">Local system</h2></div>
    <dl className="settings-data">
      {[["Address", address], ["Storage", storage], ["FFmpeg", ffmpeg], ["FFprobe", ffprobe], ["Worker", online ? "Available" : "Offline"]].map(([name, value]) =>
        <div key={name}><dt className="title-4">{name}</dt><dd className="body-6 technical">{name === "Worker" ? <Status state={online ? "ONLINE" : "OFFLINE"}>{value}</Status> : value}</dd></div>)}</dl>
    <p className="caption-2 muted">Storage and executable paths are server settings and require a restart. ClipFlow does not execute programs supplied through this form.</p>
    <form className="plan-stack" onSubmit={async event => {
      event.preventDefault(); setBusy(true); setStatus("");
      try { await planningRequest("/api/integrations", "POST", { provider: "LOCAL", ...settings }); setStatus("Local configuration saved."); }
      catch (problem) { setStatus(problem instanceof Error ? problem.message : "Could not save configuration."); }
      finally { setBusy(false); }
    }}>
      <div className="plan-fields">
        {fields.map(([field, label, maximum]) => <label className="clip-form-label title-4" key={field}>{label}
          <input required className="clip-field body-6" type="number" min={1} max={maximum} value={settings[field] || ""}
            onChange={event => setSettings({ ...settings, [field]: Number(event.target.value) })} /></label>)}
        <label className="clip-form-label title-4">Default timezone<input required className="clip-field body-6" value={settings.timezone}
          onChange={event => setSettings({ ...settings, timezone: event.target.value })} /></label>
        <label className="clip-form-label title-4">Missed posting time<select className="clip-field body-6" value={settings.missed}
          onChange={event => setSettings({ ...settings, missed: event.target.value as LocalSettings["missed"] })}>
          <option value="REVIEW">Require manual review</option><option value="CATCH_UP">Run when back online</option><option value="MOVE">Move to the next local slot</option>
        </select></label>
        <label className="clip-form-label title-4">YouTube Analytics auto refresh<select className="clip-field body-6" value={settings.analyticsHours}
          onChange={event => setSettings({ ...settings, analyticsHours: Number(event.target.value) })}>
          <option value={0}>Off</option><option value={24}>Once a day</option><option value={48}>Every two days</option><option value={168}>Once a week</option>
        </select><span className="caption-5 muted">Refreshes the last 28 days while the worker is online.</span></label>
      </div>
      {status && <p role="status" className="body-6">{status}</p>}
      <div><Button variant="primary" disabled={busy} type="submit">Save local configuration</Button></div>
    </form>
  </Card>;
}
