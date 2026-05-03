import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function CaseBuildFailed({
  attorneyName,
  caseLabel,
  reason,
  caseUrl,
}: EmailTemplateProps["case.build_failed"]): React.ReactElement {
  return (
    <EmailLayout preview={`Build needs your attention — ${caseLabel}`}>
      <Greeting name={attorneyName} />
      <Paragraph>
        The build for <strong>{caseLabel}</strong> didn&rsquo;t complete.
      </Paragraph>
      <Paragraph>
        Reason: {reason}
      </Paragraph>
      <Paragraph>
        Open the case to retry or adjust the inputs. Most builds succeed on a
        retry once the cause is resolved.
      </Paragraph>
      <Cta href={caseUrl}>Open case</Cta>
    </EmailLayout>
  );
}

export default CaseBuildFailed;
