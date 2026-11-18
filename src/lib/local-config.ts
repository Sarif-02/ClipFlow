import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function databasePath() {
  const value = process.env.DATABASE_URL?.trim() || "file:./data/database/clipflow.db";
  if (!value.startsWith("file:") || value === "file::memory:" || /[?#]/.test(value)) {
    throw new Error("DATABASE_URL must point to a local SQLite file.");
  }
  const path = value.startsWith("file://") ? fileURLToPath(value) : resolve(value.slice(5));
  if (inPublicDirectory(path)) throw new Error("SQLite data must not be stored inside public.");
  return path;
}

export const databaseUrl = () => `file:${databasePath().replaceAll("\\", "/")}`;

export function inPublicDirectory(path: string) {
  const fromPublic = relative(resolve(process.cwd(), "public"), path);
  return fromPublic === "" || (!isAbsolute(fromPublic) && !/^\.\.(?:[\\/]|$)/.test(fromPublic));
}

export function storageRoot() {
  const configured = process.env.STORAGE_PATH?.trim();
  const path = configured ? resolve(configured) : resolve(process.cwd(), "data");
  if (inPublicDirectory(path)) throw new Error("Media must not be stored inside public.");
  return path;
}

export function maxUploadBytes() {
  const mib = Number(process.env.MAX_UPLOAD_MIB || 512);
  if (!Number.isInteger(mib) || mib < 1 || mib > 2047) throw new Error("MAX_UPLOAD_MIB must be between 1 and 2047.");
  return mib * 1024 * 1024;
}
