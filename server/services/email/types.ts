/**
 * Typed email taxonomy. Mirror of the analytics taxonomy
 * (`lib/analytics/events.ts`) — single source of truth for every
 * outbound email's name and template props shape, so call sites
 * cannot misspell a name or pass the wrong props.
 *
 * Naming: `<noun>.<verb_past_tense>` — same convention as analytics
 * events. The name doubles as the Inngest event id (`email/<name>`),
 * the Postmark `Tag` (for filtering in their dashboard), and the
 * file stem of the React Email template under `templates/`.
 *
 * Templates ship in PM.3. This file is the contract.
 */

/** All email names — exhaustive. */
export const EMAIL_NAMES = [
  // Onboarding
  "signup.welcome",
  // Case lifecycle
  "case.build_started",
  "case.build_completed",
  "case.build_failed",
  "case.archived",
  // Output review
  "output.approved",
  // Package
  "package.ready",
  // Admin
  "admin.invite",
] as const;

export type EmailName = (typeof EMAIL_NAMES)[number];

/**
 * Per-template props — what the React component renders against. Keep
 * each prop set minimal (IDs, names, dates) — anything heavier belongs
 * in the destination app, not the email body.
 *
 * PII discipline: emails ARE allowed to carry recipient name and
 * beneficiary name (the recipient's own attorney is the audience and
 * already knows both). DO NOT include document content, extracted_text,
 * or evidence detail — emails forward through SMTP and may end up in
 * non-Docket inboxes (forwards, archives, BCCs).
 */
export type EmailTemplateProps = {
  "signup.welcome": {
    /** Attorney's full name for the greeting. */
    attorneyName: string;
    /** Direct link into the attorney workspace. */
    dashboardUrl: string;
  };
  "case.build_started": {
    attorneyName: string;
    /** Display label like "Maria Gonzalez · O-1A". */
    caseLabel: string;
    /** ETA in minutes (best estimate based on document count + visa type). */
    etaMinutes: number;
    /** Direct link to the case overview page. */
    caseUrl: string;
  };
  "case.build_completed": {
    attorneyName: string;
    caseLabel: string;
    /** Number of outputs the build produced. */
    outputCount: number;
    /** Direct link to the case outputs tab. */
    outputsUrl: string;
  };
  "case.build_failed": {
    attorneyName: string;
    caseLabel: string;
    /** Single human-readable reason from `cases.build_error`. */
    reason: string;
    /** Direct link back to the case for retry. */
    caseUrl: string;
  };
  "case.archived": {
    attorneyName: string;
    caseLabel: string;
    /** ISO timestamp of the archive event. */
    archivedAt: string;
  };
  "output.approved": {
    attorneyName: string;
    caseLabel: string;
    /** Display label of the approved output (e.g. "Personal Statement"). */
    outputLabel: string;
    outputUrl: string;
  };
  "package.ready": {
    attorneyName: string;
    caseLabel: string;
    /** Approved output count included in the package. */
    outputCount: number;
    /** Direct link to download the compiled PDF. */
    packageUrl: string;
  };
  "admin.invite": {
    /** Recipient's display name (or email local-part if name unknown). */
    recipientName: string;
    /** Person who issued the invite — keeps the invite human. */
    invitedBy: string;
    /** Sign-in URL — the gate behind which the invite is consumed. */
    signInUrl: string;
  };
};

/** Discriminated union of every legal email-name + props pair. */
export type Email = {
  [N in EmailName]: { name: N; props: EmailTemplateProps[N] };
}[EmailName];

/** Per-email subject line. Not in the template props because subjects
 *  are always plain strings (no template) and changing one is a
 *  copy-only change that shouldn't require touching the React tree.
 *  Variables in subjects use `{caseLabel}`-style placeholders that the
 *  service replaces at send time using the message's `props`. */
export const EMAIL_SUBJECTS: Record<EmailName, string> = {
  "signup.welcome": "Welcome to Docket",
  "case.build_started": "Your case build has started — {caseLabel}",
  "case.build_completed": "Your draft is ready — {caseLabel}",
  "case.build_failed": "Build needs your attention — {caseLabel}",
  "case.archived": "Case archived — {caseLabel}",
  "output.approved": "Approved: {outputLabel} — {caseLabel}",
  "package.ready": "Filing package ready — {caseLabel}",
  "admin.invite": "You've been invited to Docket",
};
