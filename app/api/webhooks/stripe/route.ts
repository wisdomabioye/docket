import "server-only";
import { headers } from "next/headers";
import type Stripe from "stripe";
import { env } from "@/config/env";
import { db } from "@/server/db/client";
import {
  getStripe,
  markInvoiceFailed,
  markInvoicePaid,
  markInvoiceVoided,
} from "@/server/services/stripe";

/**
 * Stage 10 Stripe webhook. Stripe POSTs invoice lifecycle events here;
 * the handler verifies the signature, dispatches by `event.type`, and
 * returns 200 even when the event isn't one we listen for (so Stripe
 * doesn't retry indefinitely).
 *
 * Security: signature verification via `stripe.webhooks.constructEvent`
 * is mandatory. Missing/invalid signature → 400 (Stripe interprets as
 * a delivery failure and retries — eventually backs off). Both the
 * signature header AND the secret must be present.
 *
 * Idempotency: every dispatch is no-op-on-duplicate. Stripe retries on
 * 5xx and may legitimately deliver the same event id twice; the
 * service-layer state checks (`if status === target → no-op`) prevent
 * double-state-changes.
 *
 * Public route: `proxy.ts` excludes `/api/webhooks` from auth gating.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!env.STRIPE_WEBHOOK_SECRET) {
    // Configuration error — better to fail loud than to silently 200.
    // 503 (not 500) signals "this endpoint is intentionally not
    // configured for inbound webhooks", and Stripe will retry.
    return new Response("stripe webhook not configured", { status: 503 });
  }
  const sig = (await headers()).get("stripe-signature");
  if (!sig) {
    return new Response("missing stripe-signature header", { status: 400 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(
      rawBody,
      sig,
      env.STRIPE_WEBHOOK_SECRET,
    );
  } catch (err) {
    // Bad signature → Stripe will retry (with backoff). Don't log
    // the body (may contain card data even though Stripe doesn't send
    // raw PANs in invoice events — defense in depth).
    console.warn("[stripe-webhook] invalid signature", {
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response("invalid signature", { status: 400 });
  }

  try {
    await dispatch(event);
    return new Response("ok", { status: 200 });
  } catch (err) {
    // Service-layer failure — return 5xx so Stripe retries. Log the
    // event id (NOT the body) so we can correlate in Sentry.
    console.error("[stripe-webhook] dispatch failed", {
      eventId: event.id,
      eventType: event.type,
      message: err instanceof Error ? err.message : String(err),
    });
    return new Response("dispatch failed", { status: 500 });
  }
}

async function dispatch(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "invoice.paid": {
      const inv = event.data.object as Stripe.Invoice;
      if (!inv.id) return;
      await markInvoicePaid({ db, stripeInvoiceId: inv.id });
      return;
    }
    case "invoice.payment_failed": {
      const inv = event.data.object as Stripe.Invoice;
      if (!inv.id) return;
      const reason =
        inv.last_finalization_error?.message ??
        "payment_failed (no error message from Stripe)";
      await markInvoiceFailed({
        db,
        stripeInvoiceId: inv.id,
        reason,
      });
      return;
    }
    case "invoice.voided": {
      const inv = event.data.object as Stripe.Invoice;
      if (!inv.id) return;
      await markInvoiceVoided({ db, stripeInvoiceId: inv.id });
      return;
    }
    // All other event types are intentional no-ops. Returning 200
    // tells Stripe "received" so the delivery is checked off.
    default:
      return;
  }
}
