import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { registerHooks } from "node:module";
import { createServer } from "node:net";
import { once } from "node:events";
import { join, resolve, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { chromium } from "playwright-core";
import { blankContent, emptyDraft, localInstant, schedule, wallTime } from "../src/lib/planning/model.ts";
import { combineReports, count, reportingRange, orderedDays } from "../src/lib/analytics/model.ts";
import { collectChannel, youtubeProvider, youtubeReadScopes } from "../src/lib/analytics/youtube.ts";

registerHooks({ resolve(specifier, context, next) {
  const url = specifier.startsWith("@/") ? pathToFileURL(resolve("src", specifier.slice(2))).href :
    specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? new URL(specifier, context.parentURL).href : null;
  if (url && existsSync(fileURLToPath(url + ".ts"))) return next(url + ".ts", context);
  return next(specifier, context);
} });

test("schedule validates UTC conversion, gaps, overlaps, dates, and bulk intervals", () => {
  assert.equal(localInstant("2031-05-14T11:30", "Asia/Kolkata").toISOString(), "2031-05-14T06:00:00.000Z");
  for (const invalid of ["2031-02-30T10:00", "2031-03-09T02:30", "2031-11-02T01:30"]) {
    assert.equal(localInstant(invalid, "America/New_York"), null);
  }
  const data = { ...emptyDraft("Asia/Kolkata"), scheduleMode: "BULK", scheduleLocal: "2031-05-14T11:30",
    intervalMinutes: 45, posts: [{ cancelled: false }, { cancelled: false }] };
  assert.deepEqual(schedule(data, 0).times, ["2031-05-14T06:00:00.000Z", "2031-05-14T06:45:00.000Z"]);
  assert.match(schedule({ ...data, intervalMinutes: 0 }, 0).warning, /interval/);
  assert.match(schedule(data, Date.parse("2032-01-01")).warning, /future/);
});

test("YouTube ranges, zero values and partial aggregation", () => {
  const now = new Date("2026-11-18T02:00:00Z");
  const range = reportingRange("7", "", "", now);
  assert.deepEqual(range, { start: "2026-11-10", end: "2026-11-16" });
  assert.equal(orderedDays(range).length, 7);
  assert.equal(reportingRange("custom", "2026-11-18", "2026-11-10", now), null);
  assert.equal(reportingRange("custom", "2026-02-30", "2026-03-01", now), null);
  const entry = (views, subscribers) => ({ snapshot: { channel: { views, subscribers }, totals: { views } } });
  const pair = [entry(0, null), entry(19, 7)];
  assert.equal(combineReports(pair, false).periodViews, null);
  assert.equal(combineReports(pair, true).periodViews, 19);
  assert.equal(combineReports(pair, true).subscribers, null);
  assert.equal(combineReports([...pair, { snapshot: null }], true).periodViews, null);
  assert.equal(combineReports([pair[0]], false).views, 0);
  assert.equal(count(null), "Unavailable");
});

test("YouTube provider uses official batched endpoints and preserves absent reports", async () => {
  const calls = [];
  const fetchStub = async (url, option) => {
    const info = new URL(url);
    calls.push(info);
    assert.equal(option.headers.Authorization, "Bearer test-token");
    assert.match(info.hostname, /googleapis\.com$/);
    const part = info.pathname.split("/").at(-1);
    if (part === "channels") return Response.json({ items: [{ id: "channel", statistics: { viewCount: "0", hiddenSubscriberCount: true },
      contentDetails: { relatedPlaylists: { uploads: "playlist" } } }] });
    if (part === "playlistItems") return Response.json({ items: [{ contentDetails: { videoId: "listed" } }] });
    if (part === "videos") return Response.json({ items: info.searchParams.get("id").split(",").map(id => ({ id,
      snippet: { channelId: "channel" }, statistics: { viewCount: "7" } })) });
    if (info.searchParams.get("dimensions") === "video") return Response.json({ columnHeaders: [{ name: "video" }, { name: "views" }], rows: [["top", 0]] });
    if (info.searchParams.get("dimensions") === "day") return Response.json({ columnHeaders: [{ name: "day" }, { name: "views" }], rows: [["2026-11-16", 0]] });
    return Response.json({});
  };
  const provider = youtubeProvider(async () => "test-token", fetchStub);
  const data = await collectChannel(provider, "channel", { start: "2026-11-10", end: "2026-11-16" });
  assert.equal(data.channel.subscribers, null);
  assert.equal(data.days[0].views, 0);
  assert.equal(data.days[0].minutes, null);
  assert.equal(data.totals, null);
  assert.deepEqual(data.videos.map(video => [video.id, video.periodViews]), [["top", 0], ["listed", null]]);
  const engagementProvider = youtubeProvider(async () => "test-token", async url => {
    assert.match(new URL(url).searchParams.get("metrics"), /,likes,comments$/);
    return Response.json({ columnHeaders: [{ name: "likes" }, { name: "comments" }], rows: [[0, 3]] });
  });
  assert.deepEqual(await engagementProvider.totals("channel", { start: "2026-11-10", end: "2026-11-16" }),
    { views: null, minutes: null, gained: null, lost: null, likes: 0, comments: 3 });
  await provider.videos(Array.from({ length: 51 }, (_, index) => String(index)));
  assert.deepEqual(calls.filter(url => url.pathname.endsWith("/videos")).map(url => url.searchParams.get("id").split(",").length), [2, 50, 1]);
  assert.equal(youtubeReadScopes.length, 2);
});

test("wizard, calendar, retention and history use isolated local data", { timeout: 120000 }, async () => {
  const sandbox = resolve("data", "test-runs");
  const screenshots = resolve("data", ".phase3-checks");
  await mkdir(sandbox, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  const root = await mkdtemp(join(sandbox, "planning-"));
  const storage = join(root, "media");
  const database = join(root, "planning.db");
  const env = { ...process.env, STORAGE_PATH: storage, DATABASE_URL: `file:${database}`, APP_TIMEZONE: "Asia/Kolkata" };
  const net = createServer().listen(0, "127.0.0.1");
  await once(net, "listening");
  const port = net.address().port;
  await new Promise(resolve => net.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let server, browser;
  const logs = [];
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exited = once(server, "exit"); server.kill(); await exited;
  }
  async function start() {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "--port", String(port)],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", chunk => logs.push(String(chunk)));
    for (let attempt = 0; attempt < 100; attempt++) {
      if (server.exitCode !== null) break;
      if ((await fetch(origin).catch(() => null))?.ok) return;
      await sleep(100);
    }
    assert.fail("Test server stopped: " + logs.join(""));
  }
  const horizon = wallTime(new Date(Date.now() + 7 * 86400000), "Asia/Kolkata");
  try {
    execFileSync(process.execPath, ["scripts/migrate.mjs"], { env, windowsHide: true, stdio: "inherit" });
    await start();
    const clips = [];
    for (const [name, color] of [["Desk notes.mp4", "gray"], ["Studio cut.mp4", "silver"]]) {
      const path = join(root, name);
      execFileSync(process.env.FFMPEG_PATH || "ffmpeg", ["-nostdin", "-v", "error", "-f", "lavfi", "-i",
        `color=${color}:s=180x320:d=1`, "-f", "lavfi", "-i", "sine=frequency=480:duration=1",
        "-c:v", "libx264", "-c:a", "aac", "-threads", "1", "-y", path], { windowsHide: true });
      const response = await fetch(origin + "/api/clips", { method: "POST", body: await readFile(path),
        headers: { Origin: origin, "Content-Type": "video/mp4", "X-Clip-Filename": encodeURIComponent(name) } });
      assert.equal(response.status, 201);
      clips.push(await response.json());
    }
    const executablePath = process.env.CLIPFLOW_BROWSER_PATH;
    const channel = !executablePath && process.platform === "win32" && !existsSync(chromium.executablePath()) ? "msedge" : undefined;
    browser = await chromium.launch({ executablePath, channel });
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
    desktop.setDefaultTimeout(12000);
    const errors = [];
    desktop.on("pageerror", error => errors.push(`${new URL(desktop.url()).pathname}: ${error.stack ?? error.message}`));
    const next = () => desktop.getByRole("button", { name: "Continue", exact: true }).click();
    await desktop.goto(origin + "/compose?new=1");
    await desktop.getByLabel("Draft name").fill("November studio draft");
    for (const clip of clips) await desktop.getByRole("checkbox", { name: new RegExp(clip.originalFilename) }).check();
    await next();
    await desktop.getByText("No accounts are connected.", { exact: false }).waitFor();
    await next();
    await desktop.getByLabel("YouTube title", { exact: true }).fill("Desk notes title");
    await desktop.getByLabel("Instagram caption", { exact: true }).fill("A few notes from the desk.");
    await desktop.getByLabel("Edit metadata for clip").selectOption(clips[1].id);
    await desktop.getByLabel("YouTube title", { exact: true }).fill("Studio clip title");
    await desktop.getByRole("button", { name: "Back", exact: true }).click();
    await next();
    assert.equal(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), "Studio clip title");
    await desktop.getByRole("button", { name: "Set a schedule" }).click();
    await desktop.getByLabel("Timing").selectOption("BULK");
    await desktop.getByLabel("Planned start").fill("2025-01-01T12:00");
    await next();
    await desktop.getByRole("alert").getByText("Choose a time in the future.").waitFor();
    await desktop.getByLabel("Planned start").fill(horizon);
    await desktop.getByLabel("Interval in minutes").fill("45");
    await next();
    await desktop.getByRole("button", { name: "Save reviewed draft" }).click();
    await desktop.waitForURL(/draft=[a-f0-9-]+/);
    const resumeUrl = desktop.url();
    const draftId = new URL(resumeUrl).searchParams.get("draft");
    await desktop.getByRole("heading", { name: "Review", exact: true }).waitFor();
    assert(await desktop.getByRole("button", { name: "Schedule publications" }).isDisabled());
    await desktop.screenshot({ path: join(screenshots, "review-light.png"), fullPage: true });
    await stop(); await start();
    await desktop.goto(resumeUrl);
    await desktop.getByRole("heading", { name: "Review", exact: true }).waitFor();
    await desktop.getByText("YouTube defaults").first().click();
    await desktop.getByText("Desk notes title").waitFor();
    await desktop.getByRole("button", { name: "Back", exact: true }).click();
    await desktop.getByRole("button", { name: "Back", exact: true }).click();
    await desktop.getByLabel("YouTube title", { exact: true }).fill("Edited desk title");
    await desktop.getByRole("button", { name: "Save draft", exact: true }).click();
    await desktop.getByText("Draft saved on this computer.").waitFor();
    await desktop.reload();
    assert.equal(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), "Edited desk title");
    await desktop.goto(origin + "/calendar");
    await desktop.getByRole("button", { name: "Reschedule" }).first().click();
    const newTime = wallTime(new Date(Date.now() + 10 * 86400000), "Asia/Kolkata");
    await desktop.getByLabel("New date and time").fill(newTime);
    await desktop.getByRole("button", { name: "Save new time" }).click();
    await desktop.getByRole("dialog").waitFor({ state: "hidden" });
    await desktop.locator(`time[datetime="${localInstant(newTime, "Asia/Kolkata").toISOString()}"]`).waitFor();
    await desktop.getByRole("button", { name: "Cancel plan" }).first().click();
    await desktop.getByRole("button", { name: "Confirm cancellation" }).click();
    await desktop.getByRole("dialog").waitFor({ state: "hidden" });
    await desktop.getByRole("button", { name: "Cancel plan" }).nth(1).waitFor({ state: "hidden" });

    const stored = join(storage, "videos", clips[0].id + ".mp4");
    await rename(stored, stored + ".test");
    await desktop.goto(resumeUrl);
    await desktop.getByRole("heading", { name: "Prepare content", exact: true }).waitFor();
    await desktop.getByRole("button", { name: "Back", exact: true }).click();
    await desktop.getByRole("button", { name: "Back", exact: true }).click();
    await desktop.getByText("Desk notes.mp4 is unavailable.", { exact: true }).waitFor();
    await rename(stored + ".test", stored);
    await desktop.goto(origin + "/compose");
    await desktop.getByRole("button", { name: "Duplicate" }).click();
    await desktop.waitForURL(url => url.searchParams.get("draft") && url.searchParams.get("draft") !== draftId);
    await desktop.goto(origin + "/compose");
    const copy = desktop.locator(".plan-row").filter({ hasText: "November studio draft copy" });
    await copy.getByRole("button", { name: "Delete", exact: true }).click();
    await desktop.getByRole("button", { name: "Delete draft" }).click();
    await copy.waitFor({ state: "hidden" });
    await desktop.goto(origin + "/settings");
    await desktop.getByText("Clips stay in the library", { exact: false }).waitFor();

    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark" });
    mobile.setDefaultTimeout(12000);
    mobile.on("pageerror", error => errors.push(`${new URL(mobile.url()).pathname}: ${error.stack ?? error.message}`));
    await mobile.goto(origin + "/analytics");
    await mobile.getByText("No YouTube channels are connected.").waitFor();
    assert.equal(await mobile.getByText("No reported data for this selection.", { exact: true }).count(), 4);
    await mobile.getByLabel("Date range").selectOption("custom");
    await mobile.getByLabel("From", { exact: true }).fill("2026-04-01");
    await mobile.getByLabel("To", { exact: true }).fill("2026-04-14");
    await mobile.getByRole("button", { name: "Apply range" }).click();
    await mobile.getByText("2026-04-01 to 2026-04-14", { exact: false }).waitFor();
    assert.equal(await mobile.locator("html").getAttribute("data-theme"), "dark");
    await mobile.screenshot({ path: join(screenshots, "analytics-dark-mobile.png"), fullPage: true });
    for (const route of ["/calendar", "/history", "/compose?new=1", "/settings", "/accounts", "/queue", "/integrations"]) {
      await mobile.goto(origin + route);
      await mobile.getByRole("heading", { level: 1 }).waitFor();
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390, route);
    }
    await mobile.goto(origin + "/integrations");
    await mobile.getByRole("heading", { name: "Gemini", exact: true }).waitFor();
    await mobile.screenshot({ path: join(screenshots, "integrations-dark-mobile.png"), fullPage: true });
    await desktop.goto(origin + "/integrations");
    const google = desktop.locator("section").filter({ has: desktop.getByRole("heading", { name: "YouTube", exact: true }) });
    await google.getByRole("button", { name: "Configure", exact: true }).click();
    await desktop.getByRole("textbox", { name: "Google OAuth client ID" }).fill("local.apps.googleusercontent.com");
    await desktop.getByLabel("Client secret", { exact: true }).fill("fixture-secret");
    await desktop.getByRole("button", { name: "Test configuration", exact: true }).click();
    await desktop.getByRole("dialog").getByText("Complete OAuth", { exact: false }).waitFor();
    await desktop.getByRole("button", { name: "Save configuration", exact: true }).click();
    await google.getByRole("button", { name: "Edit configuration", exact: true }).waitFor();
    assert(!(await desktop.content()).includes("fixture-secret"));
    await desktop.screenshot({ path: join(screenshots, "integrations-light.png"), fullPage: true });
    await desktop.goto(origin + "/analytics");
    await desktop.getByRole("heading", { name: "Analytics", exact: true }).waitFor();
    await desktop.screenshot({ path: join(screenshots, "analytics-light.png"), fullPage: true });
    assert.deepEqual(errors, []);

    const sqlite = new DatabaseSync(database);
    try {
      const id = clips[0].id;
      const target = randomUUID(), account = randomUUID(), post = randomUUID();
      const timestamp = new Date().toISOString();
      sqlite.prepare('INSERT INTO "SocialAccount" ("id", "platform", "remoteId", "name", "status", "updatedAt", "canAnalyze") VALUES (?, ?, ?, ?, ?, ?, ?)').run(account, "YOUTUBE", "test-channel", "Test channel", "CONNECTED", timestamp, 1);
      sqlite.prepare('INSERT INTO "Post" ("id","clipId","clipKey","filename","position","content","status","updatedAt") VALUES (?,?,?,?,?,?,?,?)')
        .run(post, id, id, "Desk notes.mp4", 0, JSON.stringify(blankContent), "SUCCEEDED", timestamp);
      sqlite.prepare('INSERT INTO "PostTarget" ("id","postId","accountId","content","status","verifiedAt","updatedAt") VALUES (?,?,?,?,?,?,?)')
        .run(target, post, account, "{}", "SUCCEEDED", timestamp, timestamp);
      sqlite.prepare('INSERT INTO "PublicationHistory" ("id","targetId","filename","title","platform","accountName","remoteAccount","status","publishedAt","remoteMediaId") VALUES (?,?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), target, "Desk notes.mp4", "Recorded result", "YOUTUBE", "Test channel", "test-channel", "SUCCEEDED", timestamp, "test-media-id");
      const { cleanupVerifiedMedia } = await import("../src/lib/planning/retention.ts");
      const { db } = await import("../src/lib/clips/db.ts");
      Object.assign(process.env, { DATABASE_URL: env.DATABASE_URL, STORAGE_PATH: storage });
      try {
        assert.equal(await cleanupVerifiedMedia(id, new Date(), true), false, "Active draft protects media");
        const response = await fetch(`${origin}/api/drafts/${draftId}`, { method: "DELETE", headers: { Origin: origin } });
        assert.equal(response.status, 204);
        assert.equal(await cleanupVerifiedMedia(id), false, "Media is kept without a removal choice");
        sqlite.prepare('UPDATE "PostTarget" SET "status" = ? WHERE "id" = ?').run("FAILED", target);
        assert.equal(await cleanupVerifiedMedia(id, new Date(), true), false, "Failed target protects media");
        sqlite.prepare('UPDATE "PostTarget" SET "status" = ? WHERE "id" = ?').run("SUCCEEDED", target);
        const thumb = join(storage, "thumbnails", id + ".jpg");
        await desktop.goto(origin + "/settings");
        await desktop.getByRole("button", { name: "Review eligible cleanup" }).click();
        const cleanupDialog = desktop.getByRole("dialog");
        await cleanupDialog.getByText("1 local copy", { exact: false }).waitFor();
        await cleanupDialog.getByRole("button", { name: "Remove eligible copies" }).click();
        await desktop.getByText("1 removed · 0 skipped · 0 could not be removed.").waitFor();
        assert.equal(await cleanupVerifiedMedia(id), false);
        assert.equal(existsSync(stored), false);
        assert.equal(existsSync(thumb), false);
        assert.equal(existsSync(join(root, "Desk notes.mp4")), true);
        assert.equal(sqlite.prepare('SELECT "status" FROM "Clip" WHERE "id" = ?').get(id).status, "MEDIA_REMOVED");
        await desktop.goto(origin + "/history?filename=Desk&account=Test&platform=YOUTUBE&status=SUCCEEDED");
        await desktop.getByText("Recorded result").waitFor();
        await desktop.goto(origin + "/history?filename=missing");
        await desktop.getByText("No matching publications").waitFor();
        const { refreshAnalytics } = await import("../src/lib/analytics/cache.ts");
        const range = { start: "2026-04-01", end: "2026-04-03" };
        const mockProvider = {
          channel: async () => ({ id: "test-channel", name: "Test channel", views: 77, videos: 0, subscribers: null, hiddenSubscribers: true }),
          async *uploads() {},
          videos: async () => [],
          daily: async () => [{ day: range.start, views: 0, minutes: 0, gained: 0, lost: 0 }],
          totals: async () => ({ views: 0, minutes: 0, gained: 0, lost: 0 }),
          topVideos: async () => new Map(),
        };
        assert.deepEqual(await refreshAnalytics(range, async () => mockProvider), [{ id: account, state: "synced" }]);
        await desktop.goto(origin + "/analytics?range=custom&start=2026-04-01&end=2026-04-03");
        const dailyChart = desktop.getByRole("img", { name: "Daily views. 1 of 3 days reported." });
        await dailyChart.waitFor();
        assert.equal(await dailyChart.locator("title").textContent(), "2026-04-01: 0");
        await desktop.getByText("Hidden", { exact: true }).first().waitFor();
        await desktop.goto(origin + "/analytics?range=7");
        await desktop.getByText("77", { exact: true }).first().waitFor();
        await desktop.getByRole("button", { name: "Clear cached data" }).click();
        const cleared = desktop.waitForResponse(response => new URL(response.url()).pathname === "/api/analytics/cache" && response.request().method() === "DELETE");
        await desktop.getByRole("button", { name: "Clear cache", exact: true }).click();
        assert.equal((await cleared).status(), 204);
        await desktop.getByRole("button", { name: "Clear cached data", includeHidden: true }).waitFor({ state: "detached" });
        assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM "AnalyticsCache"').get().total, 0);

        const { saveDraft } = await import("../src/lib/planning/drafts.ts");
        const { seal } = await import("../src/lib/integrations/secrets.ts");
        const { providerConfig, writeConfig } = await import("../src/lib/integrations/config.ts");
        const config = await providerConfig("YOUTUBE");
        await db().socialAccount.update({ where: { id: account }, data: { canPublish: true, credential: { create: {
          sealed: seal({ access: "fixture-access", scopes: [] }, account), revision: config.revision,
        } } } });
        await writeConfig("GEMINI", { secret: "fixture-gemini", model: "gemini-3.8-flash" });
        const assemblyCheck = await fetch(origin + "/api/integrations", { method: "POST",
          headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ provider: "ASSEMBLYAI", test: true }) });
        assert.equal(assemblyCheck.status, 400);
        assert.match((await assemblyCheck.json()).error, /required credential/);
        await writeConfig("ASSEMBLYAI", { secret: "fixture-assembly" });
        await desktop.goto(origin + "/accounts");
        await desktop.getByRole("button", { name: "New group" }).click();
        const groupDialog = desktop.getByRole("dialog");
        await groupDialog.getByRole("textbox").fill("Studio group");
        await groupDialog.getByRole("checkbox", { name: "Test channel", exact: false }).check();
        await groupDialog.getByRole("button", { name: "Save group" }).click();
        await desktop.getByText("Studio group · 1 accounts").waitFor();
        await desktop.goto(origin + "/templates");
        const newTemplate = desktop.getByRole("button", { name: "New template" });
        await newTemplate.click();
        await desktop.getByRole("dialog").waitFor();
        await desktop.keyboard.press("Escape");
        await desktop.waitForFunction(() => document.activeElement?.textContent?.trim() === "New template");
        await newTemplate.click();
        const templateDialog = desktop.getByRole("dialog");
        await templateDialog.getByLabel("Template name").fill("Studio template");
        await templateDialog.getByLabel("Template type", { exact: true }).selectOption("TITLE");
        await templateDialog.getByLabel("YouTube title").fill("Notes on {{clip_name}}");
        await templateDialog.getByRole("button", { name: "Save template" }).click();
        await desktop.getByText("Studio template", { exact: true }).waitFor();
        const template = await db().contentTemplate.findFirstOrThrow({ where: { name: "Studio template" } });
        const prepared = await saveDraft({ ...emptyDraft("Asia/Kolkata"), name: "Content browser fixture", step: 2,
          posts: [{ clipKey: clips[1].id, content: blankContent, targets: [] }] });
        await desktop.goto(origin + `/compose?draft=${prepared.id}`);
        await desktop.getByRole("button", { name: "Select Studio group" }).click();
        await next();
        await desktop.getByLabel("Template or preset").selectOption(template.id);
        await desktop.getByRole("button", { name: "Apply template" }).click();
        assert.match(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), /Notes on Studio cut/);
        await desktop.getByRole("button", { name: "Restore previous content" }).click();
        assert.equal(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), "");
        await desktop.getByLabel("Transcript for selected clip").fill("An editable transcript entered by hand.");
        await desktop.route("**/api/transcription", async route => {
          assert.deepEqual(route.request().postDataJSON(), { clipId: clips[1].id, confirm: true });
          await route.fulfill({ json: { text: "A transcript from the mocked audio provider.", truncated: false, cleanupConfirmed: true } });
        });
        await desktop.getByRole("button", { name: "Transcribe clip audio" }).click();
        await desktop.getByRole("button", { name: "Send audio and transcribe" }).click();
        await desktop.getByText("Transcript ready.", { exact: false }).waitFor();
        assert.equal(await desktop.getByLabel("Transcript for selected clip").inputValue(), "A transcript from the mocked audio provider.");
        await desktop.route("**/api/ai", async route => {
          const payload = route.request().postDataJSON();
          assert.equal(payload.clipId, clips[1].id);
          assert.equal(payload.video, false);
          assert.equal(payload.transcript, "A transcript from the mocked audio provider.");
          assert.equal(payload.model, "gemini-3.1-flash-lite");
          await route.fulfill({ json: { suggestion: { title: "Studio AI suggestion" }, cached: false, used: 1 } });
        });
        await desktop.getByLabel("Clip description or shared batch context").fill("A generated local clip used by the browser test.");
        await desktop.getByRole("combobox", { name: "Gemini model" }).selectOption("gemini-3.1-flash-lite");
        await desktop.getByRole("button", { name: "Generate title", exact: true }).click();
        const suggestion = desktop.locator(".semantic-status").filter({ hasText: "Suggestion ready" });
        await suggestion.waitFor();
        assert.match(await suggestion.getAttribute("class"), /tone-ai/);
        await desktop.getByRole("button", { name: "Apply suggestion" }).click();
        assert.equal(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), "Studio AI suggestion");
        await desktop.getByRole("button", { name: "Save draft", exact: true }).click();
        await desktop.getByText("Draft saved on this computer.").waitFor();
        await desktop.reload();
        assert.equal(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), "Studio AI suggestion");
        await desktop.evaluate(() => window.scrollTo(0, 0));
        await desktop.screenshot({ path: join(screenshots, "composer-ai-light.png"), fullPage: true });
        await desktop.getByRole("button", { name: "Review and publish" }).click();
        await desktop.getByRole("heading", { name: "Review", exact: true }).waitFor();
        assert.equal(await desktop.getByLabel("YouTube title", { exact: true }).inputValue(), "Studio AI suggestion");
        await mobile.goto(origin + "/templates");
        await mobile.getByText("Studio template", { exact: true }).waitFor();
        assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390);
        await mobile.screenshot({ path: join(screenshots, "templates-dark-mobile.png"), fullPage: true });
        const scheduled = await saveDraft({ ...emptyDraft("Asia/Kolkata"), name: "Schedule browser fixture", step: 5, complete: true,
          scheduleMode: "AT", scheduleLocal: horizon, posts: [{ clipKey: clips[1].id, targets: [{ accountId: account, override: {} }],
            content: { ...blankContent, category: "" } }] });
        await mobile.goto(origin + `/compose?draft=${scheduled.id}`);
        await mobile.getByRole("combobox", { name: /YouTube audience/ }).selectOption("general");
        await mobile.getByRole("button", { name: "Schedule publications" }).click();
        const mobileDialog = mobile.getByRole("dialog");
        await mobileDialog.getByRole("radio", { name: "Keep in Clip Library" }).waitFor();
        assert((await mobileDialog.boundingBox()).width <= 390);
        await mobile.keyboard.press("Escape");
        await desktop.goto(origin + `/compose?draft=${scheduled.id}`);
        await desktop.getByText("Choose whether this video is made for kids.", { exact: false }).waitFor();
        assert(await desktop.getByRole("button", { name: "Schedule publications" }).isDisabled());
        const reviewTitle = desktop.getByLabel("YouTube title", { exact: true });
        await reviewTitle.fill("A manually written title");
        assert.equal(await reviewTitle.inputValue(), "A manually written title");
        await reviewTitle.fill("");
        await desktop.getByRole("combobox", { name: /YouTube audience/ }).selectOption("general");
        await desktop.getByRole("button", { name: "Schedule publications" }).click();
        const publishDialog = desktop.getByRole("dialog");
        assert(await publishDialog.getByRole("radio", { name: "Keep in Clip Library" }).isChecked());
        await publishDialog.getByRole("radio", { name: "Remove from Clip Library" }).check();
        assert.equal(await db().job.count(), 0);
        await desktop.getByRole("button", { name: "Confirm and queue" }).click();
        await desktop.waitForURL(url => url.pathname === "/queue" && url.searchParams.get("added") === "1");
        await desktop.getByRole("heading", { name: "Active jobs and issues" }).waitFor();
        await desktop.locator("p.title-4").filter({ hasText: clips[1].originalFilename }).waitFor();
        assert.equal(await db().job.count(), 1);
        assert.equal((await db().cleanupTask.findUniqueOrThrow({ where: { clipId: clips[1].id } })).state, "WAITING_FOR_PUBLICATION");
        const submittedContent = (await db().postTarget.findFirstOrThrow({ where: { job: { isNot: null } } })).content;
        assert.equal(submittedContent.category, "22");
        assert.equal(submittedContent.title, "Studio cut");
        await desktop.getByRole("button", { name: "Pause queue" }).click();
        await desktop.getByRole("button", { name: "Resume queue" }).click();
        await desktop.getByRole("button", { name: "Pause queue" }).waitFor();
        await desktop.goto(origin + "/calendar");
        await desktop.getByRole("link", { name: "View publishing queue" }).click();
        await desktop.getByRole("button", { name: "Cancel job" }).click();
        await desktop.getByRole("button", { name: "Confirm cancellation" }).click();
        await desktop.getByRole("link", { name: "View completed jobs" }).click();
        await desktop.getByText("Cancelled", { exact: true }).waitFor();
        assert.deepEqual(errors, []);
      } finally {
        await db().$disconnect();
        for (const variable of ["STORAGE_PATH", "DATABASE_URL"]) {
          if (envBefore[variable] === undefined) delete process.env[variable]; else process.env[variable] = envBefore[variable];
        }
      }
    } finally { sqlite.close(); }
  } catch (error) {
    console.error(logs.join(""));
    throw error;
  } finally {
    await browser?.close();
    await stop();
    assert.match(relative(sandbox, root), /^planning-[^\\/]+$/);
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
});

const envBefore = { ...process.env };
