import { setTimeout as sleep } from "node:timers/promises";
import { db } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { extractSpeechAudio } from "@/lib/clips/media";
import { openMedia } from "@/lib/clips/storage";
import { validId } from "@/lib/planning/drafts";
import { providerConfig } from "./config";
import { ProviderError, providerFetch } from "./network";
import { transcriptLimit, transcriptionMaxSeconds } from "./transcript-limits";

const base = "https://api.assemblyai.com/v2";
type Transcript = { id?: string; status?: "queued" | "processing" | "completed" | "error"; text?: string | null };
let active = false;

async function request<T>(path: string, key: string, init: RequestInit, transport: typeof fetch, timeout = 20000): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", key);
  const response = await providerFetch(base + path, { ...init, headers }, timeout, transport);
  if (response.ok) {
    if (init.method === "DELETE") { await response.body?.cancel(); return undefined as T; }
    try { return await response.json() as T; }
    catch { throw new ProviderError("temporary", "AssemblyAI returned an unreadable response."); }
  }
  const details = await response.json().catch(() => null);
  if ([402, 403].includes(response.status) && /balance|billing|credits|payment/i.test(String(details?.error))) {
    throw new ProviderError("quota", "AssemblyAI requires available transcription credits. Check its billing dashboard.", response.status);
  }
  if ([401, 403].includes(response.status)) throw new ProviderError("authorization", "AssemblyAI rejected this key. Check it in Integrations.", response.status, 0, "INVALID_CREDENTIALS");
  if (response.status === 429) throw new ProviderError("quota", "AssemblyAI reached its request or quota limit. Try again later.", 429);
  if (response.status >= 500 || response.status === 408) throw new ProviderError("temporary", "AssemblyAI is temporarily unavailable. Try again later.", response.status);
  throw new ProviderError("permanent", "AssemblyAI could not accept this transcription request. Check the clip or paste a transcript.", response.status);
}

export async function verifyAssemblyKey(key: string, transport = fetch) {
  await request("/transcript?limit=1", key, {}, transport);
}

export async function transcribeClip(input: unknown, parent: AbortSignal, transport = fetch, pollMs = 2500) {
  const data = input as { clipId?: unknown; confirm?: boolean } | null;
  if (data?.confirm !== true || !validId(data.clipId)) throw new ClipError(400, "Select a clip and confirm sending its audio.");
  if (active) throw new ClipError(409, "Wait for the current transcription to finish.");
  active = true;
  const signal = AbortSignal.any([parent, AbortSignal.timeout(180000)]);
  let id: string | undefined;
  let key = "";
  let text = "";
  let cleanupConfirmed = false;
  try {
    const [clip, config] = await Promise.all([db().clip.findUnique({ where: { id: data.clipId } }), providerConfig("ASSEMBLYAI")]);
    key = config.secret;
    if (!key) throw new ClipError(409, "Save an AssemblyAI API key in Integrations.");
    if (!clip || clip.status !== "READY" || !clip.duration || !clip.audioCodec) throw new ClipError(422, "Choose a ready clip with an audio track.");
    if (clip.duration > transcriptionMaxSeconds) throw new ClipError(413, "AssemblyAI transcription in ClipFlow supports clips up to 10 minutes.");
    const file = await openMedia(clip.id, "video");
    let audio: Buffer;
    try {
      if (file.size !== clip.size) throw new ClipError(409, "The stored clip changed after import.");
      audio = await extractSpeechAudio(file.path, transcriptionMaxSeconds, signal);
    } finally { await file.handle.close(); }
    const uploaded = await request<{ upload_url?: unknown } | null>("/upload", key, { method: "POST", signal,
      headers: { "Content-Type": "application/octet-stream" }, body: new Uint8Array(audio) }, transport, 45000);
    const audioUrl = uploaded?.upload_url;
    if (typeof audioUrl !== "string") throw new ClipError(502, "AssemblyAI returned an unexpected upload reference.");
    const url = URL.parse(audioUrl);
    if (url?.protocol !== "https:" || url.username || url.password) {
      throw new ClipError(502, "AssemblyAI returned an unexpected upload reference.");
    }
    // AssemblyAI fetches this reference. Preserve the original URL, which may be signed.
    let result = await request<Transcript>("/transcript", key, { method: "POST", signal, headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: audioUrl, speech_models: ["universal-3-pro", "universal-2"], language_detection: true }) }, transport);
    if (!result.id || !/^[a-zA-Z0-9_-]{6,100}$/.test(result.id)) throw new ClipError(502, "AssemblyAI returned an invalid transcript ID.");
    id = result.id;
    while (result.status === "queued" || result.status === "processing") {
      await sleep(pollMs, undefined, { signal });
      result = await request<Transcript>(`/transcript/${id}`, key, { signal }, transport);
    }
    if (result.status !== "completed") throw new ClipError(422, "AssemblyAI could not transcribe the audio. Try manual text or a clip with clearer speech.");
    text = typeof result.text === "string" ? result.text.trim() : "";
    if (!text) throw new ClipError(422, "AssemblyAI did not find any speech in this clip.");
  } catch (error) {
    if (signal.aborted) throw new ClipError(408, "Transcription was cancelled or timed out.");
    if (error instanceof ProviderError) throw new ClipError(error.kind === "authorization" ? 403 : error.kind === "quota" ? 429 :
      error.kind === "temporary" ? 503 : 422, error.message);
    if (error instanceof TypeError) throw new ClipError(502, "AssemblyAI returned an invalid response.");
    throw error;
  } finally {
    try {
      if (id && key) { await request(`/transcript/${id}`, key, { method: "DELETE" }, transport, 5000); cleanupConfirmed = true; }
    } catch { /* Provider retention settings apply if deletion does not succeed. */ }
    active = false;
  }
  return { text: text.slice(0, transcriptLimit), truncated: text.length > transcriptLimit, cleanupConfirmed };
}
