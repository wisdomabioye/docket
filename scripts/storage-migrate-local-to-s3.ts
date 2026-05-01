/**
 * One-shot script: copy every file under `./storage/` (LocalStorage's
 * data directory) into the configured S3 bucket, preserving the same
 * key path. Used when promoting an environment from `STORAGE_BACKEND=
 * local` to `STORAGE_BACKEND=s3` — without this, every prior upload's
 * signed URL would 404 because the bytes only ever lived on the dev
 * machine's filesystem.
 *
 * Run with: `pnpm tsx --env-file=.env.local scripts/storage-migrate-local-to-s3.ts`
 *
 * Required env (validated via `@/config/env`):
 *   STORAGE_BACKEND=s3
 *   S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET
 *   S3_REGION (default: auto)
 *
 * Idempotent: each key is HEAD-checked first; if the object already
 * exists in S3, the local file is left alone and the script logs
 * `skip`. Re-running after a partial failure is safe — only the
 * missing keys upload.
 *
 * Optional flag: `--delete-local` removes each local file after a
 * successful upload. Off by default — first run should leave the
 * local copies in place so the operator can verify the cloud bucket
 * is correct before destroying the source.
 *
 * Known limitation — Content-Type: every uploaded object is written
 * with `application/octet-stream`. The original MIME type was kept
 * only in the `case_documents.mime_type` row, not in the local file
 * metadata, and we don't open a DB connection from a one-shot tool.
 * Practical impact: a presigned-URL download of a *migrated* object
 * may surface as a generic binary in the browser. Re-uploading the
 * same document via the app overwrites the object with the correct
 * `ContentType`. New uploads (post-migration) are unaffected — they
 * go through `S3Storage.put()` which sets the right header.
 */

import { readdir, readFile, stat, unlink } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  HeadObjectCommand,
  NotFound,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { env } from "@/config/env";

const STORAGE_ROOT = resolve(process.cwd(), "storage");
const DELETE_LOCAL = process.argv.includes("--delete-local");

type Counts = {
  uploaded: number;
  skipped: number;
  failed: number;
  deleted: number;
};

async function main(): Promise<void> {
  if (env.STORAGE_BACKEND !== "s3") {
    console.error(
      "[migrate] STORAGE_BACKEND must be `s3` to run this script. Set it in .env.local first.",
    );
    process.exit(1);
  }
  const bucket = env.S3_BUCKET;
  if (
    !bucket ||
    !env.S3_ACCESS_KEY_ID ||
    !env.S3_SECRET_ACCESS_KEY
  ) {
    // env.ts superRefine should have caught this; defensive double-check.
    console.error("[migrate] Missing S3 credentials.");
    process.exit(1);
  }

  // Confirm the local root exists. Empty / missing means nothing to
  // migrate, which is a valid no-op.
  try {
    const stats = await stat(STORAGE_ROOT);
    if (!stats.isDirectory()) {
      console.error(`[migrate] ${STORAGE_ROOT} exists but isn't a directory.`);
      process.exit(1);
    }
  } catch (err) {
    if (isErrnoNotFound(err)) {
      console.log(`[migrate] No local storage at ${STORAGE_ROOT} — nothing to migrate.`);
      return;
    }
    throw err;
  }

  const client = new S3Client({
    region: env.S3_REGION,
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  console.log(`[migrate] Source: ${STORAGE_ROOT}`);
  console.log(`[migrate] Bucket: ${bucket} (endpoint: ${env.S3_ENDPOINT ?? "AWS-default"})`);
  console.log(`[migrate] Delete local on success: ${DELETE_LOCAL ? "YES" : "no"}`);
  console.log("");

  const counts: Counts = { uploaded: 0, skipped: 0, failed: 0, deleted: 0 };

  for await (const localPath of walk(STORAGE_ROOT)) {
    // Storage keys use POSIX separators regardless of host OS;
    // `LocalStorage` writes with `path.join` which uses the platform
    // separator on Windows. Normalise so the cloud key matches the
    // application's `documentKey()` output exactly.
    const key = relative(STORAGE_ROOT, localPath).split(sep).join("/");
    if (key.length === 0) continue;

    let alreadyExists = false;
    try {
      await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      alreadyExists = true;
    } catch (err) {
      // The SDK throws a typed `NotFound` instance for missing keys —
      // that's the happy path (we'll upload). Any other error (denied,
      // network, throttle) gets logged and the file skipped without
      // counting as success.
      if (!(err instanceof NotFound)) {
        console.error(`[migrate] HEAD ${key} failed:`, err);
        counts.failed += 1;
        continue;
      }
    }

    if (alreadyExists) {
      console.log(`skip   ${key}`);
      counts.skipped += 1;
      await maybeDeleteLocal(localPath, counts);
      continue;
    }

    try {
      const bytes = await readFile(localPath);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: bytes,
          // We don't have the original mime type recorded outside the
          // DB row. See the "Known limitation — Content-Type" note in
          // the file header.
          ContentType: "application/octet-stream",
        }),
      );
      console.log(`upload ${key} (${bytes.byteLength} bytes)`);
      counts.uploaded += 1;
      await maybeDeleteLocal(localPath, counts);
    } catch (err) {
      console.error(`[migrate] PUT ${key} failed:`, err);
      counts.failed += 1;
    }
  }

  console.log("");
  console.log(
    `[migrate] Done. uploaded=${counts.uploaded} skipped=${counts.skipped} failed=${counts.failed}` +
      (DELETE_LOCAL ? ` deleted_local=${counts.deleted}` : ""),
  );
  if (counts.failed > 0) process.exit(1);
}

/** Type guard for the Node "no such file" errno. Avoids the
 *  `as NodeJS.ErrnoException` shape-cast pattern in favor of an
 *  `unknown`-aware narrow that survives a stricter eslint config. */
function isErrnoNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT"
  );
}

/** Optionally delete the local copy AND bump the deleted counter.
 *  Called from BOTH the `skip` branch (object already in S3 → safe
 *  to drop the local on re-runs) and the `upload` branch (post-
 *  successful upload). Centralising this avoids the two paths drifting. */
async function maybeDeleteLocal(localPath: string, counts: Counts): Promise<void> {
  if (!DELETE_LOCAL) return;
  await unlink(localPath);
  counts.deleted += 1;
}

/** Recursive-walk an absolute directory, yielding every file's
 *  absolute path. Skips hidden files (`.DS_Store`, `.gitkeep`) so we
 *  don't pollute the bucket with metadata noise. */
async function* walk(dir: string): AsyncGenerator<string, void, void> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (entry.isFile()) {
      yield full;
    }
    // Symlinks / sockets / fifos: ignore (unexpected in storage/).
  }
}

main().catch((err) => {
  console.error("[migrate] Fatal:", err);
  process.exit(1);
});
