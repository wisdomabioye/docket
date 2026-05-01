import "server-only";
import {
  mkdir,
  readFile,
  unlink,
  writeFile,
} from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { createHmac, randomBytes } from "node:crypto";
import type { Storage } from "./interface";
import { env } from "@/config/env";
import { publicEnv } from "@/config/public-env";

/**
 * Local filesystem storage. Files live under `./storage/` (gitignored).
 * Signed URLs use a HMAC token that the `/api/files/[token]` route
 * verifies before streaming bytes back to the browser.
 *
 * Token format: `<base64url(payload)>.<hex(hmac)>`
 *   payload = `{ key, expiresAt }` JSON
 *
 * Why HMAC and not raw key paths in the URL: prevents arbitrary-key
 * downloads (e.g., `/api/files?key=../etc/passwd`). The HMAC binds the
 * URL to a specific key + expiry, signed by `AUTH_SECRET`.
 */

const ROOT = resolve(process.cwd(), "storage");

/**
 * Reuse `AUTH_SECRET` for HMAC — already required when any auth provider
 * is configured. Avoids a second secret to manage. If unset (e.g. tests
 * without AUTH_SECRET), fall back to a deterministic dev value (signed
 * URLs only valid in this process).
 */
function hmacKey(): string {
  return env.AUTH_SECRET ?? "dev-only-storage-hmac-key-do-not-ship";
}

export class LocalStorage implements Storage {
  async put(
    key: string,
    bytes: Buffer,
    // mimeType ignored on disk — preserved on the row metadata. Cloud
    // backends (Stage 12) use it for `Content-Type` on the object.
    _opts: { mimeType: string }, // eslint-disable-line @typescript-eslint/no-unused-vars
  ): Promise<void> {
    const path = absolutePath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }

  async get(key: string): Promise<Buffer> {
    return await readFile(absolutePath(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(absolutePath(key));
    } catch (err) {
      // ENOENT is fine — already gone.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async signedUrl(
    key: string,
    opts?: { expiresInSeconds?: number },
  ): Promise<string> {
    const expiresAt = Date.now() + (opts?.expiresInSeconds ?? 300) * 1000;
    const payload = Buffer.from(JSON.stringify({ key, expiresAt }))
      .toString("base64url");
    const sig = createHmac("sha256", hmacKey()).update(payload).digest("hex");
    const token = `${payload}.${sig}`;
    return `${publicEnv.appUrl}/api/files/${token}`;
  }
}

/** Verify + decode an `/api/files/[token]` URL token. Used by the route handler. */
export function verifySignedUrl(token: string): { key: string } | null {
  const dot = token.lastIndexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", hmacKey()).update(payload).digest("hex");
  if (!timingSafeEqualHex(sig, expected)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isPayload(parsed)) return null;
  if (Date.now() > parsed.expiresAt) return null;
  if (!isSafeKey(parsed.key)) return null;
  return { key: parsed.key };
}

/** Path-traversal block: keys cannot contain `..` segments. */
function isSafeKey(k: string): boolean {
  if (typeof k !== "string" || k.length === 0) return false;
  const norm = resolve(ROOT, k);
  return norm === ROOT || norm.startsWith(ROOT + sep);
}

function absolutePath(key: string): string {
  if (!isSafeKey(key)) {
    throw new Error(`unsafe storage key: ${key}`);
  }
  return resolve(ROOT, key);
}

function isPayload(v: unknown): v is { key: string; expiresAt: number } {
  return (
    typeof v === "object" &&
    v !== null &&
    "key" in v &&
    "expiresAt" in v &&
    typeof (v as Record<string, unknown>).key === "string" &&
    typeof (v as Record<string, unknown>).expiresAt === "number"
  );
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/** Random key suffix for cases where we want unguessable file paths. */
export function randomToken(): string {
  return randomBytes(16).toString("hex");
}

/** Build the canonical document storage key. */
export function documentKey(args: {
  caseId: string;
  documentId: string;
  filename: string;
}): string {
  // Filename is preserved for download UX but the docId guarantees uniqueness.
  const safeName = args.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200);
  return `cases/${args.caseId}/documents/${args.documentId}/${safeName}`;
}
