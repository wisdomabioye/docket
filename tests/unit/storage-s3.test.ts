import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * Tests for `server/services/storage/s3.ts` and the S3-related env
 * invariants in `config/env.ts`.
 *
 * The SDK is mocked at the module boundary so we never make a network
 * call; we assert on the commands the adapter constructs and the
 * arguments handed to `getSignedUrl`. Same approach as
 * `tests/unit/jobs-shared.test.ts`.
 */

// --- env superRefine: STORAGE_BACKEND=s3 requires every S3 var ---------

type S3VarsShape = {
  STORAGE_BACKEND: "local" | "s3";
  S3_ENDPOINT?: string;
  S3_ACCESS_KEY_ID?: string;
  S3_SECRET_ACCESS_KEY?: string;
  S3_BUCKET?: string;
  S3_REGION: string;
};

const S3_REQUIRED_KEYS: Array<keyof S3VarsShape> = [
  "S3_ENDPOINT",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
];

const envSchema = z
  .object({
    STORAGE_BACKEND: z.enum(["local", "s3"]).default("local"),
    S3_ENDPOINT: z.url().optional(),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).optional(),
    S3_REGION: z.string().min(1).default("auto"),
  })
  .superRefine((v, ctx) => {
    if (v.STORAGE_BACKEND === "s3") {
      for (const key of S3_REQUIRED_KEYS) {
        if (!v[key]) {
          ctx.addIssue({
            code: "custom",
            message: `${key} is required when STORAGE_BACKEND=s3`,
            path: [key],
          });
        }
      }
    }
  });

describe("env: STORAGE_BACKEND invariants", () => {
  it("defaults to local without any S3 vars", () => {
    const r = envSchema.safeParse({});
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.STORAGE_BACKEND).toBe("local");
  });

  it("accepts s3 with every required var present", () => {
    const r = envSchema.safeParse({
      STORAGE_BACKEND: "s3",
      S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_BUCKET: "docket-files",
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.S3_REGION).toBe("auto");
  });

  it("rejects s3 with a missing endpoint", () => {
    const r = envSchema.safeParse({
      STORAGE_BACKEND: "s3",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
      S3_BUCKET: "docket-files",
    });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        r.error.issues.some((i) => i.path.includes("S3_ENDPOINT")),
    ).toBe(true);
  });

  it("rejects s3 with a missing bucket", () => {
    const r = envSchema.safeParse({
      STORAGE_BACKEND: "s3",
      S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com",
      S3_ACCESS_KEY_ID: "k",
      S3_SECRET_ACCESS_KEY: "s",
    });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        r.error.issues.some((i) => i.path.includes("S3_BUCKET")),
    ).toBe(true);
  });

  it("does not require S3 vars when STORAGE_BACKEND=local", () => {
    const r = envSchema.safeParse({ STORAGE_BACKEND: "local" });
    expect(r.success).toBe(true);
  });
});

// --- S3Storage adapter behavior ----------------------------------------

// `vi.hoisted` so the mock factory below sees these refs even though
// `vi.mock` is hoisted above the imports at module load.
const sendMock = vi.hoisted(() => vi.fn());
const getSignedUrlMock = vi.hoisted(() => vi.fn());

vi.mock("@aws-sdk/client-s3", async () => {
  // Pull `NoSuchKey` from the real module so `instanceof` checks in the
  // adapter still work — we only mock the client and command shapes.
  // Using plain class declarations (not vi.fn) so `new S3Client(...)`
  // and `new GetObjectCommand(...)` behave like real constructors.
  const actual = await vi.importActual<typeof import("@aws-sdk/client-s3")>(
    "@aws-sdk/client-s3",
  );
  class FakeS3Client {
    send = sendMock;
  }
  class FakeCommand {
    constructor(
      public readonly input: unknown,
      public readonly __cmd: string,
    ) {}
  }
  class PutObjectCommand extends FakeCommand {
    constructor(input: unknown) {
      super(input, "Put");
    }
  }
  class GetObjectCommand extends FakeCommand {
    constructor(input: unknown) {
      super(input, "Get");
    }
  }
  class DeleteObjectCommand extends FakeCommand {
    constructor(input: unknown) {
      super(input, "Delete");
    }
  }
  return {
    ...actual,
    S3Client: FakeS3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: getSignedUrlMock,
}));

// Stub env so the adapter sees a configured S3 backend at import time.
// The real `@/config/env` would fail validation in this process.
vi.mock("@/config/env", () => ({
  env: {
    STORAGE_BACKEND: "s3",
    S3_ENDPOINT: "https://abc.r2.cloudflarestorage.com",
    S3_ACCESS_KEY_ID: "test-access-key",
    S3_SECRET_ACCESS_KEY: "test-secret-key",
    S3_BUCKET: "docket-test",
    S3_REGION: "auto",
  },
}));

