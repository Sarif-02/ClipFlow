import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import { databasePath } from "@/lib/local-config";

const globalDb = globalThis as typeof globalThis & { clipflowDb?: PrismaClient; clipflowDbReady?: Promise<void> };

export function db() {
  return globalDb.clipflowDb ??= new PrismaClient({
    adapter: new PrismaBetterSqlite3({ url: databasePath(), timeout: 5000 }),
  });
}

export function enableWorkerWal() {
  return globalDb.clipflowDbReady ??= db().$queryRawUnsafe("PRAGMA journal_mode = WAL").then(() => {}).catch(error => {
    globalDb.clipflowDbReady = undefined;
    throw error;
  });
}
