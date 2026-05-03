import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function CaseBuildCompleted({
  attorneyName,
  caseLabel,
  outputCount,
  outputsUrl,
}: EmailTemplateProps["case.build_completed"]): React.ReactElement {
  return (
    <EmailLayout preview={`Your draft is ready — ${caseLabel}`}>
      <Greeting name={attorneyName} />
      <Paragraph>
        The draft for <strong>{caseLabel}</strong> is ready for your review —{" "}
        {outputCount} {outputCount === 1 ? "output" : "outputs"} produced.
      </Paragraph>
      <Paragraph>
        Review each output, edit where you need to, and approve when it&rsquo;s
        filing-ready. You can compile the package as soon as every output is
        approved.
      </Paragraph>
      <Cta href={outputsUrl}>Review outputs</Cta>
    </EmailLayout>
  );
}

export default CaseBuildCompleted;
