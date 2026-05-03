import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function CaseBuildStarted({
  attorneyName,
  caseLabel,
  etaMinutes,
  caseUrl,
}: EmailTemplateProps["case.build_started"]): React.ReactElement {
  return (
    <EmailLayout preview={`Your case build has started — ${caseLabel}`}>
      <Greeting name={attorneyName} />
      <Paragraph>
        We&rsquo;ve started drafting <strong>{caseLabel}</strong>. Estimated
        time to first draft: about {etaMinutes} {etaMinutes === 1 ? "minute" : "minutes"}.
      </Paragraph>
      <Paragraph>
        You&rsquo;ll get another email when the draft is ready for your review.
        No action needed in the meantime.
      </Paragraph>
      <Cta href={caseUrl}>View case</Cta>
    </EmailLayout>
  );
}

export default CaseBuildStarted;
