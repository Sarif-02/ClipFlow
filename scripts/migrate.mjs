import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const mode = process.argv[2] === "development" ? "development" : "production";
const prisma = require.resolve("prisma/build/index.js");

function migrate(command) {
  const result = spawnSync(process.execPath, [prisma, "migrate", command], {
    stdio: "inherit", windowsHide: true, env: { ...process.env, CLIPFLOW_ENV: mode },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

// Prisma deploy acquires a SQLite write lock even when there are no pending migrations.
const needsDeploy = process.argv.includes("--deploy") || migrate("status") !== 0;
process.exitCode = needsDeploy ? migrate("deploy") : 0;
