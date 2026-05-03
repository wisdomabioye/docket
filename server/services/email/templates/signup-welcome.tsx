import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function SignupWelcome({
  attorneyName,
  dashboardUrl,
}: EmailTemplateProps["signup.welcome"]): React.ReactElement {
  return (
    <EmailLayout preview="Welcome to Docket — your workspace is ready.">
      <Greeting name={attorneyName} />
      <Paragraph>
        Welcome to Docket. Your workspace is set up and ready for your first case.
      </Paragraph>
      <Paragraph>
        Start by creating a case for a beneficiary, upload their evidence, and
        request a draft package. We&rsquo;ll do the heavy drafting; you keep
        editorial control end-to-end.
      </Paragraph>
      <Cta href={dashboardUrl}>Open your workspace</Cta>
      <Paragraph>
        If you have any questions about getting started, just reply to this
        email.
      </Paragraph>
    </EmailLayout>
  );
}

export default SignupWelcome;
