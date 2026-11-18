import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

registerHooks({ resolve(specifier, context, next) {
  const url = specifier.startsWith("@/") ? pathToFileURL(resolve("src", specifier.slice(2))).href :
    specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? new URL(specifier, context.parentURL).href : null;
  if (url && existsSync(fileURLToPath(url + ".ts"))) return next(url + ".ts", context);
  return next(specifier, context);
} });

test("isolated publishing configuration, OAuth, durable jobs and mocked provider checkpoints", { timeout: 90000 }, async () => {
  const sandbox = resolve("data", "test-runs");
  await mkdir(sandbox, { recursive: true });
  const root = await mkdtemp(join(sandbox, "publishing-"));
  const database = join(root, "publish.db");
  Object.assign(process.env, { DATABASE_URL: `file:${database}`, STORAGE_PATH: join(root, "managed"),
    GOOGLE_CLIENT_ID: "env.apps.googleusercontent.com", GOOGLE_CLIENT_SECRET: "env-secret", TOKEN_ENCRYPTION_KEY: "", APP_URL: "http://localhost:3001" });
  execFileSync(process.execPath, ["scripts/migrate.mjs"], { env: process.env, windowsHide: true, stdio: "inherit" });
  const { db, enableWorkerWal } = await import("../src/lib/clips/db.ts");
  const { authScopes, writeConfig, providerConfig, integrationViews, updateRuntime } = await import("../src/lib/integrations/config.ts");
  const { seal, unseal } = await import("../src/lib/integrations/secrets.ts");
  const { beginOAuth, consumeOAuth, newBrowserBinding, finishOAuth, accountToken } = await import("../src/lib/integrations/oauth.ts");
  const { validateIntegration } = await import("../src/lib/integrations/validation.ts");
  const { generateSuggestion } = await import("../src/lib/integrations/gemini.ts");
  const { transcribeClip } = await import("../src/lib/integrations/assemblyai.ts");
  const { refreshAutomaticAnalytics } = await import("../src/lib/analytics/automatic.ts");
  const { changeTemplate, listTemplates } = await import("../src/lib/planning/template-store.ts");
  const { renderTemplate } = await import("../src/lib/planning/templates.ts");
  const { blankContent, emptyDraft } = await import("../src/lib/planning/model.ts");
  const { saveDraft, removeDraft } = await import("../src/lib/planning/drafts.ts");
  const { importClip } = await import("../src/lib/clips/storage.ts");
  const { queueDraft, claimJob, recoverLeases, reserveUpload, changeJob, jobDetail, quotaWindow } = await import("../src/lib/publishing/queue.ts");
  const { processJob, runCleanup } = await import("../src/lib/publishing/worker.ts");
  const { ProviderError } = await import("../src/lib/integrations/network.ts");
  const { youtubePublisher, instagramPublisher } = await import("../src/lib/publishing/providers.ts");
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error("Unexpected external request"); };
  try {
    await enableWorkerWal();
    assert.equal((await providerConfig("YOUTUBE")).secret, "env-secret");
    await assert.rejects(writeConfig("YOUTUBE", { clientId: "invalid", secret: "sample" }), /client ID/);
    await writeConfig("YOUTUBE", { clear: true });
    assert.equal((await providerConfig("YOUTUBE")).secret, "");
    await writeConfig("YOUTUBE", { clientId: "clip.apps.googleusercontent.com", secret: "youtube-secret" });
    assert(!JSON.stringify(await integrationViews()).includes("youtube-secret"));
    const ciphertext = (await db().integrationConfig.findUnique({ where: { provider: "YOUTUBE" } })).secrets;
    assert(!ciphertext.includes("youtube-secret"));
    assert.notEqual(seal("same", "test"), seal("same", "test"));
    assert.throws(() => unseal(ciphertext, "INSTAGRAM"));
    assert.equal((await readFile(join(root, ".clipflow-private", "master.key"))).length, 32);
    assert.equal((await validateIntegration("YOUTUBE", {})).status, "AUTH_REQUIRED");
    const browser = newBrowserBinding();
    const authorize = new URL(await beginOAuth("YOUTUBE", browser));
    assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
    const state = authorize.searchParams.get("state");
    await assert.rejects(consumeOAuth("YOUTUBE", state, newBrowserBinding()), /expired/);
    const payload = await consumeOAuth("YOUTUBE", state, browser);
    await assert.rejects(consumeOAuth("YOUTUBE", state, browser), /already used/);
    const fullScopes = "https://www.googleapis.com/auth/youtube.readonly https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/yt-analytics.readonly";
    let selected = "first-channel";
    let assemblyUploadUrl = "https://cdn.assemblyai.com/upload/speech-fixture";
    let assemblySubmissions = 0;
    globalThis.fetch = async (raw, init) => {
      const url = new URL(raw);
      if (url.hostname === "oauth2.googleapis.com") {
        if (init.body.get("grant_type") === "refresh_token") return Response.json({ access_token: "fresh-first", expires_in: 3600 });
        if (init.body.get("code") === "deny") return Response.json({ error: "invalid_grant" }, { status: 400 });
        return Response.json({ access_token: `token-${selected}`, refresh_token: `refresh-${selected}`, expires_in: 3600, scope: fullScopes });
      }
      if (url.hostname === "www.googleapis.com") {
        const channel = url.searchParams.get("id") ?? selected;
        return Response.json({ items: [{ id: channel, snippet: { title: channel } }] });
      }
      if (url.hostname === "youtubeanalytics.googleapis.com") return Response.json({});
      if (url.hostname === "graph.facebook.com") {
        if (url.pathname.endsWith("/oauth/access_token")) {
          if (url.searchParams.get("grant_type") === "fb_exchange_token") {
            assert.equal(url.searchParams.get("fb_exchange_token"), "mock-short");
            return Response.json({ access_token: "mock-long", expires_in: 3600 });
          }
          assert.equal(url.searchParams.get("redirect_uri"), "https://localhost:3443/api/oauth/instagram/callback");
          return Response.json({ access_token: "mock-short" });
        }
        if (url.pathname.endsWith("/me/permissions")) {
          assert.equal(init.headers.Authorization, "Bearer mock-long");
          return Response.json({ data: authScopes.INSTAGRAM.map(permission => ({ permission, status: "granted" })) });
        }
        if (url.pathname.endsWith("/me/accounts")) return Response.json({ data: [{ id: "unlinked" },
          { access_token: "mock-page", instagram_business_account: { id: "123456", username: "creator" } }] });
        if (url.pathname.endsWith("/content_publishing_limit")) {
          assert.equal(init.headers.Authorization, "Bearer mock-page");
          return Response.json({ data: [] });
        }
      }
      if (url.hostname === "api.assemblyai.com") {
        assert.equal(new Headers(init.headers).get("Authorization"), "assembly-key");
        if (url.searchParams.has("limit")) return Response.json({ transcripts: [] });
        if (url.pathname.endsWith("/upload")) {
          assert.equal(init.method, "POST");
          assert.equal(new Headers(init.headers).get("Content-Type"), "application/octet-stream");
          assert.equal(Buffer.from(init.body).subarray(0, 3).toString(), "ID3");
          return Response.json({ upload_url: assemblyUploadUrl });
        }
        if (init.method === "POST") {
          assert.equal(url.pathname, "/v2/transcript");
          assert.equal(JSON.parse(init.body).audio_url, assemblyUploadUrl);
          assemblySubmissions++;
          return Response.json({ id: "fixture-id", status: "queued" });
        }
        if (init.method === "DELETE") return new Response(null, { status: 204 });
        return Response.json({ status: "completed", text: "The mock transcript was returned." });
      }
      if (url.hostname === "generativelanguage.googleapis.com") {
        assert.equal(new Headers(init.headers).get("x-goog-api-key"), "gemini-key");
        if (url.pathname.endsWith(":generateContent")) {
          const request = JSON.parse(init.body);
          assert.equal(request.generationConfig.responseMimeType, "application/json");
          assert.deepEqual(request.generationConfig.responseJsonSchema.required, ["title"]);
          return Response.json({ candidates: [{ content: { parts: [{ text: '{"title":"SDK fixture"}' }], role: "model" }, finishReason: "STOP" }] });
        }
        return Response.json(url.pathname.endsWith("/models") ? { models: [{ name: "models/gemini-test", supportedGenerationMethods: ["generateContent"] }] } :
          { supportedGenerationMethods: ["generateContent"] });
      }
      throw new Error("Unexpected mock URL");
    };
    await assert.rejects(finishOAuth("YOUTUBE", payload, "deny"), /expired or was revoked/);
    await finishOAuth("YOUTUBE", payload, "code");
    selected = "second-channel";
    const next = new URL(await beginOAuth("YOUTUBE", browser));
    await finishOAuth("YOUTUBE", await consumeOAuth("YOUTUBE", next.searchParams.get("state"), browser), "code");
    const [first, second] = await db().socialAccount.findMany({ orderBy: { name: "asc" } });
    await db().oAuthCredential.update({ where: { accountId: first.id }, data: { expiresAt: new Date(0) } });
    assert.equal(await accountToken(first.id), "fresh-first");
    assert.equal(await accountToken(second.id), "token-second-channel");
    assert((await db().oAuthCredential.findUniqueOrThrow({ where: { accountId: first.id } })).refreshedAt);
    const autoSignal = new AbortController().signal;
    await refreshAutomaticAnalytics(24, new Date(), autoSignal);
    assert.equal(await db().analyticsCache.count(), 2);
    const firstSync = (await db().appSetting.findUniqueOrThrow({ where: { key: "analytics:auto" } })).updatedAt;
    await refreshAutomaticAnalytics(24, new Date(Date.now() + 5000), autoSignal);
    assert.equal(+(await db().appSetting.findUniqueOrThrow({ where: { key: "analytics:auto" } })).updatedAt, +firstSync);
    await writeConfig("INSTAGRAM", { clientId: "123456", secret: "mock-meta-secret", loginConfig: "234567", version: "v27.0" });
    const oldTls = [process.env.META_TLS_CERT, process.env.META_TLS_KEY];
    try {
      delete process.env.META_TLS_CERT;
      await assert.rejects(beginOAuth("INSTAGRAM", browser), /localhost HTTPS/);
      process.env.META_TLS_CERT = "fixture-cert";
      process.env.META_TLS_KEY = "fixture-key";
      const meta = new URL(await beginOAuth("INSTAGRAM", browser));
      assert.equal(meta.searchParams.get("config_id"), "234567");
      const binding = await consumeOAuth("INSTAGRAM", meta.searchParams.get("state"), browser);
      assert.equal(await finishOAuth("INSTAGRAM", binding, "mock-code"), 1);
      const instagram = await db().socialAccount.findFirstOrThrow({ where: { platform: "INSTAGRAM" } });
      assert.equal(instagram.remoteId, "123456");
      assert.equal(instagram.canPublish, true);
      assert.equal(await accountToken(instagram.id), "mock-page");
      await db().oAuthCredential.update({ where: { accountId: instagram.id }, data: { expiresAt: new Date(0) } });
      await assert.rejects(accountToken(instagram.id), /Meta authorization expired/);
      assert.equal((await db().socialAccount.findUniqueOrThrow({ where: { id: instagram.id } })).status, "AUTH_REQUIRED");
    } finally {
      for (const [index, name] of ["META_TLS_CERT", "META_TLS_KEY"].entries()) {
        if (oldTls[index] === undefined) delete process.env[name]; else process.env[name] = oldTls[index];
      }
    }
    await writeConfig("GEMINI", { secret: "gemini-key", model: "gemini-test" });
    assert.deepEqual((await validateIntegration("GEMINI", {})).models, ["gemini-test"]);
    assert.equal((await providerConfig("GEMINI")).status, "VERIFIED");
    await writeConfig("GEMINI", {});
    assert.equal((await providerConfig("GEMINI")).status, "VERIFIED");
    const original = join(root, "sample.mp4");
    execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i", "color=gray:s=180x320:d=4",
      "-f", "lavfi", "-i", "sine=frequency=500:duration=4", "-c:v", "libx264", "-c:a", "aac", "-threads", "1", "-y", original], { windowsHide: true });
    const uploadOriginal = async () => importClip(new Request("http://localhost/api/clips", { method: "POST", body: await readFile(original),
      headers: { "X-Clip-Filename": "sample.mp4" } }));
    const clip = await uploadOriginal();
    await writeConfig("ASSEMBLYAI", { secret: "assembly-key" });
    assert(!JSON.stringify(await integrationViews()).includes("assembly-key"));
    assert.equal((await validateIntegration("ASSEMBLYAI", {})).status, "VERIFIED");
    const audioSignal = new AbortController().signal;
    await assert.rejects(transcribeClip({ clipId: clip.id }, audioSignal), /confirm sending its audio/);
    assert.deepEqual(await transcribeClip({ clipId: clip.id, confirm: true }, audioSignal, fetch, 0),
      { text: "The mock transcript was returned.", truncated: false, cleanupConfirmed: true });
    assemblyUploadUrl = "https://uploads.example.test:443/media/2026/speech%20fixture.mp3?signature=a%2Fb&part=1";
    assert.deepEqual(await transcribeClip({ clipId: clip.id, confirm: true }, audioSignal, fetch, 0),
      { text: "The mock transcript was returned.", truncated: false, cleanupConfirmed: true });
    for (const invalid of [undefined, 123, "/upload/speech-fixture", "http://cdn.assemblyai.com/upload/fixture", "https://fixture-user@localhost/upload/fixture"]) {
      assemblyUploadUrl = invalid;
      await assert.rejects(transcribeClip({ clipId: clip.id, confirm: true }, audioSignal, fetch, 0), /unexpected upload reference/);
    }
    assert.equal(assemblySubmissions, 2);
    await writeConfig("GEMINI", { model: "gemini-3.8-flash" });
    const { id: templateId } = await changeTemplate({ action: "save", name: "Studio phrasing", kind: "AI", isDefault: true,
      values: { instructions: "Use the name {{clip_name}} and keep it concise." } });
    await assert.rejects(changeTemplate({ action: "save", name: "Invalid", kind: "TITLE", values: { content: { title: "{{unknown}}" } } }), /Unsupported placeholder/);
    const group = await db().accountGroup.create({ data: { name: "Studio channels", members: { create: [{ accountId: first.id }, { accountId: second.id }] } } });
    const { id: presetId } = await changeTemplate({ action: "save", name: "Private studio", kind: "PRESET", values: {
      groupId: group.id, templateId, interval: 30, content: { title: "Notes by {{channel_name}}", visibility: "private" },
    } });
    assert.equal((await listTemplates()).find(item => item.id === presetId).values.interval, 30);
    assert.equal(renderTemplate("Notes by {{channel_name}}", { channel_name: "Studio" }), "Notes by Studio");
    await assert.rejects(changeTemplate({ action: "delete", id: templateId }), /publishing presets/);
    const { id: copy } = await changeTemplate({ action: "duplicate", id: templateId });
    assert.equal((await listTemplates()).find(item => item.id === copy).isDefault, false);
    await changeTemplate({ action: "delete", id: copy });
    const aiSignal = new AbortController().signal;
    const aiInput = { clipId: clip.id, field: "title", description: "A locally generated gray video fixture.", templateId };
    let requests = 0;
    const mockGemini = async ({ model, key, parts }) => {
      requests++;
      assert.equal(model, "gemini-3.8-flash"); assert.equal(key, "gemini-key");
      assert.match(JSON.parse(parts[0].text).templateInstructions, /sample\.mp4/);
      return JSON.stringify({ title: "Gray studio test" });
    };
    await assert.rejects(generateSuggestion({ ...aiInput, description: "" }, aiSignal, mockGemini), /description or transcript/);
    await assert.rejects(generateSuggestion({ ...aiInput, video: true }, aiSignal, mockGemini), /Confirm sending/);
    assert.equal((await generateSuggestion(aiInput, aiSignal, mockGemini)).suggestion.title, "Gray studio test");
    assert.equal((await generateSuggestion(aiInput, aiSignal, mockGemini)).cached, true);
    assert.equal(requests, 1);
    assert.equal((await generateSuggestion({ ...aiInput, regenerate: true }, aiSignal)).suggestion.title, "SDK fixture");
    const alternate = await generateSuggestion({ ...aiInput, model: "gemini-3.1-flash-lite" }, aiSignal, async ({ model }) => {
      assert.equal(model, "gemini-3.1-flash-lite");
      return JSON.stringify({ title: "Flash Lite fixture" });
    });
    assert.equal(alternate.suggestion.title, "Flash Lite fixture");
    assert.equal((await providerConfig("GEMINI")).values.model, "gemini-3.8-flash");
    await assert.rejects(generateSuggestion({ ...aiInput, regenerate: true }, aiSignal, async () => "not json"), /invalid metadata/);
    await assert.rejects(generateSuggestion({ ...aiInput, regenerate: true }, aiSignal, async () => { throw { status: 429 }; }), /quota or rate limit/);
    const videoAi = await generateSuggestion({ ...aiInput, video: true, videoConsent: true }, aiSignal, async ({ parts }) => {
      assert.equal(parts[1].inlineData.mimeType, "video/mp4");
      assert.equal(Buffer.from(parts[1].inlineData.data, "base64").byteLength, clip.size);
      return JSON.stringify({ title: "Video fixture" });
    });
    assert.equal(videoAi.suggestion.title, "Video fixture");
    const metadata = { ...blankContent, title: "Studio test", category: "22", audience: "general", caption: "Test caption" };
    const draft = await saveDraft({ ...emptyDraft("Asia/Kolkata"), name: "Test draft", step: 5, complete: true,
      posts: [{ clipKey: clip.id, content: metadata, targets: [first, second].map(account => ({ accountId: account.id, override: {} })) }] });
    const submission = { key: randomUUID(), revision: draft.revision };
    assert.equal((await queueDraft(draft.id, submission)).count, 2);
    assert.equal((await queueDraft(draft.id, submission)).count, 2);
    assert.equal(await db().job.count(), 2);
    const claims = await Promise.all([claimJob("first"), claimJob("second")]);
    assert.equal(new Set(claims.map(work => work?.id)).size, 2);
    const [firstJob, otherJob] = claims;
    assert(firstJob && otherJob);
    await updateRuntime({ youtubeDaily: 1 });
    await reserveUpload(firstJob);
    await assert.rejects(reserveUpload(otherJob), /allowance is exhausted/);
    await db().job.update({ where: { id: firstJob.id }, data: { leaseUntil: new Date(0) } });
    await recoverLeases();
    const again = await claimJob("recovered");
    assert.equal(again.id, firstJob.id);
    assert.equal(again.attempts, 2);
    const signal = new AbortController().signal;
    await processJob(again, "recovered", async ({ save }) => {
      await save({ remoteId: "abcdefghijkl" }, clip.size);
      return { state: "PUBLISHED", remoteId: "abcdefghijkl" };
    }, signal);
    await processJob(otherJob, "second", async () => { throw new ProviderError("uncertain", "Mock lost the remote response."); }, signal);
    assert.equal((await db().job.findUnique({ where: { id: otherJob.id } })).state, "NEEDS_REVIEW");
    await assert.rejects(changeJob(otherJob.id, { action: "retry" }), /already exist/);
    await runCleanup();
    const stored = join(process.env.STORAGE_PATH, "videos", clip.id + ".mp4");
    assert(existsSync(stored));
    const future = new Date(Date.now() + 3600000);
    await db().job.update({ where: { id: otherJob.id }, data: { state: "SCHEDULED", scheduledAt: new Date(Date.now() - 3600000), dueAt: new Date(0) } });
    assert.equal(await claimJob("late"), null);
    assert.equal((await db().job.findUnique({ where: { id: otherJob.id } })).errorKind, "missed");
    await updateRuntime({ missed: "MOVE" });
    const offHours = new Date("2030-01-01T17:00:00Z");
    const { day, reset } = quotaWindow("America/Los_Angeles", offHours);
    await db().quotaUsage.create({ data: { key: `youtube:${day}`, used: 1, expiresAt: reset } });
    await db().job.update({ where: { id: otherJob.id }, data: { state: "SCHEDULED" } });
    assert.equal(await claimJob("move-late", offHours), null);
    assert.equal(+(await db().job.findUniqueOrThrow({ where: { id: otherJob.id } })).scheduledAt, +reset);
    await changeJob(otherJob.id, { action: "reschedule", utc: future.toISOString() });
    assert.equal(await claimJob("early"), null);
    await changeJob(otherJob.id, { action: "cancel" });
    assert.equal((await db().job.findUnique({ where: { id: otherJob.id } })).state, "CANCELLED");

    const base = await db().job.findUniqueOrThrow({ where: { id: otherJob.id }, include: jobDetail });
    const video = { ...base, remoteId: null, scheduledAt: future, nativeSchedule: true,
      target: { ...base.target, content: { ...metadata, visibility: "public" } } };
    let checkpoint = {};
    let lost = true;
    let nativeAcknowledged = false;
    let uploads = 0;
    const save = async value => { checkpoint = value; };
    const youtube = youtubePublisher(async (raw, init) => {
      assert.equal(new URL(raw).origin, "https://www.googleapis.com");
      if (init.method === "POST") {
        uploads++;
        const data = JSON.parse(init.body);
        assert.equal(data.status.privacyStatus, "private");
        assert.equal(data.status.publishAt, future.toISOString());
        return new Response(null, { headers: { location: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=token" } });
      }
      if (init.method === "PUT") {
        if (lost) { lost = false; throw Error("Response lost"); }
        assert.match(init.headers["Content-Range"], /^bytes \*\//);
        return Response.json({ id: "abcdefghijkl".slice(0, 11) });
      }
      return Response.json({ items: [{ snippet: { channelId: video.target.account.remoteId },
        status: { uploadStatus: "processed", privacyStatus: nativeAcknowledged ? "public" : "private" } }] });
    }, async () => "mock-yt", async () => {});
    await assert.rejects(youtube({ work: video, checkpoint, signal, save }), /Could not reach/);
    assert(checkpoint.session);
    assert.equal((await youtube({ work: video, checkpoint, signal, save })).state, "PROCESSING");
    assert.equal((await youtube({ work: video, checkpoint, signal, save })).state, "AWAITING_PROVIDER");
    nativeAcknowledged = true;
    assert.equal((await youtube({ work: video, checkpoint, signal, save })).state, "PUBLISHED");
    assert.equal(uploads, 1);

    const reel = { ...base, remoteId: null, target: { ...base.target, content: metadata,
      account: { ...base.target.account, platform: "INSTAGRAM", remoteId: "123456" } } };
    checkpoint = {};
    let containerCalls = 0, publishCalls = 0;
    const instagram = instagramPublisher(async (raw, init) => {
      const url = new URL(raw);
      if (url.hostname === "rupload.facebook.com") {
        assert.equal(init.headers.Authorization, "OAuth mock-meta");
        const bytes = await new Response(init.body).arrayBuffer();
        assert.equal(bytes.byteLength, clip.size);
        return Response.json({ success: true });
      }
      if (url.pathname.endsWith("/content_publishing_limit")) return Response.json({ data: [{ quota_usage: 0, config: { quota_total: 100 } }] });
      if (url.pathname.endsWith("/media")) { containerCalls++; return Response.json({ id: "234567" }); }
      if (url.pathname.endsWith("/media_publish")) { publishCalls++; return Response.json({ id: "345678" }); }
      if (url.pathname.endsWith("/234567")) return Response.json({ status_code: "FINISHED" });
      return Response.json({ id: "345678", permalink: "https://www.instagram.com/reel/test/" });
    }, async () => "mock-meta", async () => {});
    assert.equal((await instagram({ work: reel, checkpoint, signal, save })).state, "PROCESSING");
    assert.equal((await instagram({ work: reel, checkpoint, signal, save })).state, "PROCESSING");
    assert.equal((await instagram({ work: reel, checkpoint, signal, save })).state, "PUBLISHED");
    assert.equal(containerCalls, 1); assert.equal(publishCalls, 1);
    await assert.rejects(instagram({ work: reel, checkpoint: { phase: "publishing", container: "234567" }, signal, save }), /did not confirm/);
    assert.equal(publishCalls, 1);

    await db().job.update({ where: { id: otherJob.id }, data: { state: "QUEUED", dueAt: new Date(0) } });
    await writeConfig("YOUTUBE", { secret: "changed-secret" });
    assert.equal((await db().job.findUnique({ where: { id: otherJob.id } })).state, "PAUSED_AUTH");
    await assert.rejects(accountToken(first.id), /Reconnect/);
    const worker = await db().job.findUniqueOrThrow({ where: { id: otherJob.id }, include: jobDetail });
    await db().job.update({ where: { id: worker.id }, data: { state: "QUEUED", dueAt: new Date(0) } });
    const final = await claimJob("finish");
    await processJob(final, "finish", async () => ({ state: "PUBLISHED", remoteId: "12345678901" }), signal);
    const { cleanupSummary, cleanupVerifiedMedia } = await import("../src/lib/planning/retention.ts");
    await runCleanup();
    assert(existsSync(stored));
    assert.equal(await db().cleanupTask.count({ where: { clipId: clip.id } }), 0);
    const reused = await uploadOriginal();
    assert.equal(reused.id, clip.id);
    assert.equal(reused.reused, true);
    assert((await cleanupSummary()).candidates.some(item => item.id === clip.id));
    assert.equal(await cleanupVerifiedMedia(clip.id, new Date(), true), true);
    assert.equal((await cleanupSummary()).reclaimedBytes, clip.size);
    assert.equal(existsSync(stored), false);
    assert.equal(existsSync(original), true);
    assert.equal(await db().publicationHistory.count({ where: { status: "SUCCEEDED" } }), 2);

    const reimported = await uploadOriginal();
    assert.notEqual(reimported.id, clip.id);
    assert.equal(reimported.status, "READY");
    assert.equal(await db().publicationHistory.count({ where: { status: "SUCCEEDED" } }), 2);
    await updateRuntime({ youtubeDaily: 10 });
    selected = first.remoteId;
    const reconnect = new URL(await beginOAuth("YOUTUBE", browser));
    await finishOAuth("YOUTUBE", await consumeOAuth("YOUTUBE", reconnect.searchParams.get("state"), browser), "code");
    const removalDraft = await saveDraft({ ...emptyDraft("Asia/Kolkata"), name: "Remove after publishing", step: 5, complete: true,
      posts: [{ clipKey: reimported.id, content: metadata, targets: [{ accountId: first.id, override: {} }] }] });
    await queueDraft(removalDraft.id, { key: randomUUID(), revision: removalDraft.revision, removeAfterPublish: true });
    await runCleanup();
    assert.equal((await db().clip.findUniqueOrThrow({ where: { id: reimported.id } })).status, "READY");
    const removalJob = await claimJob("remove-after-publication");
    assert.equal(removalJob.target.post.clipId, reimported.id);
    await processJob(removalJob, "remove-after-publication", async () => ({ state: "PUBLISHED", remoteId: "abcdefghijk" }), signal);
    const protects = await saveDraft({ ...emptyDraft("Asia/Kolkata"), posts: [{ clipKey: reimported.id, content: metadata, targets: [] }] });
    await runCleanup();
    assert.equal((await db().clip.findUniqueOrThrow({ where: { id: reimported.id } })).status, "READY");
    await removeDraft(protects.id);
    await runCleanup(new Date(Date.now() + 5 * 60000 + 1000));
    assert.equal((await db().clip.findUniqueOrThrow({ where: { id: reimported.id } })).status, "MEDIA_REMOVED");
    assert.equal(await db().publicationHistory.count({ where: { status: "SUCCEEDED" } }), 3);
  } finally {
    globalThis.fetch = realFetch;
    await db().$disconnect();
    assert.match(relative(sandbox, root), /^publishing-[^\\/]+$/);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});
