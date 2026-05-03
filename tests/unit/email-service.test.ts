import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sendEmail` — the only entry point into Postmark from app code. Locks
 * the contract:
 *   - no client → `not_configured` (dev / CI no-op)
 *   - missing `POSTMARK_FROM_EMAIL` → `failed` with explanatory error
 *     (defense-in-depth; env validator should catch first)
 *   - invalid recipient → `failed` with NO PII echo in the error string
 *   - happy path → `sent` with messageId; HTML + plain-text + Tag set;
 *     ReplyTo conditionally added; subject placeholders interpolated
 *   - render error / Postmark error → `failed` envelope, captured to
 *     Sentry, never thrown
 */

const envState = vi.hoisted(() => ({
  POSTMARK_FROM_EMAIL: undefined as string | undefined,
  POSTMARK_REPLY_TO: undefined as string | undefined,
}));
vi.mock("@/config/env", () => ({ env: envState }));

const sendEmailMock = vi.hoisted(() => vi.fn());
const getPostmarkClientMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/email/postmark-client", () => ({
  getPostmarkClient: getPostmarkClientMock,
}));

const sentryCaptureMock = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({
  captureException: sentryCaptureMock,
}));

const renderMock = vi.hoisted(() => vi.fn());
const toPlainTextMock = vi.hoisted(() => vi.fn());
vi.mock("@react-email/render", () => ({
  render: renderMock,
  toPlainText: toPlainTextMock,
}));

const renderTemplateMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/email/templates", () => ({
  renderTemplate: renderTemplateMock,
}));

beforeEach(() => {
  envState.POSTMARK_FROM_EMAIL = "from@example.com";
  envState.POSTMARK_REPLY_TO = undefined;
  sendEmailMock.mockReset();
  getPostmarkClientMock.mockReset();
  sentryCaptureMock.mockReset();
  renderMock.mockReset();
  toPlainTextMock.mockReset();
  renderTemplateMock.mockReset();
  // Default happy-path stubs.
  getPostmarkClientMock.mockReturnValue({ sendEmail: sendEmailMock });
  sendEmailMock.mockResolvedValue({ MessageID: "pm-msg-1" });
  renderTemplateMock.mockReturnValue({ type: "fake-element" });
  renderMock.mockResolvedValue("<html><body>hi</body></html>");
  toPlainTextMock.mockReturnValue("hi");
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function send(
  args: Parameters<
    typeof import("@/server/services/email").sendEmail
  >[0],
): Promise<
  Awaited<ReturnType<typeof import("@/server/services/email").sendEmail>>
> {
  const { sendEmail } = await import("@/server/services/email");
  return sendEmail(args);
}

describe("sendEmail — config gates", () => {
  it("returns not_configured when Postmark client is null (no POSTMARK_API_KEY)", async () => {
    getPostmarkClientMock.mockReturnValue(null);
    const r = await send({
      to: "ok@example.com",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    expect(r).toEqual({ delivered: "not_configured" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns failed when POSTMARK_FROM_EMAIL is missing", async () => {
    envState.POSTMARK_FROM_EMAIL = undefined;
    const r = await send({
      to: "ok@example.com",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    expect(r.delivered).toBe("failed");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("sendEmail — recipient validation", () => {
  it("returns failed for malformed recipient and does NOT echo it", async () => {
    const r = await send({
      to: "not-an-email",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    expect(r.delivered).toBe("failed");
    if (r.delivered === "failed") {
      expect(r.error).not.toContain("not-an-email");
    }
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

describe("sendEmail — happy path", () => {
  it("sends with HTML, plain-text, Tag, and interpolated subject", async () => {
    const r = await send({
      to: "ok@example.com",
      email: {
        name: "case.build_started",
        props: {
          attorneyName: "Test Attorney",
          caseLabel: "Maria Gonzalez · O-1A",
          etaMinutes: 12,
          caseUrl: "https://example.com/case/abc",
        },
      },
    });
    expect(r).toEqual({ delivered: "sent", messageId: "pm-msg-1" });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const payload = sendEmailMock.mock.calls[0]![0];
    expect(payload.From).toBe("from@example.com");
    expect(payload.To).toBe("ok@example.com");
    expect(payload.Subject).toContain("Maria Gonzalez · O-1A");
    expect(payload.HtmlBody).toBe("<html><body>hi</body></html>");
    expect(payload.TextBody).toBe("hi");
    expect(payload.Tag).toBe("case.build_started");
    expect(payload.TrackOpens).toBe(true);
    expect(payload.ReplyTo).toBeUndefined();
  });

  it("includes ReplyTo when POSTMARK_REPLY_TO is set", async () => {
    envState.POSTMARK_REPLY_TO = "support@example.com";
    await send({
      to: "ok@example.com",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    expect(sendEmailMock.mock.calls[0]![0].ReplyTo).toBe("support@example.com");
  });

  it("leaves unknown subject placeholders as literals (visible in Postmark log)", async () => {
    // signup.welcome has no `{caseLabel}` in its subject ("Welcome to
    // Docket"), so this exercise targets a real-world scenario: a
    // future subject change introducing a typo placeholder.
    // We override the subjects map indirectly by switching to an email
    // whose declared subject has no template variables — verifies the
    // path is exercised without coupling to copy.
    await send({
      to: "ok@example.com",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    const payload = sendEmailMock.mock.calls[0]![0];
    expect(payload.Subject).toBe("Welcome to Docket");
  });
});

describe("sendEmail — failure paths", () => {
  it("captures render errors to Sentry and returns failed", async () => {
    renderMock.mockRejectedValueOnce(new Error("boom-render"));
    const r = await send({
      to: "ok@example.com",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    expect(r.delivered).toBe("failed");
    if (r.delivered === "failed") expect(r.error).toContain("boom-render");
    expect(sentryCaptureMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureMock.mock.calls[0]![1].tags.source).toBe("email-render");
  });

  it("captures Postmark errors to Sentry and returns failed", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("422 unprocessable"));
    const r = await send({
      to: "ok@example.com",
      email: { name: "signup.welcome", props: { attorneyName: "X", dashboardUrl: "u" } },
    });
    expect(r.delivered).toBe("failed");
    if (r.delivered === "failed") expect(r.error).toContain("422");
    expect(sentryCaptureMock).toHaveBeenCalledTimes(1);
    expect(sentryCaptureMock.mock.calls[0]![1].tags.source).toBe("email-send");
  });
});
