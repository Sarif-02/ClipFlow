import { loadEnvConfig } from "@next/env";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";
import { defineConfig } from "prisma/config";
import { databasePath, databaseUrl } from "./src/lib/local-config";

loadEnvConfig(process.cwd(), process.env.CLIPFLOW_ENV === "development");
if (process.env.CLIPFLOW_ENV) {
  const file = databasePath();
  mkdirSync(dirname(file), { recursive: true });
  try { closeSync(openSync(file, "wx")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: databaseUrl() },
});
