import "server-only";

/**
 * Email service — public API. The single allowed entry point for
 * sending transactional email from a server-side code path (Inngest
 * notification fan-out, tRPC mutation, webhook handler).
 *
 * Why a wrapper instead of importing `postmark` directly at call sites:
 *   1. Type safety — the typed taxonomy in `./types.ts` is enforced
 *      at the wrapper boundary; a typo in the email name is a compile
 *      error, not a misrouted Postmark call.
 *   2. Init-safety — calls before `POSTMARK_API_KEY` is set (dev
 *      without postmark, CI runs) no-op cleanly with a structured
 *      log line. No exception, no Postmark API attempt.
 *   3. Render-once — both HTML and plain-text variants are rendered
 *      from the same React tree. Skipping plain-text dramatically
 *      degrades deliverability (spam filters scan for it); the
 *      service guarantees both ship together.
 *   4. Subject templating — placeholders like `{caseLabel}` in
 *      `EMAIL_SUBJECTS` are interpolated against the message's `props`
 *      so the call site doesn't repeat the subject string.
 *   5. Future swap — if we ever move off Postmark, only this file
 *      changes. Call sites stay put.
 *
 * NOT in scope of this module:
 *   - Idempotency keys / dedup. Inngest's `step.run` provides that
 *     guarantee at the orchestration layer (PM.4); the wrapper
 *     itself is dumb-and-direct.
 *   - Retries. Same reason — the Inngest step's automatic retry
 *     policy covers transient SDK failures. We swallow only fatal
 *     misconfigurations (no API key, no template found).
 */

import type { ReactElement } from "react";
import { render, toPlainText } from "@react-email/render";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { env } from "@/config/env";
import { getPostmarkClient } from "@/server/services/email/postmark-client";
import {
  type EmailName,
  type EmailTemplateProps,
  EMAIL_SUBJECTS,
} from "@/server/services/email/types";

/** Result envelope. `delivered` distinguishes the four terminal states
 *  the wrapper can reach without throwing:
 *    - `sent`         — Postmark accepted; `messageId` set
 *    - `not_configured` — POSTMARK_API_KEY unset (dev / CI no-op)
 *    - `failed`       — Postmark rejected (bad recipient, throttled,
 *                       account suspended); error logged to Sentry,
 *                       NOT re-thrown so the calling Inngest step
 *                       still records its own success/failure.
 *
 *  Inngest functions can branch on `delivered` to decide whether to
 *  schedule a retry (for `failed`) or mark the step done (`sent` /
 *  `not_configured`). */
export type SendEmailResult =
  | { delivered: "sent"; messageId: string }
  | { delivered: "not_configured" }
  | { delivered: "failed"; error: string };

/** Recipient validation — Postmark rejects malformed addresses with a
 *  500 from their API, so we'd rather catch it locally and emit a
 *  clean `failed` envelope. */
const RecipientSchema = z.email();

export type SendEmailArgs<N extends EmailName> = {
  /** Discriminator + props pair — matches the typed taxonomy.
   *  Splitting from `template` lets the call site stay short. */
  email: { name: N; props: EmailTemplateProps[N] };
  /** Recipient email address. Single recipient by design — the only
   *  Phase 1 broadcast email is the admin invite, which is also 1:1. */
  to: string;
  /** Rendered React element for the message body. The component must
   *  accept `props: EmailTemplateProps[N]`; the call site provides
   *  the JSX (`<SignupWelcome {...email.props} />`). PM.3 wires a
   *  template registry that hides this prop from most call sites. */
  template: ReactElement;
};

/** Send one transactional email. Always renders both HTML + plain-text
 *  before reaching Postmark — the plain-text variant is the strongest
 *  spam-filter signal we have outside DKIM/SPF.
 *
 *  Returns the `SendEmailResult` envelope; never throws on Postmark
 *  errors — those route to Sentry + the `failed` envelope so callers
 *  in Inngest jobs decide retry semantics. Re-throws ONLY on
 *  programmer errors (missing template, invalid email name).  */
