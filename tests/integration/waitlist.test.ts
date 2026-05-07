// @vitest-environment node
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { waitlistEntries } from "@/server/db/schema";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import {
  closeTestDb,
  getTestDb,
  type TestDb,
} from "../helpers/db";

/**
 * End-to-end tests for the waitlist signup procedure.
 * No auth required (publicProcedure). Touches the real DB via the owner
 * connection (no RLS).
 */

const callerFactory = createCallerFactory(appRouter);
const callAnon = () =>
  callerFactory({ headers: new Headers(), user: null });

let db: TestDb | null = null;

function gate(ctx: { skip: () => void }): TestDb {
  if (!db) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  await wipe(db);
});

afterEach(async () => {
  if (db) await wipe(db);
});

afterAll(async () => {
  await closeTestDb();
});

describe("marketing.joinWaitlist", () => {
  it("inserts a new email", async (ctx) => {
    const db = gate(ctx);
    const result = await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-new@docket.local",
      name: "Test One",
      source: "landing",
    });
    expect(result.ok).toBe(true);
    expect(result.alreadyOnList).toBe(false);

    const rows = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-new@docket.local"));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("Test One");
    expect(rows[0]?.source).toBe("landing");
  });

  it("lowercases email before storing", async (ctx) => {
    const db = gate(ctx);
    await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "MixedCase@Docket.Local",
    });
    const rows = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "mixedcase@docket.local"));
    expect(rows).toHaveLength(1);
  });

  it("silently succeeds on duplicate email (no enumeration)", async (ctx) => {
    gate(ctx);
    const first = await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-dup@docket.local",
    });
    expect(first.alreadyOnList).toBe(false);

    const second = await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-dup@docket.local",
    });
    expect(second.ok).toBe(true);
    expect(second.alreadyOnList).toBe(true);
  });

  it("rejects invalid email format", async (ctx) => {
    gate(ctx);
    await expect(
      callAnon().marketing.joinWaitlist({ kind: "general", email: "not-an-email" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects empty-string optional fields (boundary defense)", async (ctx) => {
    gate(ctx);
    await expect(
      callAnon().marketing.joinWaitlist({
        kind: "general",
        email: "wl-empty@docket.local",
        name: "",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("silently succeeds and does NOT insert when honeypot is filled", async (ctx) => {
    const db = gate(ctx);
    const result = await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-bot@docket.local",
      hp: "i-am-a-bot",
    });
    expect(result.ok).toBe(true);

    const rows = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-bot@docket.local"));
    expect(rows).toHaveLength(0);
  });

  it("captures IP from x-forwarded-for header", async (ctx) => {
    const db = gate(ctx);
    const headers = new Headers({ "x-forwarded-for": "203.0.113.42, 10.0.0.1" });
    const caller = callerFactory({ headers, user: null });
    await caller.marketing.joinWaitlist({ kind: "general", email: "wl-ip@docket.local" });

    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-ip@docket.local"));
    expect(row?.ipAddress).toBe("203.0.113.42");
  });

  it("stores null when x-forwarded-for is malformed (defends against inet cast crash)", async (ctx) => {
    const db = gate(ctx);
    // Without validation, this would attempt to insert "abc" into an
    // `inet` column and Postgres would abort the insert.
    const headers = new Headers({ "x-forwarded-for": "abc-not-an-ip" });
    const caller = callerFactory({ headers, user: null });
    const result = await caller.marketing.joinWaitlist({
      kind: "general",
      email: "wl-bad-ip@docket.local",
    });
    expect(result.ok).toBe(true);

    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-bad-ip@docket.local"));
    expect(row?.ipAddress).toBeNull();
  });

  it("accepts IPv6 addresses", async (ctx) => {
    const db = gate(ctx);
    const headers = new Headers({ "x-forwarded-for": "2001:db8::1" });
    const caller = callerFactory({ headers, user: null });
    await caller.marketing.joinWaitlist({ kind: "general", email: "wl-ipv6@docket.local" });

    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-ipv6@docket.local"));
    expect(row?.ipAddress).toBe("2001:db8::1");
  });

  it("captures UTM params", async (ctx) => {
    const db = gate(ctx);
    await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-utm@docket.local",
      utmSource: "twitter",
      utmMedium: "social",
      utmCampaign: "beta-launch",
    });
    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-utm@docket.local"));
    expect(row?.utmSource).toBe("twitter");
    expect(row?.utmMedium).toBe("social");
    expect(row?.utmCampaign).toBe("beta-launch");
  });

  it("name is optional", async (ctx) => {
    const db = gate(ctx);
    await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-noname@docket.local",
    });
    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-noname@docket.local"));
    expect(row?.name).toBeNull();
  });

  it("stores attorney application with structured details", async (ctx) => {
    const db = gate(ctx);
    const result = await callAnon().marketing.joinWaitlist({
      kind: "attorney",
      email: "wl-att@docket.local",
      name: "Jane Doe",
      source: "apply",
      details: {
        firmName: "Doe Immigration PLLC",
        stateOfAdmission: "New York",
        barNumber: "5551234",
        ailaMember: true,
        yearsPracticing: 8,
        notes: "Focus: O-1A musicians",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.alreadyOnList).toBe(false);

    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-att@docket.local"));
    expect(row?.kind).toBe("attorney");
    expect(row?.name).toBe("Jane Doe");
    expect(row?.source).toBe("apply");
    expect(row?.details).toMatchObject({
      firmName: "Doe Immigration PLLC",
      stateOfAdmission: "New York",
      barNumber: "5551234",
      ailaMember: true,
      yearsPracticing: 8,
      notes: "Focus: O-1A musicians",
    });
  });

  it("attorney funnel rejects missing details", async (ctx) => {
    gate(ctx);
    await expect(
      // @ts-expect-error — deliberately omitting details to confirm Zod
      // catches it at runtime even when the type system also catches it.
      callAnon().marketing.joinWaitlist({
        kind: "attorney",
        email: "wl-att-bad@docket.local",
        name: "X",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("general funnel stores null details", async (ctx) => {
    const db = gate(ctx);
    await callAnon().marketing.joinWaitlist({
      kind: "general",
      email: "wl-gen@docket.local",
    });
    const [row] = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.email, "wl-gen@docket.local"));
    expect(row?.kind).toBe("general");
    expect(row?.details).toBeNull();
  });
});

async function wipe(db: TestDb): Promise<void> {
  await db.execute(
    sql`delete from waitlist_entries where email like 'wl-%@docket.local' or email = 'mixedcase@docket.local' or email like 'wl-att%@docket.local'`,
  );
}
