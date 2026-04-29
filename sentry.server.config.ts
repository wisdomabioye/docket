// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent } from "@/lib/sentry-scrub";

Sentry.init({
  dsn: "https://fdcdcd12a17589c23f53804932a41c2d@o4509884645244928.ingest.us.sentry.io/4511298971500544",

  // Define how likely traces are sampled. Adjust this value in production, or use tracesSampler for greater control.
  tracesSampleRate: 1,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // PII scrubbing — spec §17 requires us to redact `email`, `full_name`,
  // `beneficiary_name`, `extracted_text`, `content` before any event
  // reaches Sentry. `sendDefaultPii: false` keeps Sentry's auto-collected
  // user-identifying fields (cookies, IP) out by default; the `beforeSend`
  // / `beforeBreadcrumb` hooks scrub the explicit-allow keys we DO accept.
  sendDefaultPii: false,
  beforeSend: scrubEvent,
  beforeBreadcrumb: scrubBreadcrumb,
});
