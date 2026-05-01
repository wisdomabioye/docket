import "server-only";
import { env } from "@/config/env";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";
import type { Storage } from "./interface";

/**
 * Default storage backend, selected by `STORAGE_BACKEND`:
 *   - `local` (default) → LocalStorage, writes to `./storage/`. Fine
 *     for `pnpm dev`; ephemeral on serverless.
 *   - `s3` → S3Storage. Talks to any S3-API store (Cloudflare R2,
 *     AWS S3, MinIO, B2). Required env validated at boot via
 *     `env.ts` superRefine.
 *
 * The `Storage` interface is the single contract every call site sees;
 * swapping backends is a one-line env change with zero callsite churn.
 */
export const storage: Storage =
  env.STORAGE_BACKEND === "s3" ? new S3Storage() : new LocalStorage();

export type { Storage } from "./interface";
export { documentKey, verifySignedUrl } from "./local";
