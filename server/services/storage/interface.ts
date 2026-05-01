import "server-only";

/**
 * Storage backend abstraction. Phase 1 ships only `LocalStorage`
 * (writes to `./storage/`). Stage 12 swaps in S3/R2/Supabase Storage by
 * implementing this interface and switching the export in `./index.ts`.
 *
 * Keys: callers pass full storage paths (e.g.
 * `cases/{caseId}/documents/{docId}/{filename}`). The backend treats them
 * as opaque strings.
 */
export interface Storage {
  /** Persist bytes at `key`. Idempotent (overwrites). */
  put(key: string, bytes: Buffer, opts: { mimeType: string }): Promise<void>;

  /** Read bytes back. Throws if missing. */
  get(key: string): Promise<Buffer>;

  /** Soft-removed via tombstone, or hard-removed. Backend's choice. */
  delete(key: string): Promise<void>;

  /**
   * Time-bounded URL the browser can use to download the file directly.
   * For LocalStorage this is a token-protected `/api/files/[token]` URL;
   * for cloud backends it's a presigned object URL.
   */
  signedUrl(key: string, opts?: { expiresInSeconds?: number }): Promise<string>;
}
