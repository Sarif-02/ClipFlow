import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { postingTimezone } from "@/lib/planning/preferences";
import { seal, unseal } from "./secrets";

export const providers = ["YOUTUBE", "INSTAGRAM", "GEMINI", "ASSEMBLYAI"] as const;
export type Provider = typeof providers[number];
export type OAuthProvider = "YOUTUBE" | "INSTAGRAM";
export const isOAuthProvider = (provider: unknown): provider is OAuthProvider => provider === "YOUTUBE" || provider === "INSTAGRAM";
export type ProviderValues = { clientId?: string; version?: string; model?: string; loginConfig?: string; nativeSchedule?: boolean; googleMode?: "testing" | "production" };
export type LocalSettings = { concurrency: number; perAccount: number; youtubeDaily: number; accountDaily: number;
  missed: "REVIEW" | "CATCH_UP" | "MOVE"; timezone: string; paused: boolean; uploadMib: number; analyticsHours: number };
export const authScopes = {
  YOUTUBE: ["https://www.googleapis.com/auth/youtube.readonly", "https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/yt-analytics.readonly"],
  INSTAGRAM: ["instagram_basic", "instagram_content_publish", "pages_show_list", "pages_read_engagement"],
};
export function isProvider(value: unknown): value is Provider { return providers.includes(value as Provider); }

const revisionFor = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export async function providerConfig(provider: Provider) {
  const row = await db().integrationConfig.findUnique({ where: { provider } });
  if (row) return { values: row.values as ProviderValues, secret: row.secrets ? unseal<string>(row.secrets, provider) : "",
    revision: row.revision, status: row.status, validatedAt: row.validatedAt, connectedAt: row.connectedAt, error: row.error, saved: true };
  const { env } = process;
  const values: ProviderValues = provider === "YOUTUBE" ? { clientId: env.GOOGLE_CLIENT_ID } : provider === "INSTAGRAM"
    ? { clientId: env.META_APP_ID, version: env.META_API_VERSION || "v27.0", loginConfig: env.META_LOGIN_CONFIG_ID } : provider === "GEMINI" ? { model: env.GEMINI_MODEL } : {};
  const secret = (provider === "YOUTUBE" ? env.GOOGLE_CLIENT_SECRET : provider === "INSTAGRAM" ? env.META_APP_SECRET :
    provider === "GEMINI" ? env.GEMINI_API_KEY : env.ASSEMBLYAI_API_KEY) ?? "";
  return { values, secret, revision: revisionFor([values, secret]), status: secret ? (isOAuthProvider(provider) ? "AUTH_REQUIRED" : "SAVED") : "NOT_CONFIGURED",
    validatedAt: null, connectedAt: null, error: null, saved: false };
}

export function validateConfig(provider: Provider, values: ProviderValues, secret: string) {
  if (!secret) throw new ClipError(400, "Enter the required credential.");
  if (secret.length > 1024 || /\s/.test(secret)) throw new ClipError(400, "Credential format is invalid.");
  if (provider === "YOUTUBE" && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(values.clientId ?? "")) {
    throw new ClipError(400, "Enter a Google OAuth web client ID.");
  }
  if (provider === "INSTAGRAM" && !/^\d{5,30}$/.test(values.clientId ?? "")) throw new ClipError(400, "Enter the numeric Meta App ID.");
  if (provider === "INSTAGRAM" && !/^v(?:2[2-7])\.0$/.test(values.version ?? "")) throw new ClipError(400, "Enter a supported Meta API version (v22.0 to v27.0).");
  if (provider === "INSTAGRAM" && values.loginConfig && !/^\d{5,30}$/.test(values.loginConfig)) throw new ClipError(400, "Enter a numeric Facebook Login configuration ID.");
  if (provider === "GEMINI" && values.model && !/^gemini-[a-z\d.-]{1,100}$/.test(values.model)) throw new ClipError(400, "Choose a Gemini model ID.");
}

export async function configInput(provider: Provider, input: Record<string, unknown>) {
  const current = await providerConfig(provider);
  const value = (name: string) => typeof input[name] === "string" ? (input[name] as string).trim() : undefined;
  const values: ProviderValues = provider === "ASSEMBLYAI" ? {} : provider === "GEMINI" ? { model: value("model") ?? current.values.model ?? "" } :
    { clientId: value("clientId") ?? current.values.clientId ?? "",
      ...(provider === "INSTAGRAM" ? { version: value("version") ?? current.values.version ?? "v27.0", loginConfig: value("loginConfig") ?? current.values.loginConfig ?? "" } :
        { nativeSchedule: typeof input.nativeSchedule === "boolean" ? input.nativeSchedule : Boolean(current.values.nativeSchedule),
          ...((input.googleMode === "testing" || input.googleMode === "production") ? { googleMode: input.googleMode } :
            input.googleMode !== "" && current.values.googleMode ? { googleMode: current.values.googleMode } : {}) }) };
  const secret = value("secret") || current.secret;
  validateConfig(provider, values, secret);
  return { current, values, secret };
}

