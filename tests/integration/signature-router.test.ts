// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import {
  auditLog,
  signedDocuments,
  userRoles,
  users,
} from "@/server/db/schema";
import {
  CONTRACTOR_AGREEMENT_HASH,
  CONTRACTOR_AGREEMENT_KIND,
  CONTRACTOR_AGREEMENT_VERSION,
} from "@/server/auth/contractor-agreement";

vi.mock("@/server/auth/config", () => ({
  auth: vi.fn(() => Promise.resolve(null)),
}));

// Mock the heavy PDF render path AND the storage backend so signing
// tests don't run @react-pdf/renderer or write to ./storage. The PDF
// component itself is exercised separately if/when needed; here we
// only need a buffer to flow through.
const renderMock = vi.hoisted(() =>
  vi.fn(async () => Buffer.from("%PDF-fake")),
);
vi.mock("@/server/services/pdf/render", async () => {
  const actual = await vi.importActual<
    typeof import("@/server/services/pdf/render")
  >("@/server/services/pdf/render");
  return { ...actual, renderPdfToBuffer: renderMock };
});

const storagePutMock = vi.hoisted(() => vi.fn(async () => undefined));
const storageSignedUrlMock = vi.hoisted(() =>
  vi.fn(async (key: string) => `/api/files/${encodeURIComponent(key)}?token=t`),
);
vi.mock("@/server/services/storage", () => ({
  storage: {
    put: storagePutMock,
    get: vi.fn(),
    delete: vi.fn(),
    signedUrl: storageSignedUrlMock,
  },
}));

import { createCallerFactory } from "@/server/api/trpc";
import { appRouter } from "@/server/api/root";
import { closeTestDb, getTestDb, rlsRoleExists, type TestDb } from "../helpers/db";

const ATTORNEY = "70000000-0000-4000-8000-aaaa00000001";
const ADMIN = "70000000-0000-4000-8000-bbbb00000001";
const OTHER = "70000000-0000-4000-8000-cccc00000001";

let db: TestDb | null = null;
let rlsReady = false;

const callerFactory = createCallerFactory(appRouter);
const callAs = (userId: string | null, headers: Headers = new Headers()) =>
  callerFactory({
    headers,
    user: userId ? { id: userId } : null,
  });

function gate(ctx: { skip: () => void }): TestDb {
  if (!db || !rlsReady) {
    ctx.skip();
    throw new Error("unreachable");
  }
  return db;
}

beforeAll(async () => {
  db = getTestDb();
  if (!db) return;
  rlsReady = await rlsRoleExists(db);
  if (!rlsReady) return;
  await teardown(db);
  await db.insert(users).values([
    { id: ATTORNEY, name: "Sig Attorney", email: "sig-attorney@docket.local" },
    { id: ADMIN, name: "Sig Admin", email: "sig-admin@docket.local" },
    { id: OTHER, name: "Sig Other", email: "sig-other@docket.local" },
  ]);
  await db.insert(userRoles).values([
    { userId: ATTORNEY, role: "attorney" },
    { userId: ADMIN, role: "admin" },
    { userId: OTHER, role: "attorney" },
  ]);
});

beforeEach(async () => {
  if (!db) return;
  await db
    .delete(signedDocuments)
    .where(
      sql`user_id in (${ATTORNEY}, ${ADMIN}, ${OTHER})`,
    );
  await db.execute(
    sql`delete from audit_log where action = 'signature.signed' and target_type = 'signed_document'`,
  );
  renderMock.mockClear();
  storagePutMock.mockClear();
  storageSignedUrlMock.mockClear();
});

afterAll(async () => {
  if (db) await teardown(db);
  await closeTestDb();
});