beforeEach(async () => {
  sendMock.mockReset();
  getSignedUrlMock.mockReset();
  // Clear adapter's cached client between tests so the S3Client mock
  // counts from zero each time.
  const { __resetS3ClientForTests } = await import(
    "@/server/services/storage/s3"
  );
  __resetS3ClientForTests();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("S3Storage.put", () => {
  it("issues PutObjectCommand with bucket, key, body, content-type", async () => {
    sendMock.mockResolvedValueOnce({});
    const { S3Storage } = await import("@/server/services/storage/s3");
    const s = new S3Storage();
    const bytes = Buffer.from("hello");
    await s.put("cases/c1/documents/d1/x.pdf", bytes, {
      mimeType: "application/pdf",
    });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const cmd = sendMock.mock.calls[0]![0] as {
      __cmd: string;
      input: Record<string, unknown>;
    };
    expect(cmd.__cmd).toBe("Put");
    expect(cmd.input).toEqual({
      Bucket: "docket-test",
      Key: "cases/c1/documents/d1/x.pdf",
      Body: bytes,
      ContentType: "application/pdf",
    });
  });
});

describe("S3Storage.get", () => {
  it("returns a Buffer assembled from the streamed body", async () => {
    sendMock.mockResolvedValueOnce({
      Body: {
        transformToByteArray: async () =>
          new Uint8Array([0x68, 0x69]), // "hi"
      },
    });
    const { S3Storage } = await import("@/server/services/storage/s3");
    const s = new S3Storage();
    const out = await s.get("k");
    expect(out).toBeInstanceOf(Buffer);
    expect(out.toString("utf8")).toBe("hi");
  });

  it("translates NoSuchKey into a stable not-found error", async () => {
    const { NoSuchKey } = await import("@aws-sdk/client-s3");
    sendMock.mockRejectedValueOnce(
      new NoSuchKey({ message: "missing", $metadata: {} }),
    );
    const { S3Storage } = await import("@/server/services/storage/s3");
    const s = new S3Storage();
    await expect(s.get("missing-key")).rejects.toThrow(
      /storage object not found: missing-key/,
    );
  });

  it("throws when the response has no body", async () => {
    sendMock.mockResolvedValueOnce({ Body: undefined });
    const { S3Storage } = await import("@/server/services/storage/s3");
    const s = new S3Storage();
    await expect(s.get("k")).rejects.toThrow(/empty body/);
  });

  it("propagates non-NoSuchKey errors unchanged", async () => {
    const boom = new Error("network down");
    sendMock.mockRejectedValueOnce(boom);
    const { S3Storage } = await import("@/server/services/storage/s3");
    const s = new S3Storage();
    await expect(s.get("k")).rejects.toBe(boom);
  });
});

describe("S3Storage.delete", () => {
  it("issues DeleteObjectCommand with bucket + key", async () => {
    sendMock.mockResolvedValueOnce({});
    const { S3Storage } = await import("@/server/services/storage/s3");
    const s = new S3Storage();
    await s.delete("k");
    const cmd = sendMock.mock.calls[0]![0] as {
      __cmd: string;
      input: Record<string, unknown>;
    };
    expect(cmd.__cmd).toBe("Delete");
    expect(cmd.input).toEqual({ Bucket: "docket-test", Key: "k" });
  });
});

describe("S3Storage.signedUrl", () => {
  it("defaults to 5 minutes when no expiry is given", async () => {
    getSignedUrlMock.mockResolvedValueOnce("https://signed.example/x");
    const { S3Storage } = await import("@/server/services/storage/s3");
    const url = await new S3Storage().signedUrl("k");
    expect(url).toBe("https://signed.example/x");
    const opts = getSignedUrlMock.mock.calls[0]![2] as { expiresIn: number };
    expect(opts.expiresIn).toBe(300);
  });

  it("forwards the requested expiry up to the SigV4 7-day cap", async () => {
    getSignedUrlMock.mockResolvedValueOnce("https://signed.example/x");
    const { S3Storage } = await import("@/server/services/storage/s3");
    await new S3Storage().signedUrl("k", { expiresInSeconds: 3600 });
    const opts = getSignedUrlMock.mock.calls[0]![2] as { expiresIn: number };
    expect(opts.expiresIn).toBe(3600);
  });

  it("clamps an over-cap expiry rather than throwing", async () => {
    getSignedUrlMock.mockResolvedValueOnce("https://signed.example/x");
    const { S3Storage } = await import("@/server/services/storage/s3");
    // 30 days requested → 7 days returned.
    await new S3Storage().signedUrl("k", {
      expiresInSeconds: 30 * 24 * 60 * 60,
    });
    const opts = getSignedUrlMock.mock.calls[0]![2] as { expiresIn: number };
    expect(opts.expiresIn).toBe(7 * 24 * 60 * 60);
  });
});
