import { createHash, randomBytes } from "node:crypto";
import { db } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { YouTubeReportError, youtubeProvider } from "@/lib/analytics/youtube";
import { reportingRange } from "@/lib/analytics/model";
import { applicationOrigin, authScopes, oauthRedirect, providerConfig, validateConfig, type OAuthProvider } from "./config";
import { bearer, formPost, ProviderError, providerJson } from "./network";
import { seal, unseal } from "./secrets";

export const bindingCookie = "clipflow_oauth";
const digest = (value: string) => createHash("sha256").update(value).digest("base64url");
const random = () => randomBytes(32).toString("base64url");
const googleToken = "https://oauth2.googleapis.com/token";
type Token = { access: string; refresh?: string; exchangeToken?: string; scopes: string[] };
type GoogleReply = { access_token: string; refresh_token?: string; scope?: string; expires_in?: number };
type MetaReply = { access_token: string; expires_in?: number };
type Identity = { remoteId: string; name: string; avatar?: string; token: Token; expiresAt: Date | null; canPublish: boolean; canAnalyze: boolean };
const expiry = (seconds?: number) => Number.isFinite(seconds) && seconds! > 0 ? new Date(Date.now() + seconds! * 1000) : null;
export const graphRoot = (version = "v27.0") => `https://graph.facebook.com/${version}`;
const knownPlatform = (value: string): value is OAuthProvider => value === "YOUTUBE" || value === "INSTAGRAM";

export async function beginOAuth(provider: OAuthProvider, browser: string, reconnectId?: string) {
  const config = await providerConfig(provider);
  validateConfig(provider, config.values, config.secret);
  if (provider === "INSTAGRAM" && (!process.env.META_TLS_CERT || !process.env.META_TLS_KEY || new URL(applicationOrigin()).hostname !== "localhost")) {
    throw new ClipError(409, "Instagram needs the localhost HTTPS callback configured in the setup guide.");
  }
  if (reconnectId && !(await db().socialAccount.count({ where: { id: reconnectId, platform: provider } }))) throw new ClipError(404, "Account not found.");
  const state = random();
  const verifier = provider === "YOUTUBE" ? random() : null;
  const redirectUri = oauthRedirect(provider);
  await db().oAuthState.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  await db().oAuthState.create({ data: { hash: digest(state), provider, browserHash: digest(browser), verifier, reconnectId, redirectUri,
    revision: config.revision, expiresAt: new Date(Date.now() + 600000) } });
  const params = new URLSearchParams({ client_id: config.values.clientId!, redirect_uri: redirectUri, state,
    scope: authScopes[provider].join(provider === "YOUTUBE" ? " " : ","), response_type: "code" });
  if (verifier) {
    params.set("access_type", "offline"); params.set("prompt", "consent select_account");
    params.set("code_challenge", digest(verifier)); params.set("code_challenge_method", "S256");
  }
  if (provider === "INSTAGRAM" && config.values.loginConfig) {
    params.set("config_id", config.values.loginConfig);
    params.delete("scope");
    params.set("override_default_response_type", "true");
  }
  return (provider === "YOUTUBE" ? "https://accounts.google.com/o/oauth2/v2/auth" :
    `https://www.facebook.com/${config.values.version}/dialog/oauth`) + "?" + params.toString();
}

export function newBrowserBinding() { return random(); }

export async function consumeOAuth(provider: OAuthProvider, state: string, browser: string) {
  if (!/^[a-z\d_-]{43}$/i.test(state) || !/^[a-z\d_-]{43}$/i.test(browser)) throw new ClipError(403, "OAuth session expired. Start the connection again.");
  const hash = digest(state);
  return db().$transaction(async tx => {
    const result = await tx.oAuthState.findFirst({ where: { hash, provider, browserHash: digest(browser), expiresAt: { gt: new Date() } } });
    if (!result) throw new ClipError(403, "OAuth session expired or was already used. Start the connection again.");
    await tx.oAuthState.delete({ where: { hash } });
    return result;
  });
}