describe("signature.signContractorAgreement", () => {
  it("happy path — inserts row, renders PDF, writes audit log", async (ctx) => {
    const db = gate(ctx);
    const headers = new Headers({
      "x-forwarded-for": "203.0.113.42",
      "user-agent": "Mozilla/5.0 (Test)",
    });

    const result = await callAs(ATTORNEY, headers).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Jane Q. Doe",
      intentAcknowledged: true,
    });
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);

    const [row] = await db
      .select()
      .from(signedDocuments)
      .where(eq(signedDocuments.id, result.id));
    expect(row?.userId).toBe(ATTORNEY);
    expect(row?.documentKind).toBe(CONTRACTOR_AGREEMENT_KIND);
    expect(row?.documentVersion).toBe(CONTRACTOR_AGREEMENT_VERSION);
    expect(row?.contentHash).toBe(CONTRACTOR_AGREEMENT_HASH);
    expect(row?.fullLegalName).toBe("Jane Q. Doe");
    expect(row?.ipAddress).toBe("203.0.113.42");
    expect(row?.userAgent).toBe("Mozilla/5.0 (Test)");
    expect(row?.renderedPdfPath).toBe(
      `users/${ATTORNEY}/signatures/${result.id}.pdf`,
    );

    expect(renderMock).toHaveBeenCalledTimes(1);
    expect(storagePutMock).toHaveBeenCalledTimes(1);

    const audit = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, "signature.signed"),
          eq(auditLog.targetId, result.id),
        ),
      );
    expect(audit.length).toBe(1);
    expect(audit[0]?.actorUserId).toBe(ATTORNEY);
  });

  it("idempotent — second call returns same id, no second PDF render", async (ctx) => {
    const db = gate(ctx);
    const first = await callAs(ATTORNEY).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Jane Doe",
      intentAcknowledged: true,
    });
    const second = await callAs(ATTORNEY).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Different Name",
      intentAcknowledged: true,
    });
    expect(second.id).toBe(first.id);
    expect(renderMock).toHaveBeenCalledTimes(1);

    const rows = await db
      .select()
      .from(signedDocuments)
      .where(eq(signedDocuments.userId, ATTORNEY));
    expect(rows.length).toBe(1);
    // Original typed name preserved (idempotency means later calls
    // are no-ops, not overwrites).
    expect(rows[0]?.fullLegalName).toBe("Jane Doe");
  });

  it("rejects mismatched documentVersion at the boundary", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).signature.signContractorAgreement({
        documentVersion: "v0" as typeof CONTRACTOR_AGREEMENT_VERSION,
        contentHash: CONTRACTOR_AGREEMENT_HASH,
        fullLegalName: "Jane Doe",
        intentAcknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects mismatched contentHash at the boundary", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).signature.signContractorAgreement({
        documentVersion: CONTRACTOR_AGREEMENT_VERSION,
        // Same hex shape, wrong value.
        contentHash: "0".repeat(64) as typeof CONTRACTOR_AGREEMENT_HASH,
        fullLegalName: "Jane Doe",
        intentAcknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("UNAUTHORIZED when no session", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(null).signature.signContractorAgreement({
        documentVersion: CONTRACTOR_AGREEMENT_VERSION,
        contentHash: CONTRACTOR_AGREEMENT_HASH,
        fullLegalName: "Jane Doe",
        intentAcknowledged: true,
      }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("signature.getDownloadUrl", () => {
  it("owner can fetch a fresh signed URL", async (ctx) => {
    gate(ctx);
    const sig = await callAs(ATTORNEY).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Jane Doe",
      intentAcknowledged: true,
    });
    const result = await callAs(ATTORNEY).signature.getDownloadUrl({
      id: sig.id,
    });
    expect(result.url).toContain("/api/files/");
    expect(result.expiresInSeconds).toBe(300);
  });

  it("admin can fetch any signature's URL", async (ctx) => {
    gate(ctx);
    const sig = await callAs(ATTORNEY).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Jane Doe",
      intentAcknowledged: true,
    });
    const result = await callAs(ADMIN).signature.getDownloadUrl({ id: sig.id });
    expect(result.url).toContain("/api/files/");
  });

  it("non-owner non-admin gets FORBIDDEN", async (ctx) => {
    gate(ctx);
    const sig = await callAs(ATTORNEY).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Jane Doe",
      intentAcknowledged: true,
    });
    await expect(
      callAs(OTHER).signature.getDownloadUrl({ id: sig.id }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("NOT_FOUND for a non-existent id", async (ctx) => {
    gate(ctx);
    await expect(
      callAs(ATTORNEY).signature.getDownloadUrl({
        id: "70000000-0000-4000-8000-9999ffffffff",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("signature.getMyContractorSignature", () => {
  it("returns null when nothing signed", async (ctx) => {
    gate(ctx);
    const result = await callAs(ATTORNEY).signature.getMyContractorSignature();
    expect(result).toBeNull();
  });

  it("returns the active row after signing", async (ctx) => {
    gate(ctx);
    const sig = await callAs(ATTORNEY).signature.signContractorAgreement({
      documentVersion: CONTRACTOR_AGREEMENT_VERSION,
      contentHash: CONTRACTOR_AGREEMENT_HASH,
      fullLegalName: "Jane Doe",
      intentAcknowledged: true,
    });
    const result = await callAs(ATTORNEY).signature.getMyContractorSignature();
    expect(result?.id).toBe(sig.id);
    expect(result?.fullLegalName).toBe("Jane Doe");
  });
});

async function teardown(db: TestDb): Promise<void> {
  await db.execute(
    sql`delete from audit_log where target_id in (
      select id from signed_documents where user_id in (${ATTORNEY}, ${ADMIN}, ${OTHER})
    )`,
  );
  await db.execute(
    sql`delete from signed_documents where user_id in (${ATTORNEY}, ${ADMIN}, ${OTHER})`,
  );
  await db.execute(
    sql`delete from user_roles where user_id in (${ATTORNEY}, ${ADMIN}, ${OTHER})`,
  );
  await db.execute(
    sql`delete from users where id in (${ATTORNEY}, ${ADMIN}, ${OTHER})`,
  );
}
