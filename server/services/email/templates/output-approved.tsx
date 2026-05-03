import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function OutputApproved({
  attorneyName,
  caseLabel,
  outputLabel,
  outputUrl,
}: EmailTemplateProps["output.approved"]): React.ReactElement {
  return (
    <EmailLayout preview={`Approved: ${outputLabel} — ${caseLabel}`}>
      <Greeting name={attorneyName} />
      <Paragraph>
        You approved <strong>{outputLabel}</strong> on{" "}
        <strong>{caseLabel}</strong>.
      </Paragraph>
      <Paragraph>
        This output is now locked into the package. Once every output is
        approved, you can compile and download the filing-ready PDF.
      </Paragraph>
      <Cta href={outputUrl}>View output</Cta>
    </EmailLayout>
  );
}

export default OutputApproved;
