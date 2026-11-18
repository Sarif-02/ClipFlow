import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd(), process.argv.includes("--dev"));
registerHooks({ resolve(specifier, context, next) {
  const url = specifier.startsWith("@/") ? pathToFileURL(resolve("src", specifier.slice(2))).href :
    specifier.startsWith(".") && context.parentURL?.startsWith("file:") ? new URL(specifier, context.parentURL).href : null;
  if (url && existsSync(fileURLToPath(url + ".ts"))) return next(url + ".ts", context);
  return next(specifier, context);
} });
const shutdown = new AbortController();
for (const name of ["SIGTERM", "SIGINT"]) process.on(name, () => shutdown.abort());
process.on("message", value => { if (value === "stop") shutdown.abort(); });
process.on("disconnect", () => shutdown.abort());
const { runWorker } = await import("../src/lib/publishing/worker.ts");
const { db } = await import("../src/lib/clips/db.ts");
try { await runWorker(shutdown.signal); }
catch { console.error("The publishing worker could not initialize. Check the local database and protected key configuration."); process.exitCode = 1; }
finally { await db().$disconnect(); if (process.connected) process.disconnect(); }
