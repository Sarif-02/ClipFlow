export type FailureKind = "temporary" | "permanent" | "authorization" | "quota" | "uncertain";
export class ProviderError extends Error {
  readonly kind: FailureKind;
  readonly status: number;
  readonly retryAfter: number;
  readonly reason: string;
  constructor(kind: FailureKind, message: string, status = 0, retryAfter = 0, reason = "") {
    super(message);
    this.kind = kind; this.status = status; this.retryAfter = retryAfter; this.reason = reason;
  }
}
export async function providerFetch(url: string | URL, init: RequestInit = {}, timeout = 25000, transport = fetch) {
  try {
    return await transport(url, { ...init, redirect: "manual", cache: "no-store",
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout) });
  } catch (error) {
    const timeout = error instanceof Error && /Timeout|Abort/.test(error.name);
    throw new ProviderError("temporary", timeout ? "Provider request timed out." : "Could not reach the provider. Check your network connection.");
  }
}
export async function responseError(response: Response): Promise<ProviderError> {
  const status = response.status;
  const body = await response.json().catch(() => null);
  const reason = String(body?.error?.errors?.[0]?.reason ?? body?.error?.details?.find((item: { reason?: string }) => item.reason)?.reason ??
    (typeof body?.error === "string" ? body.error : body?.error?.code ?? body?.error?.status ?? ""));
  const raw = response.headers.get("retry-after");
  const wait = raw ? (/^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 0;
  const retry = Number.isFinite(wait) ? Math.max(0, wait) : 0;
  if (status === 429 || /quota|ratelimit|uploadLimitExceeded|^(4|17|32|613|80004|2207042)$/i.test(reason)) {
    return new ProviderError("quota", "Provider quota or posting limit reached.", status, retry, reason);
  }
  if (/accessNotConfigured|SERVICE_DISABLED|apiNotEnabled/i.test(reason)) return new ProviderError("authorization", "Enable the required API in the provider console.", status, 0, "API_DISABLED");
  if (/API_KEY_INVALID|keyInvalid|invalid_client|^101$/.test(reason)) return new ProviderError("authorization", "The provider rejected the credentials.", status, 0, "INVALID_CREDENTIALS");
  if (reason === "youtubeSignupRequired") return new ProviderError("authorization", "Google authorized a profile without a YouTube channel. Reconnect and choose the intended channel.", status, 0, "PERMISSIONS");
  if (reason === "invalidCategoryId" || reason === "invalidTitle" || reason === "invalidDescription" || reason === "invalidTags") {
    const labels = { invalidCategoryId: "category", invalidTitle: "title", invalidDescription: "description", invalidTags: "tags" };
    return new ProviderError("permanent", `YouTube rejected the ${labels[reason]}. Correct it in a new draft before submitting again.`, status);
  }
  if (/invalid_grant|^190$/.test(reason) || status === 401) return new ProviderError("authorization", "Authorization expired or was revoked. Reconnect the account.", status, 0, "EXPIRED");
  if (status === 403 || /insufficientPermissions|^(10|200)$/.test(reason)) return new ProviderError("authorization", "The account is missing required permissions.", status, 0, "PERMISSIONS");
  if (status >= 500 || status === 408) return new ProviderError("temporary", "The provider is temporarily unavailable.", status, retry, reason);
  return new ProviderError("permanent", `The provider rejected the request (HTTP ${status}).`, status, 0, reason);
}
export async function providerJson<T>(url: string | URL, init?: RequestInit, transport?: typeof fetch): Promise<T> {
  const response = await providerFetch(url, init, 25000, transport);
  if (!response.ok) throw await responseError(response);
  try { return await response.json() as T; }
  catch { throw new ProviderError("temporary", "The provider returned an unreadable response."); }
}
export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
export const formPost = (values: Record<string, string>) => ({ method: "POST", body: new URLSearchParams(values) });
