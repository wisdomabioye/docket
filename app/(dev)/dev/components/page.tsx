import { notFound } from "next/navigation";
import {
  Badge,
  Card,
  EmptyState,
  Icon,
  ProgressBar,
} from "@/components/ui";
import { KpiCard, KpiGrid } from "@/components/kpi";
import { AppPageHeader } from "@/components/layout";
import { FormField } from "@/components/form";
import { PendingApprovalCard } from "@/components/onboarding";

/**
 * Stage 00b/00c storybook — single-page visual catalog for every
 * primitive + extracted layout/form/domain composite. Gated behind
 * `NODE_ENV !== 'production'` so it never ships to prod.
 *
 * Append a `<Section>` whenever a new component lands. Each section
 * documents its source mockup so a reader can compare side-by-side.
 *
 * Not interactive (server component). For client-state primitives
 * (Tiptap editor, SuspendButton, RevenuePanel, AdminInvoicePanel),
 * each component's own unit-test renders the interactive surface.
 */

export const metadata = { title: "Components — Dev" };

export default function DevComponentsPage(): React.ReactElement {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  return (
    <main
      className="mx-auto max-w-5xl px-6 py-12 space-y-12"
      style={{ background: "var(--bg, var(--color-cream))" }}
    >
      <AppPageHeader
        eyebrow="Storybook"
        title="Component library"
        subtitle="Visual QA. Mockup → React mapping per Stage 00c."
      />

      <Section title="ui/Badge" mockup="audit / attorney rows">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="neutral">Neutral</Badge>
          <Badge variant="accent">Accent</Badge>
          <Badge variant="success">Success</Badge>
          <Badge variant="warning">Warning</Badge>
          <Badge variant="error">Error</Badge>
          <Badge variant="info">Info</Badge>
          <Badge variant="neutral" mono>
            mono-tag
          </Badge>
        </div>
      </Section>

      <Section title="ui/Card" mockup="every list / panel">
        <Card title="Recent activity" meta="14 events">
          <p className="text-sm" style={{ color: "var(--ink-soft)" }}>
            Card body slot. Wrap any list, table, or paragraph here.
          </p>
        </Card>
      </Section>

      <Section title="ui/EmptyState" mockup="empty admin tables">
        <EmptyState
          title="Nothing to show yet."
          subtitle="Empty-state copy lives at the call site, not in the primitive."
        />
      </Section>

      <Section title="ui/ProgressBar" mockup="case strength bars">
        <div className="space-y-3">
          <ProgressBar value={32} />
          <ProgressBar value={68} tone="warning" />
          <ProgressBar value={94} tone="success" />
        </div>
      </Section>

      <Section title="ui/Icon (Lucide wrapper)" mockup="every icon usage">
        <div className="flex flex-wrap items-center gap-3">
          <Icon name="check" />
          <Icon name="cpu" />
          <Icon name="file-text" />
          <Icon name="external-link" />
          <Icon name="trending-up" />
          <Icon name="trending-down" />
        </div>
      </Section>

      <Section title="kpi/KpiGrid + KpiCard" mockup="admin dashboard">
        <KpiGrid cols={3}>
          <KpiCard label="Gross · QTD" value="$94,200" sub="12 filings" />
          <KpiCard
            label="Docket · QTD"
            value="$14,130"
            sub="15% of gross"
            delta={{ text: "+18.4%", direction: "up" }}
          />
          <KpiCard
            label="Awaiting first filing"
            value="—"
            dim
            sub="No revenue yet"
          />
        </KpiGrid>
      </Section>

      <Section title="form/FormField" mockup="onboarding / settings">
        <div className="max-w-md space-y-4">
          <FormField
            id="sb-bar-number"
            label="Bar number"
            hint="State + 6 digits"
          >
            <input
              id="sb-bar-number"
              className="w-full rounded-md border border-[var(--color-ink)]/20 px-3 py-2 text-sm"
              placeholder="NY-000000"
            />
          </FormField>
          <FormField
            id="sb-bar-number-err"
            label="Bar number"
            error="Required"
            required
          >
            <input
              id="sb-bar-number-err"
              className="w-full rounded-md border border-[var(--color-ink)]/20 px-3 py-2 text-sm"
            />
          </FormField>
        </div>
      </Section>

      <Section
        title="form/SsoButton (interactive — see /login)"
        mockup="login.html"
      >
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          Renders a server-action provider button. Visit <code>/login</code>{" "}
          for the live composition; static preview omitted because the
          form action invokes Auth.js.
        </p>
      </Section>

      <Section title="layout/AuthShell" mockup="login.html">
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>
          Centered card layout used by every <code>(auth)</code> route.
          Full preview at <code>/login</code>.
        </p>
      </Section>

      <Section title="layout/AppPageHeader" mockup="dashboard.html / settings.html">
        <p
          className="mb-3 text-xs"
          style={{ color: "var(--ink-muted)" }}
        >
          Composed above. Variations:
        </p>
        <AppPageHeader title="Just a title" />
        <div className="h-4" />
        <AppPageHeader
          eyebrow="Subsection"
          title="Eyebrow + title + subtitle"
          subtitle="With a description line under the heading."
        />
      </Section>

      <Section title="onboarding/PendingApprovalCard" mockup="dashboard-pending.html">
        <PendingApprovalCard
          email="attorney@example.com"
          submittedAt={new Date("2026-04-29T15:00:00Z")}
        />
      </Section>
    </main>
  );
}

function Section(props: {
  title: string;
  mockup?: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <section className="space-y-3 border-t border-[var(--color-ink)]/10 pt-8 first:border-0 first:pt-0">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-sm">{props.title}</h2>
        {props.mockup ? (
          <span
            className="font-mono text-[10px] uppercase tracking-wider"
            style={{ color: "var(--ink-muted)" }}
          >
            {props.mockup}
          </span>
        ) : null}
      </header>
      <div>{props.children}</div>
    </section>
  );
}