export async function writeConfig(provider: Provider, input: Record<string, unknown>) {
  const clear = input.clear === true;
  const config = clear ? { current: { values: {} as ProviderValues, secret: "", revision: "", status: "NOT_CONFIGURED", connectedAt: null, validatedAt: null, error: null },
    values: {}, secret: "" } : await configInput(provider, input);
  const changes = clear || config.current.secret !== config.secret || config.current.values.clientId !== (config.values as ProviderValues).clientId ||
    config.current.values.version !== (config.values as ProviderValues).version ||
    (config.current.values.loginConfig || "") !== ((config.values as ProviderValues).loginConfig || "") ||
    (config.current.values.model || "") !== ((config.values as ProviderValues).model || "");
  const data = { values: config.values, secrets: config.secret ? seal(config.secret, provider) : null,
    status: clear ? "NOT_CONFIGURED" : changes ? isOAuthProvider(provider) ? "AUTH_REQUIRED" : "SAVED" : config.current.status,
    revision: changes ? randomUUID() : config.current.revision, validatedAt: changes ? null : config.current.validatedAt,
    connectedAt: changes ? null : config.current.connectedAt, error: changes ? null : config.current.error };
  await db().$transaction(async tx => {
    if (changes && isOAuthProvider(provider) && await tx.job.count({ where: {
      target: { account: { platform: provider } }, leaseOwner: { not: null },
    } })) throw new ClipError(409, "Pause the queue and wait for active requests before changing these credentials.");
    await tx.integrationConfig.upsert({ where: { provider }, create: { provider, ...data }, update: data });
    if (changes && isOAuthProvider(provider)) {
      await tx.socialAccount.updateMany({ where: { platform: provider, status: { not: "DISCONNECTED" } }, data: { status: "AUTH_REQUIRED", canPublish: false, canAnalyze: false,
        authIssue: "Provider configuration changed." } });
      await tx.analyticsCache.deleteMany({ where: { account: { platform: provider } } });
      await tx.job.updateMany({ where: { target: { account: { platform: provider } }, leaseOwner: null,
        state: { in: ["QUEUED", "SCHEDULED", "RETRY", "PROCESSING", "AWAITING_PROVIDER"] } },
        data: { state: "PAUSED_AUTH", errorKind: "authorization", error: "Provider configuration changed. Reconnect and resume this job." } });
    }
  });
}

export async function integrationViews() {
  return Promise.all(providers.map(async provider => {
    let config;
    try { config = await providerConfig(provider); } catch {
      const row = await db().integrationConfig.findUnique({ where: { provider } });
      return { provider, values: (row?.values ?? {}) as ProviderValues, hasSecret: Boolean(row?.secrets), status: "INVALID_CREDENTIALS",
        validatedAt: undefined, connectedAt: undefined, error: "The saved credential could not be decrypted. Restore the matching master key, or clear this integration and reconnect.",
        saved: Boolean(row), count: 0 };
    }
    const { values, secret, status, validatedAt, connectedAt, error, saved } = config;
    const linked = await db().socialAccount.aggregate({ where: { platform: provider, status: "CONNECTED" },
      _count: true, _max: { verifiedAt: true } });
    const count = linked._count;
    return { provider, values, hasSecret: Boolean(secret), status: error ? status : count > 0 ? "CONNECTED" : status === "CONNECTED" ? "AUTH_REQUIRED" : status,
      validatedAt: (validatedAt ?? linked._max.verifiedAt)?.toISOString(), connectedAt: (connectedAt ?? linked._max.verifiedAt)?.toISOString(), error, saved, count };
  }));
}

const integer = (value: unknown, minimum: number, maximum: number) =>
  typeof value === "number" && Number.isInteger(value) && value >= minimum && value <= maximum;
export async function runtimeSettings(): Promise<LocalSettings> {
  const row = await db().appSetting.findUnique({ where: { key: "runtime" } });
  const mib = Number(process.env.MAX_UPLOAD_MIB || 512);
  return { concurrency: 2, perAccount: 1, youtubeDaily: 100, accountDaily: 25, missed: "REVIEW",
    timezone: postingTimezone(), paused: false, uploadMib: integer(mib, 1, 2047) ? mib : 512, analyticsHours: 0,
    ...(row?.value as Partial<LocalSettings> | null) };
}
export async function saveRuntime(value: Record<string, unknown>) {
  if (!integer(value.concurrency, 1, 6) || !integer(value.perAccount, 1, 3) ||
    !integer(value.youtubeDaily, 1, 10000) || !integer(value.accountDaily, 1, 100) ||
    !integer(value.uploadMib, 1, 2047) || !["CATCH_UP", "MOVE", "REVIEW"].includes(String(value.missed)) ||
    (value.analyticsHours !== undefined && ![0, 24, 48, 168].includes(Number(value.analyticsHours))) ||
    typeof value.timezone !== "string" || value.timezone.length > 64) throw new ClipError(400, "Check the local configuration limits.");
  try { new Intl.DateTimeFormat("en", { timeZone: value.timezone }); } catch { throw new ClipError(400, "Use a valid timezone, such as Asia/Kolkata."); }
  const data = { concurrency: Number(value.concurrency), perAccount: Number(value.perAccount), youtubeDaily: Number(value.youtubeDaily),
    accountDaily: Number(value.accountDaily), uploadMib: Number(value.uploadMib), missed: String(value.missed), timezone: value.timezone,
    ...(value.analyticsHours !== undefined ? { analyticsHours: Number(value.analyticsHours) } : {}) };
  await updateRuntime(data);
}
export async function updateRuntime(patch: Record<string, string | boolean | number>) {
  await db().$transaction(async tx => {
    const row = await tx.appSetting.findUnique({ where: { key: "runtime" } });
    const value = { ...(row?.value as Record<string, string | boolean | number> | undefined), ...patch };
    await tx.appSetting.upsert({ where: { key: "runtime" }, create: { key: "runtime", value }, update: { value } });
  });
}

export function applicationOrigin() {
  const value = (process.env.APP_URL || "http://localhost:3001").replace(/\/$/, "");
  if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(value)) throw new ClipError(400, "APP_URL must use an HTTP loopback address.");
  return value;
}
export const oauthRedirect = (provider: OAuthProvider) => provider === "YOUTUBE"
  ? `${applicationOrigin()}/api/oauth/youtube/callback` : "https://localhost:3443/api/oauth/instagram/callback";
