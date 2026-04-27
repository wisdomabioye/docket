import { storage, verifySignedUrl } from "@/server/services/storage";

/**
 * Stream a file for a HMAC-signed URL produced by `storage.signedUrl()`.
 * Token format + verification lives in `server/services/storage/local.ts`.
 *
 * No auth check here — the HMAC binds the URL to a specific key + expiry,
 * so possession of the URL is the authorization. This is the standard
 * model for object-storage signed URLs.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const verified = verifySignedUrl(token);
  if (!verified) {
    return new Response("invalid or expired", { status: 403 });
  }
  try {
    const bytes = await storage.get(verified.key);
    // Buffer → Uint8Array — Buffer is a Uint8Array subclass at runtime
    // but TS's BodyInit doesn't accept it directly under exactOptional.
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "content-type": "application/octet-stream",
        "content-disposition": `inline; filename="${basename(verified.key)}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch {
    return new Response("not found", { status: 404 });
  }
}

function basename(key: string): string {
  const slash = key.lastIndexOf("/");
  return slash >= 0 ? key.slice(slash + 1) : key;
}
