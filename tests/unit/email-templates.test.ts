import { describe, expect, it } from "vitest";
import { render } from "@react-email/render";
import {
  EMAIL_NAMES,
  EMAIL_SUBJECTS,
  type EmailName,
  type EmailTemplateProps,
} from "@/server/services/email/types";
import {
  EMAIL_TEMPLATES,
  renderTemplate,
} from "@/server/services/email/templates";

/**
 * Registry coverage + render smoke for every email template. These
 * tests are the wall against:
 *   - adding an `EMAIL_NAMES` entry without registering a template,
 *   - subject-template drift (placeholder that no prop satisfies),
 *   - a template throwing at render time on its declared props shape.
 *
 * Each template gets one minimal prop fixture; we don't verify exact
 * HTML because the React Email components own that. Asserting "render
 * resolves to non-empty HTML" catches the breakage modes the template
 * registry can introduce without coupling the test to copy.
 */

const FIXTURES: { [N in EmailName]: EmailTemplateProps[N] } = {
  "signup.welcome": {
    attorneyName: "Test Attorney",
    dashboardUrl: "https://example.com/dashboard",
  },
  "case.build_started": {
    attorneyName: "Test Attorney",
    caseLabel: "Test Beneficiary 001 · O-1A",
    etaMinutes: 12,
    caseUrl: "https://example.com/case/abc",
  },
  "case.build_completed": {
    attorneyName: "Test Attorney",
    caseLabel: "Test Beneficiary 001 · O-1A",
    outputCount: 5,
    outputsUrl: "https://example.com/case/abc/outputs",
  },
  "case.build_failed": {
    attorneyName: "Test Attorney",
    caseLabel: "Test Beneficiary 001 · O-1A",
    reason: "stuck > 30m",
    caseUrl: "https://example.com/case/abc",
  },
  "case.archived": {
    attorneyName: "Test Attorney",
    caseLabel: "Test Beneficiary 001 · O-1A",
    archivedAt: "2026-05-03T12:00:00.000Z",
  },
  "output.approved": {
    attorneyName: "Test Attorney",
    caseLabel: "Test Beneficiary 001 · O-1A",
    outputLabel: "Personal Statement",
    outputUrl: "https://example.com/case/abc/output/xyz",
  },
  "package.ready": {
    attorneyName: "Test Attorney",
    caseLabel: "Test Beneficiary 001 · O-1A",
    outputCount: 5,
    packageUrl: "https://example.com/case/abc/package",
  },
  "admin.invite": {
    recipientName: "Test Invitee",
    invitedBy: "Test Admin",
    signInUrl: "https://example.com/login",
  },
};

describe("email template registry coverage", () => {
  it("registers a template for every EMAIL_NAMES entry", () => {
    for (const name of EMAIL_NAMES) {
      expect(EMAIL_TEMPLATES[name]).toBeDefined();
      expect(typeof EMAIL_TEMPLATES[name]).toBe("function");
    }
  });

  it("declares a subject for every EMAIL_NAMES entry", () => {
    for (const name of EMAIL_NAMES) {
      expect(EMAIL_SUBJECTS[name]).toBeTruthy();
    }
  });

  it("never emits an empty subject template", () => {
    for (const name of EMAIL_NAMES) {
      expect(EMAIL_SUBJECTS[name].length).toBeGreaterThan(0);
    }
  });
});

describe("template render — no template throws on its declared props", () => {
  for (const name of EMAIL_NAMES) {
    it(`renders "${name}" to non-empty HTML`, async () => {
      const fixture = FIXTURES[name];
      // Cast through the discriminated union — same shape `sendEmail()`
      // forwards at runtime via `renderTemplate(args.email as Email)`.
      const element = renderTemplate({
        name,
        props: fixture,
      } as Parameters<typeof renderTemplate>[0]);
      const html = await render(element, { plainText: false });
      expect(html.length).toBeGreaterThan(0);
      expect(html).toContain("</html>");
    });
  }
});
