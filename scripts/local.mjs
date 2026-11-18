import { fork, spawn } from "node:child_process";
import { createServer } from "node:https";
import { request } from "node:http";
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";

const dev = process.argv.includes("--dev");
nextEnv.loadEnvConfig(process.cwd(), dev);
const origin = new URL(process.env.APP_URL || "http://localhost:3001");
if (origin.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname) ||
    origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
  throw new Error("APP_URL must be an HTTP loopback origin.");
}
const address = origin.hostname === "[::1]" ? "::1" : "127.0.0.1";
const port = origin.port || "80";
const web = spawn(process.execPath, ["node_modules/next/dist/bin/next", dev ? "dev" : "start", "--hostname", address, "--port", port], { stdio: "inherit" });
const worker = fork("scripts/worker.mjs", dev ? ["--dev"] : [], { stdio: ["inherit", "inherit", "inherit", "ipc"] });
const callbacks = [];
if (process.env.META_TLS_CERT && process.env.META_TLS_KEY) {
  try {
    const tls = { cert: readFileSync(process.env.META_TLS_CERT), key: readFileSync(process.env.META_TLS_KEY) };
    const handler = (incoming, response) => {
      const path = incoming.url?.split("?")[0];
      if (incoming.method !== "GET" || incoming.headers.host !== "localhost:3443" || path !== "/api/oauth/instagram/callback") {
        response.writeHead(404).end();
        return;
      }
      const forward = request({ hostname: address, port, path: incoming.url, method: "GET",
        headers: { host: origin.host, cookie: incoming.headers.cookie ?? "" } }, result => {
        response.writeHead(result.statusCode ?? 502, result.headers);
        result.pipe(response);
      });
      forward.on("error", () => response.writeHead(503).end("ClipFlow is starting. Try reconnecting."));
      forward.end();
    };
    for (const host of ["127.0.0.1", "::1"]) {
      const callback = createServer(tls, handler).listen(3443, host);
      callback.on("error", () => console.error("The local HTTPS callback could not bind to a loopback interface."));
      callbacks.push(callback);
    }
  } catch { console.error("The local HTTPS callback certificate could not be loaded."); }
}
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const callback of callbacks) callback.close();
  if (worker.connected) worker.send("stop");
  const finish = () => { if (web.exitCode === null) web.kill(); };
  worker.once("exit", finish);
  const timeout = setTimeout(() => { if (worker.exitCode === null) worker.kill(); finish(); }, 35000);
  timeout.unref();
  if (worker.exitCode !== null) finish();
}
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, stop);
process.on("disconnect", stop);
web.on("exit", code => { if (!stopping) { process.exitCode = code ?? 1; stop(); } });
worker.on("exit", () => { if (!stopping) console.error("The publishing worker stopped. Restart ClipFlow to resume processing."); });
