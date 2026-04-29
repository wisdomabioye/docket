// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stage 10 Stripe webhook handler — unit tests for the request-shape
 * gates: signature verification, dispatch by event type, idempotency
 * (relayed via the markInvoice* service helpers being called once).
 *
 * The DB layer is mocked here; the markInvoice* helpers' own
 * idempotency is exercised by an integration test elsewhere.
 */

const constructEventMock = vi.hoisted(() => vi.fn());
const markPaidMock = vi.hoisted(() => vi.fn(async () => undefined));
const markFailedMock = vi.hoisted(() => vi.fn(async () => undefined));
const markVoidedMock = vi.hoisted(() => vi.fn(async () => undefined));
const headersGetMock = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => ({ get: headersGetMock })),
}));

vi.mock("@/config/env", () => ({
  env: {
    STRIPE_WEBHOOK_SECRET: "whsec_test",
    STRIPE_SECRET_KEY: "sk_test",
  },
}));

vi.mock("@/server/db/client", () => ({
  db: {} as unknown,
}));

vi.mock("@/server/services/stripe", () => ({
  getStripe: () => ({
    webhooks: { constructEvent: constructEventMock },
  }),
  markInvoicePaid: markPaidMock,
  markInvoiceFailed: markFailedMock,
  markInvoiceVoided: markVoidedMock,
}));

import { POST } from "@/app/api/webhooks/stripe/route";

afterEach(() => {
  constructEventMock.mockReset();
  markPaidMock.mockReset();
  markFailedMock.mockReset();
  markVoidedMock.mockReset();
  headersGetMock.mockReset();
});

beforeEach(() => {
  headersGetMock.mockReturnValue("t=123,v1=abc"); // present by default
});

function makeReq(body: string): Request {
  return new Request("http://localhost/api/webhooks/stripe", {
    method: "POST",
    body,
  });
}

describe("Stripe webhook — pre-flight gates", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    headersGetMock.mockReturnValue(null);
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/missing stripe-signature/i);
  });

  it("returns 400 when constructEvent throws (bad signature)", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/invalid signature/i);
    expect(markPaidMock).not.toHaveBeenCalled();
  });
});

describe("Stripe webhook — dispatch", () => {
  it("invoice.paid → calls markInvoicePaid + returns 200", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_1",
      type: "invoice.paid",
      data: { object: { id: "in_1" } },
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(200);
    expect(markPaidMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeInvoiceId: "in_1" }),
    );
  });

  it("invoice.payment_failed → calls markInvoiceFailed with the SDK reason", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_2",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_2",
          last_finalization_error: { message: "card_declined" },
        },
      },
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(200);
    expect(markFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stripeInvoiceId: "in_2",
        reason: "card_declined",
      }),
    );
  });

  it("invoice.payment_failed without finalization_error → falls back to placeholder reason", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_3",
      type: "invoice.payment_failed",
      data: { object: { id: "in_3" } },
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(200);
    expect(markFailedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: expect.stringContaining("payment_failed"),
      }),
    );
  });

  it("invoice.voided → calls markInvoiceVoided + returns 200", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_4",
      type: "invoice.voided",
      data: { object: { id: "in_4" } },
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(200);
    expect(markVoidedMock).toHaveBeenCalledWith(
      expect.objectContaining({ stripeInvoiceId: "in_4" }),
    );
  });

  it("unknown event type → 200 with no service call (Stripe checks delivery off)", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_5",
      type: "customer.subscription.updated",
      data: { object: { id: "sub_1" } },
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(200);
    expect(markPaidMock).not.toHaveBeenCalled();
    expect(markFailedMock).not.toHaveBeenCalled();
    expect(markVoidedMock).not.toHaveBeenCalled();
  });

  it("event missing invoice.id → 200, no service call (Stripe rare malformed)", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_6",
      type: "invoice.paid",
      data: { object: {} },
    });
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(200);
    expect(markPaidMock).not.toHaveBeenCalled();
  });

  it("dispatch throws → 500 so Stripe retries", async () => {
    constructEventMock.mockReturnValue({
      id: "evt_7",
      type: "invoice.paid",
      data: { object: { id: "in_7" } },
    });
    markPaidMock.mockRejectedValueOnce(new Error("DB unreachable"));
    const res = await POST(makeReq("{}"));
    expect(res.status).toBe(500);
  });
});