async function googleIdentities(reply: GoogleReply, revision: string) {
  const scopes = (reply.scope ?? "").split(/\s+/);
  if (!scopes.includes(authScopes.YOUTUBE[0])) throw new ProviderError("authorization", "YouTube channel read permission was not granted.");
  const result = await providerJson<{ items?: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string } } } }[] }>(
    "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true&maxResults=50", { headers: bearer(reply.access_token) });
  if (result.items?.length !== 1) throw new ProviderError("authorization", "Authorize one YouTube channel per connection.");
  const channel = result.items[0];
  const old = await db().oAuthCredential.findFirst({ where: { revision, account: { platform: "YOUTUBE", remoteId: channel.id } } });
  const refresh = reply.refresh_token || (old ? unseal<Token>(old.sealed, old.accountId).refresh : undefined);
  if (!refresh) throw new ProviderError("authorization", "Google did not grant offline access. Reconnect and approve consent.");
  let canAnalyze = scopes.includes(authScopes.YOUTUBE[2]);
  if (canAnalyze) {
    try { await youtubeProvider(async () => reply.access_token).totals(channel.id, reportingRange("7", "", "")!); }
    catch { canAnalyze = false; }
  }
  return [{ remoteId: channel.id, name: channel.snippet.title, avatar: channel.snippet.thumbnails?.default?.url,
    token: { access: reply.access_token, refresh, scopes }, expiresAt: expiry(reply.expires_in),
    canPublish: scopes.includes(authScopes.YOUTUBE[1]), canAnalyze }];
}

