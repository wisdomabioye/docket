import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function PackageReady({
  attorneyName,
  caseLabel,
  outputCount,
  packageUrl,
}: EmailTemplateProps["package.ready"]): React.ReactElement {
  return (
    <EmailLayout preview={`Filing package ready — ${caseLabel}`}>
      <Greeting name={attorneyName} />
      <Paragraph>
        The filing package for <strong>{caseLabel}</strong> is compiled and
        ready to download — {outputCount} approved{" "}
        {outputCount === 1 ? "output" : "outputs"} included.
      </Paragraph>
      <Paragraph>
        Download the PDF, do your final review, and file with USCIS when ready.
      </Paragraph>
      <Cta href={packageUrl}>Download package</Cta>
    </EmailLayout>
  );
}

export default PackageReady;
