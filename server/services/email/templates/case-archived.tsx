import * as React from "react";
import { EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function CaseArchived({
  attorneyName,
  caseLabel,
  archivedAt,
}: EmailTemplateProps["case.archived"]): React.ReactElement {
  const archivedDate = formatDate(archivedAt);
  return (
    <EmailLayout preview={`Case archived — ${caseLabel}`}>
      <Greeting name={attorneyName} />
      <Paragraph>
        <strong>{caseLabel}</strong> was archived on {archivedDate}.
      </Paragraph>
      <Paragraph>
        Archived cases are read-only but remain available in your workspace for
        reference. You can restore the case at any time from the case list.
      </Paragraph>
      <Paragraph>
        If this was unintentional, restore it now and the case returns to its
        last active state.
      </Paragraph>
    </EmailLayout>
  );
}

// ISO timestamp → "May 3, 2026". Date-fns isn't loaded in templates to
// keep the rendered tree dependency-free; the formatter is small enough
// to inline. Falls back to the raw input if parsing fails so a clock
// skew doesn't crash the email.
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default CaseArchived;
