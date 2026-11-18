import { db } from "@/lib/clips/db";
import { configInput, providerConfig, type Provider } from "./config";
import { ProviderError, providerJson } from "./network";
import { verifyAccount } from "./oauth";
import { verifyAssemblyKey } from "./assemblyai";

type Models = { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string };
export async function validateIntegration(provider: Provider, input: Record<string, unknown>) {
  const { current, values, secret } = await configInput(provider, input);
  const isSaved = current.secret === secret && current.values.model === values.model &&
    current.values.clientId === values.clientId && current.values.version === values.version &&
    (current.values.loginConfig || "") === (values.loginConfig || "");
  let models: string[] = [];
  let status = "AUTH_REQUIRED", message = "Configuration format is valid. Complete OAuth to verify the credentials.";
  try {
    if (provider === "ASSEMBLYAI") {
      await verifyAssemblyKey(secret);
      status = "VERIFIED"; message = "AssemblyAI accepted the key. Check your account for available transcription credits.";
    } else if (provider === "GEMINI") {
      const options = { headers: { "x-goog-api-key": secret } };
      const root = "https://generativelanguage.googleapis.com/v1beta";
      const collected = new Set<string>();
      let token = "";
      for (let page = 0; page < 4; page++) {
        const reply = await providerJson<Models>(`${root}/models?${new URLSearchParams({ pageSize: "100", ...(token ? { pageToken: token } : {}) })}`, options);
        for (const model of reply.models ?? []) if (model.supportedGenerationMethods?.includes("generateContent") && model.name.startsWith("models/gemini-")) collected.add(model.name.slice(7));
        token = reply.nextPageToken ?? "";
        if (!token) break;
      }
      models = [...collected].sort();
      if (values.model && input.keyOnly !== true) {
        const model = await providerJson<{ supportedGenerationMethods?: string[] }>(`${root}/models/${values.model}`, options);
        if (!model.supportedGenerationMethods?.includes("generateContent")) throw new ProviderError("permanent", "This model does not support content generation.");
      }
      status = "VERIFIED"; message = "Gemini confirmed access. Check your project tier in AI Studio; model access does not verify free usage.";
    } else if (isSaved) {
      const accounts = await db().socialAccount.findMany({ where: { platform: provider, status: "CONNECTED" }, select: { id: true }, take: 15 });
      if (accounts.length) {
        const results = await Promise.allSettled(accounts.map(account => verifyAccount(account.id)));
        const ok = results.filter(entry => entry.status === "fulfilled" && entry.value).length;
        if (!ok) {
          const error = results.find(entry => entry.status === "rejected");
          if (error?.status === "rejected") throw error.reason;
          throw new ProviderError("authorization", "Accounts are missing one or more required permissions.", 0, 0, "PERMISSIONS");
        }
        status = "CONNECTED"; message = `Verified ${ok} of ${accounts.length} connected accounts through read-only requests.`;
      }
    }
    if (isSaved && current.saved && !(provider === "GEMINI" && values.model && input.keyOnly === true)) await db().integrationConfig.updateMany({ where: { provider, revision: current.revision },
      data: { status, error: null, ...(status !== "AUTH_REQUIRED" ? { validatedAt: new Date() } : {}) } });
    return { status, message, models };
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError("temporary", "Connection verification failed.");
    status = failure.kind === "quota" ? "RATE_LIMITED" : failure.reason || (failure.kind === "authorization" ? "AUTH_REQUIRED" : "CONNECTION_FAILED");
    if (!["RATE_LIMITED", "API_DISABLED", "INVALID_CREDENTIALS", "EXPIRED", "PERMISSIONS", "AUTH_REQUIRED"].includes(status)) status = "CONNECTION_FAILED";
    if (isSaved && current.saved && (await providerConfig(provider)).revision === current.revision) {
      await db().integrationConfig.updateMany({ where: { provider, revision: current.revision }, data: { status, error: failure.message } });
    }
    return { status, message: failure.message, models };
  }
}
