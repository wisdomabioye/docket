/**
 * Template registry. Maps each `EmailName` to a typed render function so
 * `sendEmail()` resolves the React tree from the discriminated `Email`
 * payload alone — no JSX argument at the call site.
 *
 * Why a registry:
 *   - One import surface for the whole email layer (call sites only
 *     touch `sendEmail`); adding a new template = one map entry, not a
 *     hunt across mutations.
 *   - The `TemplateMap` type is keyed by `EmailName` with per-name prop
 *     types — TS catches a missing or mistyped entry at compile time.
 *   - `renderTemplate(email)` is the only place that bridges
 *     name → component, so swapping a template (HTML rewrite, A/B) is
 *     local to this file.
 */

import type { ReactElement } from "react";
import type {
  EmailName,
  EmailTemplateProps,
  Email,
} from "@/server/services/email/types";

import { SignupWelcome } from "./signup-welcome";
import { CaseBuildStarted } from "./case-build-started";
import { CaseBuildCompleted } from "./case-build-completed";
import { CaseBuildFailed } from "./case-build-failed";
import { CaseArchived } from "./case-archived";
import { OutputApproved } from "./output-approved";
import { PackageReady } from "./package-ready";
import { AdminInvite } from "./admin-invite";

type TemplateMap = {
  [N in EmailName]: (props: EmailTemplateProps[N]) => ReactElement;
};

export const EMAIL_TEMPLATES: TemplateMap = {
  "signup.welcome": SignupWelcome,
  "case.build_started": CaseBuildStarted,
  "case.build_completed": CaseBuildCompleted,
  "case.build_failed": CaseBuildFailed,
  "case.archived": CaseArchived,
  "output.approved": OutputApproved,
  "package.ready": PackageReady,
  "admin.invite": AdminInvite,
};

/** Resolve a typed email payload to a rendered React element. The
 *  per-name function signature in `TemplateMap` keeps this type-safe
 *  even though the discriminated union is collapsed to a single call. */
export function renderTemplate(email: Email): ReactElement {
  // Type assertion is sound: discriminator narrows `email.props` to
  // `EmailTemplateProps[email.name]`, which is exactly what
  // `EMAIL_TEMPLATES[email.name]` accepts. TS can't see the correlation
  // through the indexed access, so the cast is the local escape hatch.
  const render = EMAIL_TEMPLATES[email.name] as (
    props: EmailTemplateProps[EmailName],
  ) => ReactElement;
  return render(email.props);
}

export {
  SignupWelcome,
  CaseBuildStarted,
  CaseBuildCompleted,
  CaseBuildFailed,
  CaseArchived,
  OutputApproved,
  PackageReady,
  AdminInvite,
};
