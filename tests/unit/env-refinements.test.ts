import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * Tests for the OAuth pair + AUTH_SECRET invariants in `config/env.ts`.
 *
 * We can't import `config/env.ts` directly: it runs validation at module
 * load and would crash with the test process's own `process.env`. Instead
 * we recreate the same schema shape here and exercise the invariants in
 * isolation. If `config/env.ts` ever changes its rules, this file must
 * follow.
 */

const PAIRS: Array<[idKey: string, secretKey: string]> = [
  ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
  ["AUTH_MICROSOFT_ID", "AUTH_MICROSOFT_SECRET"],
  ["AUTH_APPLE_ID", "AUTH_APPLE_SECRET"],
];

const INNGEST_REQUIRED_IN_PROD = [
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
] as const;

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).optional(),
    AUTH_SECRET: z.string().min(32).optional(),
    AUTH_GOOGLE_ID: z.string().min(1).optional(),
    AUTH_GOOGLE_SECRET: z.string().min(1).optional(),
    AUTH_MICROSOFT_ID: z.string().min(1).optional(),
    AUTH_MICROSOFT_SECRET: z.string().min(1).optional(),
    AUTH_APPLE_ID: z.string().min(1).optional(),
    AUTH_APPLE_SECRET: z.string().min(1).optional(),
    INNGEST_EVENT_KEY: z.string().min(1).optional(),
    INNGEST_SIGNING_KEY: z.string().min(1).optional(),
  })
  .superRefine((v, ctx) => {
    for (const [idKey, secretKey] of PAIRS) {
      if (Boolean((v as Record<string, unknown>)[idKey]) !== Boolean((v as Record<string, unknown>)[secretKey])) {
        ctx.addIssue({
          code: "custom",
          message: `${idKey} and ${secretKey} must both be set or both unset`,
          path: [secretKey],
        });
      }
    }
    const anyProviderSet = PAIRS.some(
      ([idKey, secretKey]) =>
        (v as Record<string, unknown>)[idKey] && (v as Record<string, unknown>)[secretKey],
    );
    if (anyProviderSet && !v.AUTH_SECRET) {
      ctx.addIssue({
        code: "custom",
        message: "AUTH_SECRET is required when any OAuth provider is configured",
        path: ["AUTH_SECRET"],
      });
    }
    if (v.NODE_ENV === "production") {
      for (const key of INNGEST_REQUIRED_IN_PROD) {
        if (!(v as Record<string, unknown>)[key]) {
          ctx.addIssue({
            code: "custom",
            message: `${key} is required in production`,
            path: [key],
          });
        }
      }
    }
  });

const VALID_SECRET = "x".repeat(40);

describe("env: OAuth pair invariants", () => {
  it("accepts both halves of a Google pair", () => {
    const r = schema.safeParse({
      AUTH_SECRET: VALID_SECRET,
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
    });
    expect(r.success).toBe(true);
  });

  it("accepts neither half of a pair", () => {
    const r = schema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("rejects only the ID set", () => {
    const r = schema.safeParse({ AUTH_GOOGLE_ID: "id" });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        r.error.issues.some((i) => i.path.includes("AUTH_GOOGLE_SECRET")),
    ).toBe(true);
  });

  it("rejects only the secret set", () => {
    const r = schema.safeParse({ AUTH_GOOGLE_SECRET: "secret" });
    expect(r.success).toBe(false);
  });

  it("validates each provider independently", () => {
    // Google fully set, Microsoft half-set
    const r = schema.safeParse({
      AUTH_SECRET: VALID_SECRET,
      AUTH_GOOGLE_ID: "g-id",
      AUTH_GOOGLE_SECRET: "g-secret",
      AUTH_MICROSOFT_ID: "m-id",
      // missing AUTH_MICROSOFT_SECRET
    });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        r.error.issues.some((i) => i.path.includes("AUTH_MICROSOFT_SECRET")),
    ).toBe(true);
  });
});

describe("env: AUTH_SECRET requirement", () => {
  it("requires AUTH_SECRET when any provider is configured", () => {
    const r = schema.safeParse({
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
      // missing AUTH_SECRET
    });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        r.error.issues.some((i) => i.path.includes("AUTH_SECRET")),
    ).toBe(true);
  });

  it("does not require AUTH_SECRET when no provider is configured", () => {
    const r = schema.safeParse({});
    expect(r.success).toBe(true);
  });

  it("requires AUTH_SECRET min length 32", () => {
    const r = schema.safeParse({
      AUTH_SECRET: "short",
      AUTH_GOOGLE_ID: "id",
      AUTH_GOOGLE_SECRET: "secret",
    });
    expect(r.success).toBe(false);
  });
});

describe("env: Inngest production invariant", () => {
  it("requires INNGEST_EVENT_KEY and INNGEST_SIGNING_KEY in production", () => {
    const r = schema.safeParse({ NODE_ENV: "production" });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        INNGEST_REQUIRED_IN_PROD.every((k) =>
          r.error.issues.some((i) => i.path.includes(k)),
        ),
    ).toBe(true);
  });

  it("rejects production with only the event key set", () => {
    const r = schema.safeParse({
      NODE_ENV: "production",
      INNGEST_EVENT_KEY: "evt_abc",
    });
    expect(r.success).toBe(false);
    expect(
      r.success === false &&
        r.error.issues.some((i) => i.path.includes("INNGEST_SIGNING_KEY")),
    ).toBe(true);
  });

  it("accepts production with both keys set", () => {
    const r = schema.safeParse({
      NODE_ENV: "production",
      INNGEST_EVENT_KEY: "evt_abc",
      INNGEST_SIGNING_KEY: "signkey_abc",
    });
    expect(r.success).toBe(true);
  });

  it("does not require Inngest keys outside production", () => {
    for (const env of ["development", "test"] as const) {
      const r = schema.safeParse({ NODE_ENV: env });
      expect(r.success, `expected ${env} to pass without Inngest keys`).toBe(true);
    }
  });
});
