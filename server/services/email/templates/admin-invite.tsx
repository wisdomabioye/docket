import * as React from "react";
import { Cta, EmailLayout, Greeting, Paragraph } from "./_layout";
import type { EmailTemplateProps } from "@/server/services/email/types";

export function AdminInvite({
  recipientName,
  invitedBy,
  signInUrl,
}: EmailTemplateProps["admin.invite"]): React.ReactElement {
  return (
    <EmailLayout preview="You've been invited to Docket.">
      <Greeting name={recipientName} />
      <Paragraph>
        <strong>{invitedBy}</strong> invited you to Docket.
      </Paragraph>
      <Paragraph>
        Sign in with your Google or Microsoft account using this email address
        and your workspace will activate automatically. No password required.
      </Paragraph>
      <Cta href={signInUrl}>Sign in to Docket</Cta>
      <Paragraph>
        If you weren&rsquo;t expecting this invitation, you can ignore this
        email — no account is created until you sign in.
      </Paragraph>
    </EmailLayout>
  );
}

export default AdminInvite;
