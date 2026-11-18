import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import { createServer } from "node:net";
import { join, resolve, relative } from "node:path";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { chromium } from "playwright-core";

const sandbox = resolve("data", "test-runs");
const screenshots = resolve("data", ".phase2-checks");
const preflightEnv = { ...process.env };

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  assert.fail(description);
}

function generate(path, color, duration, resolution) {
  execFileSync(preflightEnv.FFMPEG_PATH || "ffmpeg", ["-nostdin", "-v", "error",
    "-f", "lavfi", "-i", `color=${color}:s=${resolution}:d=${duration}`, "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
    "-shortest", "-threads", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-y", path],
    { windowsHide: true });
}

async function portNumber() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
}

test("persistent clip library, browser workflow and local endpoint protections", { timeout: 120000 }, async () => {
  await mkdir(sandbox, { recursive: true });
  await mkdir(screenshots, { recursive: true });
  const root = await mkdtemp(join(sandbox, "clipflow-"));
  const storage = join(root, "media");
  const database = join(root, "database", "test.db");
  const env = { ...preflightEnv, STORAGE_PATH: storage, DATABASE_URL: `file:${database}`, MAX_UPLOAD_MIB: "1" };
  const port = await portNumber();
  const origin = `http://127.0.0.1:${port}`;
  let server;
  let browser;
  let logs = "";
  async function stop() {
    if (!server || server.exitCode !== null || server.signalCode !== null) return;
    const exit = once(server, "exit");
    server.kill();
    await exit;
  }
  async function start(overrides = {}) {
    server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--port", String(port), "--hostname", "127.0.0.1"],
      { env: { ...env, ...overrides }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    for (const stream of [server.stdout, server.stderr]) stream.on("data", data => { logs += data; });
    await waitFor(async () => {
      if (server.exitCode !== null) assert.fail(logs);
      return (await fetch(origin).catch(() => null))?.ok;
    }, "Test server did not start");
  }
  async function upload(bytes, name, headers = {}) {
    return fetch(`${origin}/api/clips`, { method: "POST", body: bytes,
      headers: { Origin: origin, "Content-Type": "video/mp4", "X-Clip-Filename": encodeURIComponent(name), ...headers } });
  }
  async function create(bytes, name) {
    const result = await upload(bytes, name);
    assert.equal(result.status, 201, result.status === 201 ? "" : await result.text());
    return result.json();
  }
  try {
    const fixture = join(root, "desk-demo.mp4");
    const portrait = join(root, "portrait-demo.mp4");
    const fallback = join(root, "pending-demo.mp4");
    const extra = join(root, "window-demo.mp4");
    generate(fixture, "red", 4, "320x180");
    generate(portrait, "green", 2, "180x320");
    generate(fallback, "blue", 1, "320x180");
    generate(extra, "white", 3, "320x180");
    execFileSync(process.execPath, ["scripts/migrate.mjs"], { env, windowsHide: true, stdio: "inherit" });
    await start();

    const bytes = await readFile(fixture);
    const clip = await create(bytes, "desk-demo.mp4");
    assert.equal(clip.status, "READY");
    assert.equal(clip.duration, 4);
    assert.deepEqual([clip.width, clip.height, clip.codec, clip.audioCodec, clip.audioChannels, clip.hasThumbnail], [320, 180, "h264", "aac", 1, true]);
    assert.equal((await upload(bytes, "duplicate.mp4")).status, 409);
    assert.equal((await upload(Buffer.from("not a media file"), "fake.mp4")).status, 422);
    assert.equal((await upload(Buffer.alloc(1048577), "large.mp4")).status, 413);
    const chunked = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1048577)); controller.close(); } });
    assert.equal((await fetch(`${origin}/api/clips`, { method: "POST", body: chunked, duplex: "half",
      headers: { Origin: origin, "Content-Type": "video/mp4", "X-Clip-Filename": "chunked.mp4" } })).status, 413);
    assert.equal((await upload(bytes, "desk-demo.mp4", { Origin: "https://unrelated.example" })).status, 403);
    assert.equal((await fetch(`${origin}/api/clips`, { method: "DELETE", body: JSON.stringify({ ids: [clip.id] }),
      headers: { "Content-Type": "application/json" } })).status, 403);
    assert.equal((await fetch(`${origin}/api/clips/not-a-uuid/media`)).status, 404);
    assert.equal((await fetch(`${origin}/api/clips/${clip.id}/media?kind=..%2F..%2Ftest.db`)).status, 404);
    const foreignHost = await new Promise((resolve, reject) => {
      http.get(`${origin}/api/clips/${clip.id}/media`, { headers: { Host: "unrelated.example" } }, response => {
        response.resume();
        resolve(response.statusCode);
      }).on("error", reject);
    });
    assert.equal(foreignHost, 403);

    const media = `${origin}/api/clips/${clip.id}/media`;
    const thumbnail = await fetch(media + "?kind=thumbnail");
    assert.equal(thumbnail.headers.get("content-type"), "image/jpeg");
    assert.deepEqual(new Uint8Array(await thumbnail.arrayBuffer()).slice(0, 2), Uint8Array.of(255, 216));
    const partial = await fetch(media, { headers: { Range: "bytes=10-39" } });
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), `bytes 10-39/${bytes.length}`);
    assert.deepEqual(Buffer.from(await partial.arrayBuffer()), bytes.subarray(10, 40));
    const suffix = await fetch(media, { headers: { Range: "bytes=-8" } });
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()), bytes.subarray(-8));
    assert.equal((await fetch(media, { headers: { Range: "bytes=9999999-" } })).status, 416);
    const head = await fetch(media, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("accept-ranges"), "bytes");
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const download = await fetch(media + "?kind=download");
    assert.match(download.headers.get("content-disposition"), /attachment.*desk-demo\.mp4/);
    assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    const stored = join(storage, "videos", `${clip.id}.mp4`);
    await rename(stored, stored + ".backup");
    await link(fixture, stored);
    assert.equal((await fetch(media)).status, 404);
    await unlink(stored);
    await rename(stored + ".backup", stored);

    const interrupted = http.request(`${origin}/api/clips`, { method: "POST", headers: { Origin: origin,
      "Content-Type": "video/mp4", "X-Clip-Filename": "interrupted.mp4", "Content-Length": "200000" } });
    interrupted.on("error", () => {});
    interrupted.write(Buffer.alloc(2048));
    await waitFor(async () => (await readdir(join(storage, "temp"))).some(name => name.endsWith(".part")), "Partial upload never reached staging");
    interrupted.destroy();
    await waitFor(async () => (await readdir(join(storage, "temp"))).length === 0, "Interrupted upload left temporary files behind");

    await stop();
    await start({ FFMPEG_PATH: join(root, "missing-ffmpeg"), FFPROBE_PATH: join(root, "missing-ffprobe") });
    assert.equal((await fetch(media, { method: "HEAD" })).status, 200);
    const pending = await create(await readFile(fallback), "pending-demo.mp4");
    assert.equal(pending.status, "PENDING_ANALYSIS");
    assert.equal(pending.hasThumbnail, false);
    await stop();
    await start();
    assert.equal((await fetch(`${origin}/api/clips/${pending.id}`, { method: "POST", headers: { Origin: origin } })).status, 204);
    assert.equal((await fetch(`${origin}/api/clips/${pending.id}/media?kind=thumbnail`)).status, 200);

    await stop();
    await start({ MAX_UPLOAD_MIB: "16" });
    const padding = Buffer.alloc(11 * 1024 * 1024);
    padding.writeUInt32BE(padding.length);
    padding.write("free", 4);
    const large = await create(Buffer.concat([bytes, padding]), "large-valid.mp4");
    assert.equal(large.size, bytes.length + padding.length);
    assert.equal((await fetch(`${origin}/api/clips`, { method: "DELETE", body: JSON.stringify({ ids: [large.id] }),
      headers: { Origin: origin, "Content-Type": "application/json" } })).status, 204);

    const executablePath = process.env.CLIPFLOW_BROWSER_PATH;
    const channel = !executablePath && process.platform === "win32" && !existsSync(chromium.executablePath()) ? "msedge" : undefined;
    browser = await chromium.launch({ executablePath, channel });
    const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin);
    await page.getByRole("button", { name: "Preview desk-demo.mp4" }).waitFor();
    await page.getByRole("button", { name: "Import clips" }).click();
    const uploadDialog = page.getByRole("dialog");
    await uploadDialog.locator("input[type=file]").setInputFiles([portrait, extra]);
    await uploadDialog.getByRole("button", { name: "Upload 2 clips" }).click();
    await uploadDialog.getByText("Imported · Saved to the Clip Library.").last().waitFor();
    await waitFor(async () => await uploadDialog.getByText("Imported · Saved to the Clip Library.").count() === 2, "Batch did not import both clips");
    await uploadDialog.getByRole("button", { name: "Done" }).click();
    await page.getByRole("button", { name: "Preview portrait-demo.mp4" }).waitFor();
    assert.equal(await page.locator("dt").filter({ hasText: "Ready clips" }).locator("..").locator(".metric-value").textContent(), "4");
    await page.getByRole("link", { name: "Clip Library" }).click();
    await page.waitForURL(origin + "/clips");
    await page.getByRole("heading", { name: "Clip Library", exact: true }).waitFor();
    await page.getByRole("list", { name: "Clips", exact: true }).getByRole("button", { name: "Preview desk-demo.mp4" }).click();
    const video = page.getByRole("dialog").locator("video");
    await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
    await video.evaluate(element => { element.currentTime = 2.5; });
    await page.waitForFunction(() => {
      const current = document.querySelector("video");
      return current && !current.seeking && current.currentTime > 2.4;
    });
    await video.evaluate(async element => { await element.play(); });
    await page.waitForFunction(() => document.querySelector("video")?.currentTime > 2.6);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "List view" }).click();
    await page.reload();
    await page.locator('[data-view="list"]').waitFor();
    await page.getByLabel("Sort by").selectOption("Duration");
    assert.match(await page.locator(".clip-name").first().textContent(), /desk-demo/);
    const search = page.getByRole("searchbox");
    await search.fill("desk-demo");
    assert.equal(await page.locator(".clip-tile").count(), 1);
    await page.getByLabel("Actions for desk-demo.mp4").click();
    await page.getByRole("button", { name: "Rename" }).click();
    await page.getByRole("textbox", { name: "Display name" }).fill("Studio clip");
    await page.getByRole("button", { name: "Save name" }).click();
    await page.getByRole("button", { name: "Preview Studio clip" }).waitFor();
    await page.getByLabel("Actions for Studio clip").click();
    const downloaded = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download original" }).click();
    assert.equal((await downloaded).suggestedFilename(), "desk-demo.mp4");
    await search.fill("");
    await page.getByRole("button", { name: "Grid view" }).click();
    await page.screenshot({ path: join(screenshots, "library-light.png"), fullPage: true });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: "dark", reducedMotion: "reduce" });
    mobile.on("pageerror", error => errors.push(error.message));
    for (const route of ["/", "/clips", "/compose", "/calendar", "/queue", "/accounts", "/history", "/templates", "/settings"]) {
      assert.equal((await mobile.goto(origin + route)).status(), 200);
      await mobile.getByRole("heading", { level: 1 }).waitFor();
      assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth), 390, route);
    }
    assert.equal(await mobile.locator("html").getAttribute("data-theme"), "dark");
    await mobile.getByText("Video storage used", { exact: true }).waitFor();
    const storedBytes = (await Promise.all([fixture, portrait, fallback, extra].map(path => stat(path)))).reduce((sum, info) => sum + info.size, 0);
    const rounded = Math.round(storedBytes / 1024 * 10) / 10;
    assert.equal(await mobile.getByText("Video storage used", { exact: true }).locator("..").locator("dd").textContent(), `${rounded} KB`);
    await mobile.goto(origin + "/clips");
    await mobile.locator(".clip-tile").first().waitFor();
    await mobile.screenshot({ path: join(screenshots, "library-dark-mobile.png"), fullPage: true });
    await mobile.getByRole("button", { name: "Upload clips" }).click();
    await mobile.getByRole("dialog").waitFor();
    await mobile.screenshot({ path: join(screenshots, "upload-dark-mobile.png"), fullPage: false });
    await mobile.keyboard.press("Escape");
    assert(await mobile.getByRole("button", { name: "Upload clips" }).evaluate(element => document.activeElement === element));
    await mobile.getByRole("button", { name: "Open navigation" }).click();
    await mobile.getByRole("dialog").getByRole("link", { name: "Overview" }).click();
    await mobile.getByRole("heading", { name: "Overview" }).waitFor();
    await mobile.screenshot({ path: join(screenshots, "overview-dark-mobile.png"), fullPage: true });

    await page.getByLabel("Actions for Studio clip").click();
    await page.getByRole("button", { name: "Delete clip", exact: true }).click();
    await page.getByRole("button", { name: "Delete stored copies" }).click();
    await page.getByText("Clip deleted.", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Preview Studio clip" }).waitFor({ state: "hidden" });
    assert.equal((await fetch(media)).status, 404);
    await page.getByRole("button", { name: "Select clips" }).click();
    await page.getByRole("checkbox", { name: "Select all visible" }).check();
    await page.getByRole("button", { name: "Delete selected" }).click();
    await page.getByRole("button", { name: "Delete stored copies" }).click();
    await page.getByText("3 clips deleted.", { exact: true }).waitFor();
    await page.getByText("No clips yet", { exact: true }).waitFor();
    assert.deepEqual(await readdir(join(storage, "videos")), []);
    assert.deepEqual(await readdir(join(storage, "thumbnails")), []);
    assert.deepEqual(await readdir(join(storage, "temp")), []);
    assert.deepEqual(await readFile(fixture), bytes);
    assert.deepEqual(errors, []);
    await writeFile(join(screenshots, "server.log"), logs);
  } catch (error) {
    await writeFile(join(screenshots, "server.log"), logs);
    throw error;
  } finally {
    await browser?.close();
    await stop();
    assert.match(relative(sandbox, root), /^clipflow-[^\\/]+$/);
    await rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 150 });
  }
});
