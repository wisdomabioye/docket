import "server-only";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Storage } from "./interface";
import { env } from "@/config/env";

/**
 * S3-compatible object storage. Talks to any S3-API store distinguished
 * by `S3_ENDPOINT` + `S3_REGION`: Cloudflare R2 (primary target — set
 * `S3_REGION=auto` and the R2 endpoint), AWS S3 (omit endpoint, use
 * real region), MinIO, B2, etc. Same wire protocol; same SDK.
 *
 * Method semantics mirror `LocalStorage` byte-for-byte so swapping
 * backends in `./index.ts` requires zero call-site changes.
 *
 * Signed URL TTL: SigV4 caps presigned URLs at 7 days (604800s). We
 * default to the same 5 minutes the local backend uses; callers that
 * pass a longer expiry get clamped at 7 days to avoid a runtime SDK
 * rejection.
 */

const SIGV4_MAX_EXPIRES_SECONDS = 7 * 24 * 60 * 60;
const DEFAULT_EXPIRES_SECONDS = 300;

let cachedClient: S3Client | null = null;

function bucket(): string {
  // Belt-and-suspenders: env.ts superRefine already requires this
  // when STORAGE_BACKEND=s3, but the type stays `string | undefined`
  // since the schema field itself is `.optional()`. Throw instead of
  // silently uploading to a stringified "undefined" key namespace.
  if (!env.S3_BUCKET) {
    throw new Error("S3_BUCKET is required when STORAGE_BACKEND=s3");
  }
  return env.S3_BUCKET;
}

function client(): S3Client {
  if (cachedClient) return cachedClient;
  if (!env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error(
      "S3 credentials are required when STORAGE_BACKEND=s3 — env validation should have caught this",
    );
  }
  cachedClient = new S3Client({
    region: env.S3_REGION,
    // R2 + MinIO need a custom endpoint; AWS S3 derives from region
    // when this is undefined.
    ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
    // R2 doesn't support virtual-hosted-style addressing for all
    // buckets; path-style works for R2, MinIO, and (still) AWS S3.
    forcePathStyle: true,
  });
  return cachedClient;
}

export class S3Storage implements Storage {
  async put(
    key: string,
    bytes: Buffer,
    opts: { mimeType: string },
  ): Promise<void> {
    await client().send(
      new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: bytes,
        ContentType: opts.mimeType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    let res;
    try {
      res = await client().send(
        new GetObjectCommand({ Bucket: bucket(), Key: key }),
      );
    } catch (err) {
      // Mirror LocalStorage: missing key surfaces as a thrown error.
      // Re-throw with a stable message so callers can pattern-match
      // identically across backends.
      if (err instanceof NoSuchKey) {
        throw new Error(`storage object not found: ${key}`);
      }
      throw err;
    }
    if (!res.Body) {
      throw new Error(`storage object has empty body: ${key}`);
    }
    // `transformToByteArray` is the supported, stream-agnostic way to
    // collect the response body across Node / browser / edge runtimes.
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    // S3 DeleteObject is idempotent — deleting a missing key returns
    // 204 with `DeleteMarker: undefined`; no NoSuchKey to swallow.
    await client().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: key }),
    );
  }

  async signedUrl(
    key: string,
    opts?: { expiresInSeconds?: number },
  ): Promise<string> {
    const requested = opts?.expiresInSeconds ?? DEFAULT_EXPIRES_SECONDS;
    // SigV4 hard cap. Clamp instead of throwing so a caller passing an
    // optimistic 30-day TTL (matching what some non-AWS backends allow)
    // gets a usable URL rather than a 500.
    const expiresIn = Math.min(requested, SIGV4_MAX_EXPIRES_SECONDS);
    return await getSignedUrl(
      client(),
      new GetObjectCommand({ Bucket: bucket(), Key: key }),
      { expiresIn },
    );
  }
}

/** Test-only: drop the cached client so a re-import after env mutation
 *  rebuilds with fresh credentials. Production callers never need this. */
export function __resetS3ClientForTests(): void {
  cachedClient = null;
}
