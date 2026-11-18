import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { linkSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { databasePath } from "@/lib/local-config";

let cached: Buffer | undefined;

function masterKey() {
  if (cached) return cached;
  const supplied = process.env.TOKEN_ENCRYPTION_KEY;
  if (supplied) {
    if (!/^[a-f\d]{64}$/i.test(supplied)) throw new Error("TOKEN_ENCRYPTION_KEY must be 32 bytes in hex.");
    return cached = Buffer.from(supplied, "hex");
  }
  const dir = join(dirname(databasePath()), ".clipflow-private");
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const folder = lstatSync(dir);
  if (!folder.isDirectory() || folder.isSymbolicLink() || (process.platform !== "win32" && (folder.mode & 0o077))) {
    throw new Error("The ClipFlow private configuration directory is not protected.");
  }
  if (process.platform === "win32") {
    const windowsRoot = process.env.SystemRoot;
    if (!windowsRoot) throw new Error("Windows SystemRoot is required to protect the master key.");
    const system = join(windowsRoot, "System32");
    const sid = /S-1-[\d-]+/.exec(execFileSync(join(system, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }))?.[0];
    if (!sid) throw new Error("The Windows user could not be identified to protect the master key.");
    execFileSync(join(system, "icacls.exe"), [dir, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "*S-1-5-18:(OI)(CI)F"],
      { windowsHide: true, stdio: "ignore" });
  }
  const file = join(dir, "master.key");
  const read = () => {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || (process.platform !== "win32" && (info.mode & 0o077))) {
      throw new Error("The ClipFlow master key file is not protected.");
    }
    const key = readFileSync(file);
    if (key.length !== 32) throw new Error("The ClipFlow master key file is invalid.");
    return key;
  };
  // Publish a complete key atomically; web and worker may start together.
  try { return cached = read(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const temp = join(dir, randomBytes(16).toString("hex"));
  writeFileSync(temp, randomBytes(32), { mode: 0o600, flag: "wx" });
  try {
    try { linkSync(temp, file); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    return cached = readFileSync(file);
  } finally { unlinkSync(temp); }
}

export function seal(value: unknown, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", masterKey(), nonce);
  cipher.setAAD(Buffer.from(context));
  const content = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return [nonce, cipher.getAuthTag(), content].map(part => part.toString("base64url")).join(".");
}

export function initializeMasterKey() { masterKey(); }

export function unseal<T>(value: string, context: string): T {
  const [nonce, tag, content] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", masterKey(), nonce);
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(content), decipher.final()]).toString("utf8")) as T;
}
