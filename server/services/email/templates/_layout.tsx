/**
 * Shared email shell. Every template renders through `<EmailLayout>` so
 * brand chrome (header wordmark, footer, base typography) lives in one
 * place. Inline styles only — every email client strips <style>/<link>
 * tags differently; inline is the only reliable path.
 *
 * No images, no web fonts, no external assets. The brand wordmark is
 * rendered as text so it survives clients that block remote content
 * (Gmail's "show images" gate, corporate gateways) without an alt-text
 * fallback fight. Editorial-serious by design — Phase 1 audience is
 * working attorneys, not consumers.
 */

import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { APP_INFO } from "@/config/app.config";

// Forest green accent locked in CLAUDE.md §10 / open-decision #4.
const COLOR = {
  ink: "#111111",
  body: "#333333",
  muted: "#6B6B6B",
  rule: "#E5E5E5",
  accent: "#1F3D2F",
  bg: "#FAFAFA",
  card: "#FFFFFF",
} as const;

const FONT_STACK =
  '"Charter", "Georgia", "Cambria", "Times New Roman", Times, serif';

const styles = {
  body: {
    backgroundColor: COLOR.bg,
    margin: 0,
    padding: 0,
    fontFamily: FONT_STACK,
    color: COLOR.body,
  } as const,
  container: {
    width: "100%",
    maxWidth: 560,
    margin: "0 auto",
    padding: "32px 24px",
    backgroundColor: COLOR.card,
  } as const,
  header: {
    paddingBottom: 24,
    borderBottom: `1px solid ${COLOR.rule}`,
  } as const,
  wordmark: {
    margin: 0,
    fontFamily: FONT_STACK,
    fontSize: 20,
    fontWeight: 600,
    color: COLOR.accent,
    letterSpacing: "0.01em",
  } as const,
  content: {
    padding: "24px 0",
  } as const,
  paragraph: {
    margin: "0 0 16px",
    fontSize: 16,
    lineHeight: 1.55,
    color: COLOR.body,
  } as const,
  greeting: {
    margin: "0 0 16px",
    fontSize: 16,
    lineHeight: 1.55,
    color: COLOR.ink,
    fontWeight: 600,
  } as const,
  ctaWrap: {
    padding: "8px 0 24px",
  } as const,
  cta: {
    display: "inline-block",
    backgroundColor: COLOR.accent,
    color: "#FFFFFF",
    textDecoration: "none",
    padding: "12px 20px",
    borderRadius: 4,
    fontSize: 15,
    fontWeight: 600,
    fontFamily: FONT_STACK,
  } as const,
  footer: {
    paddingTop: 24,
    borderTop: `1px solid ${COLOR.rule}`,
  } as const,
  footerText: {
    margin: "0 0 6px",
    fontSize: 12,
    lineHeight: 1.5,
    color: COLOR.muted,
  } as const,
  link: {
    color: COLOR.accent,
    textDecoration: "underline",
  } as const,
  hr: {
    border: "none",
    borderTop: `1px solid ${COLOR.rule}`,
    margin: "20px 0",
  } as const,
} as const;

export type EmailLayoutProps = {
  /** Inbox-preview snippet — first ~90 chars of the message. Hidden in
   *  the body but rendered in the inbox list under the subject. Always
   *  set this; without it, clients fall back to the first body line. */
  preview: string;
  children: React.ReactNode;
};

export function EmailLayout({ preview, children }: EmailLayoutProps): React.ReactElement {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Text style={styles.wordmark}>{APP_INFO.displayName}</Text>
          </Section>
          <Section style={styles.content}>{children}</Section>
          <Section style={styles.footer}>
            <Text style={styles.footerText}>
              {APP_INFO.displayName} · {APP_INFO.tagline}
            </Text>
            <Text style={styles.footerText}>
              Questions?{" "}
              <Link href={`mailto:${APP_INFO.supportEmail}`} style={styles.link}>
                {APP_INFO.supportEmail}
              </Link>
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export type GreetingProps = { name: string };

export function Greeting({ name }: GreetingProps): React.ReactElement {
  return <Text style={styles.greeting}>Hi {name},</Text>;
}

export type ParagraphProps = { children: React.ReactNode };

export function Paragraph({ children }: ParagraphProps): React.ReactElement {
  return <Text style={styles.paragraph}>{children}</Text>;
}

export type CtaProps = { href: string; children: React.ReactNode };

export function Cta({ href, children }: CtaProps): React.ReactElement {
  return (
    <Section style={styles.ctaWrap}>
      <Link href={href} style={styles.cta}>
        {children}
      </Link>
    </Section>
  );
}

export function Divider(): React.ReactElement {
  return <Hr style={styles.hr} />;
}

export const emailStyles = styles;