export async function sendEmail<N extends EmailName>(
  args: SendEmailArgs<N>,
): Promise<SendEmailResult> {
  const client = getPostmarkClient();
  if (!client) {
    // No-op: dev environments + CI runs without Postmark credentials.
    // Logging at info level (not warn) — this is expected on most
    // local runs.
    console.info(
      `[email] POSTMARK_API_KEY unset — skipping send for "${args.email.name}"`,
    );
    return { delivered: "not_configured" };
  }

  // Defensive guard. The env validator's `superRefine` already requires
  // POSTMARK_FROM_EMAIL when POSTMARK_API_KEY is set, so this branch
  // is unreachable in a correctly-configured deploy. We re-check
  // anyway because relying on a cross-file invariant would silently
  // forward `undefined` to Postmark (→ 422) if the validator drifted
  // or was bypassed in dev.
  if (!env.POSTMARK_FROM_EMAIL) {
    return {
      delivered: "failed",
      error: "POSTMARK_FROM_EMAIL unset (env validator should have caught this)",
    };
  }
  const fromEmail = env.POSTMARK_FROM_EMAIL;

  const recipient = RecipientSchema.safeParse(args.to);
  if (!recipient.success) {
    return { delivered: "failed", error: `invalid recipient: ${args.to}` };
  }

  const subject = renderSubject(args.email.name, args.email.props);

  // Render the React tree ONCE to HTML, then derive plain-text from
  // the HTML via `toPlainText`. Functionally identical to calling
  // `render(template, { plainText: true })` — both paths use the
  // same `html-to-text` library internally — at roughly half the
  // React serialization cost. Matches react-email's documented
  // recommended path.
  let htmlBody: string;
  let textBody: string;
  try {
    htmlBody = await render(args.template, { plainText: false });
    textBody = toPlainText(htmlBody);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "email-render", emailName: args.email.name },
    });
    return {
      delivered: "failed",
      error: err instanceof Error ? err.message : "unknown render error",
    };
  }

  try {
    const response = await client.sendEmail({
      From: fromEmail,
      To: recipient.data,
      ...(env.POSTMARK_REPLY_TO ? { ReplyTo: env.POSTMARK_REPLY_TO } : {}),
      Subject: subject,
      HtmlBody: htmlBody,
      TextBody: textBody,
      // Tag = email name. Lets us filter and tally per email kind in
      // the Postmark dashboard without parsing subject lines.
      Tag: args.email.name,
      // Tracking opens is acceptable for transactional mail; tracking
      // links would rewrite every URL in the email body which we
      // don't want (clobbers the URL we just put on the CTA button).
      TrackOpens: true,
      // `MessageStream` defaults to "outbound" which is the right
      // transactional stream. Override only when the spec adds a
      // marketing stream.
    });
    return { delivered: "sent", messageId: response.MessageID };
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "email-send", emailName: args.email.name },
    });
    return {
      delivered: "failed",
      error: err instanceof Error ? err.message : "unknown send error",
    };
  }
}

/** Interpolate `{key}` placeholders in a subject template against the
 *  email's typed props. Missing keys are left as the literal
 *  placeholder rather than throwing — easier to spot in a Postmark
 *  log than a silent runtime error inside an Inngest worker. */
function renderSubject<N extends EmailName>(
  name: N,
  props: EmailTemplateProps[N],
): string {
  const template = EMAIL_SUBJECTS[name];
  // Cast to Record for the substitution loop — `EmailTemplateProps[N]`
  // is shaped per-name, but the substitution itself is uniform on
  // string-valued keys. Non-string props (numbers, dates) are
  // coerced via String().
  const bag = props as unknown as Record<string, unknown>;
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = bag[key];
    if (value === undefined || value === null) return `{${key}}`;
    return String(value);
  });
}

// Re-export the types so call sites have a single import path.
export type { Email, EmailName, EmailTemplateProps } from "@/server/services/email/types";
export { EMAIL_NAMES, EMAIL_SUBJECTS } from "@/server/services/email/types";