async function metaPermissions(root: string, token: string) {
  const reply = await providerJson<{ data?: { permission: string; status: string }[] }>(`${root}/me/permissions`, { headers: bearer(token) });
  return (reply.data ?? []).filter(item => item.status === "granted").map(item => item.permission);
}
type MetaPages = { data?: { access_token?: string; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[];
  paging?: { next?: string; cursors?: { after?: string } } };
async function metaIdentities(root: string, user: MetaReply) {
  const scopes = await metaPermissions(root, user.access_token);
  if (!authScopes.INSTAGRAM.every(scope => scopes.includes(scope))) throw new ProviderError("authorization", "Grant Instagram publishing and linked Page permissions.", 0, 0, "PERMISSIONS");
  const accounts = new Map<string, Identity>();
  let cursor = "";
  for (let index = 0; index < 10; index++) {
    const session: MetaPages = await providerJson(`${root}/me/accounts?${new URLSearchParams({
      fields: "access_token,instagram_business_account{id,username,profile_picture_url}", limit: "50", ...(cursor ? { after: cursor } : {}),
    })}`, { headers: bearer(user.access_token) });
    for (const page of session.data ?? []) {
      const profile = page.instagram_business_account;
      if (!profile || !page.access_token) continue;
      accounts.set(profile.id, { remoteId: profile.id, name: profile.username ?? profile.id, avatar: profile.profile_picture_url,
        expiresAt: expiry(user.expires_in), token: { access: page.access_token, exchangeToken: user.access_token, scopes },
        canAnalyze: false, canPublish: true });
    }
    const after: string = session.paging?.next ? session.paging.cursors?.after ?? "" : "";
    if (!after || after === cursor) break;
    cursor = after;
  }
  if (!accounts.size) throw new ProviderError("authorization", "No eligible professional Instagram accounts linked to an authorized Facebook Page were found.");
  return [...accounts.values()];
}

export async function finishOAuth(provider: OAuthProvider, state: Awaited<ReturnType<typeof consumeOAuth>>, code: string) {
  const config = await providerConfig(provider);
  if (config.revision !== state.revision) throw new ClipError(409, "Configuration changed. Start authorization again.");
  const params = { client_id: config.values.clientId!, client_secret: config.secret, code, redirect_uri: state.redirectUri };
  let identities: Identity[];
  if (provider === "YOUTUBE") {
    const reply = await providerJson<GoogleReply>(googleToken, formPost({ ...params, grant_type: "authorization_code", code_verifier: state.verifier! }));
    identities = await googleIdentities(reply, config.revision);
  } else {
    const root = graphRoot(config.values.version);
    const short = await providerJson<MetaReply>(`${root}/oauth/access_token?${new URLSearchParams(params)}`);
    const long = await providerJson<MetaReply>(`${root}/oauth/access_token?${new URLSearchParams({
      client_id: params.client_id, client_secret: params.client_secret, grant_type: "fb_exchange_token", fb_exchange_token: short.access_token,
    })}`);
    identities = await metaIdentities(root, long);
    for (const identity of identities) {
      try {
        await providerJson(`${root}/${encodeURIComponent(identity.remoteId)}/content_publishing_limit?fields=config,quota_usage`,
          { headers: bearer(identity.token.access) });
      } catch { identity.canPublish = false; }
    }
  }
  if (state.reconnectId) {
    const account = await db().socialAccount.findUnique({ where: { id: state.reconnectId } });
    identities = identities.filter(identity => identity.remoteId === account?.remoteId);
    if (!identities.length) throw new ClipError(409, "The authorized account does not match the account being reconnected.");
  }
  if ((await providerConfig(provider)).revision !== config.revision) throw new ClipError(409, "Configuration changed. Start authorization again.");
  const now = new Date();
  await db().$transaction(async tx => {
    const saved = await tx.integrationConfig.findUnique({ where: { provider }, select: { revision: true } });
    if (saved && saved.revision !== config.revision) throw new ClipError(409, "Configuration changed. Start authorization again.");
    for (const identity of identities) {
      const fields = { name: identity.name, avatar: identity.avatar ?? null, status: "CONNECTED", canPublish: identity.canPublish,
        canAnalyze: identity.canAnalyze, verifiedAt: now, lastApiAt: now,
        authIssue: identity.canPublish && (provider !== "YOUTUBE" || identity.canAnalyze) ? null : "One or more provider permissions could not be verified." };
      const { id } = await tx.socialAccount.upsert({ where: { platform_remoteId: { platform: provider, remoteId: identity.remoteId } },
        create: { ...fields, platform: provider, remoteId: identity.remoteId }, update: fields });
      const token = { sealed: seal(identity.token, id), revision: config.revision, expiresAt: identity.expiresAt, refreshedAt: null };
      await tx.oAuthCredential.upsert({ where: { accountId: id }, create: { accountId: id, ...token }, update: token });
    }
    await tx.integrationConfig.updateMany({ where: { provider, revision: config.revision },
      data: { status: "CONNECTED", connectedAt: now, validatedAt: now, error: null } });
  });
  return identities.length;
}

const refreshing = new Map<string, Promise<string>>();
export async function flagCredential(accountId: string, sealed: string, reason: string) {
  await db().$transaction(async tx => {
    const updated = await tx.socialAccount.updateMany({ where: { id: accountId, status: "CONNECTED", credential: { sealed } },
      data: { status: "AUTH_REQUIRED", canPublish: false, canAnalyze: false, authIssue: reason } });
    if (!updated.count) return;
    await tx.analyticsCache.deleteMany({ where: { accountId } });
    await tx.job.updateMany({ where: { target: { accountId }, leaseOwner: null, state: { in: ["QUEUED", "SCHEDULED", "RETRY", "PROCESSING", "AWAITING_PROVIDER"] } },
      data: { state: "PAUSED_AUTH", errorKind: "authorization", error: reason } });
  });
}

export async function accountToken(accountId: string) {
  const account = await db().socialAccount.findUnique({ where: { id: accountId }, include: { credential: true } });
  if (!account?.credential || account.status !== "CONNECTED" || !knownPlatform(account.platform)) throw new ProviderError("authorization", "Reconnect the destination account.");
  const config = await providerConfig(account.platform);
  if (!config.secret || config.revision !== account.credential.revision) throw new ProviderError("authorization", "Configuration changed. Reconnect the account.");
  const token = unseal<Token>(account.credential.sealed, accountId);
  if (!account.credential.expiresAt || +account.credential.expiresAt > Date.now() + 120000) return token.access;
  if (account.platform === "INSTAGRAM") {
    const reason = "Meta authorization expired. Reconnect the linked Page.";
    await flagCredential(accountId, account.credential.sealed, reason);
    throw new ProviderError("authorization", reason, 0, 0, "EXPIRED");
  }
  if (!token.refresh) throw new ProviderError("authorization", "No offline access. Reconnect the channel.");
  if (refreshing.has(accountId)) return refreshing.get(accountId)!;
  const refresh = (async () => {
    const reply = await providerJson<GoogleReply>(googleToken, formPost({
      client_id: config.values.clientId!, client_secret: config.secret, refresh_token: token.refresh!, grant_type: "refresh_token",
    }));
    const result = await db().oAuthCredential.updateMany({ where: { accountId, revision: config.revision, sealed: account.credential!.sealed,
      account: { status: "CONNECTED" } }, data: {
      sealed: seal({ ...token, access: reply.access_token, refresh: reply.refresh_token ?? token.refresh, scopes: reply.scope?.split(/\s+/) ?? token.scopes }, accountId),
      expiresAt: expiry(reply.expires_in), refreshedAt: new Date(),
    } });
    if (!result.count) {
      const latest = await db().oAuthCredential.findFirst({ where: { accountId, revision: config.revision, account: { status: "CONNECTED" } } });
      if (latest && latest.sealed !== account.credential!.sealed) return unseal<Token>(latest.sealed, accountId).access;
      throw new ProviderError("authorization", "Account authorization changed. Reconnect the account.");
    }
    return reply.access_token;
  })().catch(async error => {
    if (error instanceof ProviderError && error.kind === "authorization" && /EXPIRED|INVALID/.test(error.reason)) {
      await flagCredential(accountId, account.credential!.sealed, error.message);
    }
    throw error;
  }).finally(() => refreshing.delete(accountId));
  refreshing.set(accountId, refresh);
  return refresh;
}

export async function verifyAccount(id: string) {
  const account = await db().socialAccount.findUnique({ where: { id }, include: { credential: true } });
  if (!account?.credential || !knownPlatform(account.platform)) throw new ClipError(404, "Connect this account first.");
  try {
    const token = await accountToken(id);
    const current = await db().oAuthCredential.findUnique({ where: { accountId: id } });
    if (!current || current.revision !== account.credential.revision) throw new ProviderError("authorization", "Account authorization changed. Reconnect the account.");
    const stored = unseal<Token>(current.sealed, id);
    let canPublish = false, canAnalyze = false;
    if (account.platform === "YOUTUBE") {
      const provider = youtubeProvider(async () => token);
      await provider.channel(account.remoteId);
      canPublish = stored.scopes.includes(authScopes.YOUTUBE[1]);
      if (stored.scopes.includes(authScopes.YOUTUBE[2])) {
        await provider.totals(account.remoteId, reportingRange("7", "", "")!);
        canAnalyze = true;
      }
    } else {
      const config = await providerConfig("INSTAGRAM");
      const root = graphRoot(config.values.version);
      const scopes = await metaPermissions(root, stored.exchangeToken ?? token);
      const identity = await providerJson<{ id: string }>(`${root}/${encodeURIComponent(account.remoteId)}?fields=id,username`, { headers: bearer(token) });
      canPublish = identity.id === account.remoteId && authScopes.INSTAGRAM.every(scope => scopes.includes(scope));
      if (canPublish) await providerJson(`${root}/${encodeURIComponent(account.remoteId)}/content_publishing_limit?fields=config,quota_usage`, { headers: bearer(token) });
    }
    const result = await db().socialAccount.updateMany({ where: { id, status: "CONNECTED", credential: { revision: account.credential.revision } },
      data: { verifiedAt: new Date(), lastApiAt: new Date(), canPublish, canAnalyze,
        authIssue: canPublish && (account.platform !== "YOUTUBE" || canAnalyze) ? null : "One or more required permissions are missing." } });
    return Boolean(result.count && canPublish && (account.platform !== "YOUTUBE" || canAnalyze));
  } catch (error) {
    if (error instanceof ProviderError && error.kind === "authorization" && /EXPIRED|INVALID/.test(error.reason)) {
      await flagCredential(id, account.credential.sealed, error.message);
    }
    if (error instanceof YouTubeReportError && error.kind === "authorization") {
      await db().socialAccount.updateMany({ where: { id, status: "CONNECTED", credential: { revision: account.credential.revision } },
        data: { authIssue: "Check YouTube and Analytics permissions, then verify this account." } });
    }
    if (error instanceof YouTubeReportError) throw new ProviderError(error.kind === "provider" ? "temporary" : error.kind,
      error.kind === "quota" ? "YouTube quota is exhausted." : error.kind === "authorization" ? "Verify YouTube or Analytics API permissions." : "The YouTube read check failed.",
      0, 0, error.kind === "authorization" ? "PERMISSIONS" : "");
    throw error;
  }
}
