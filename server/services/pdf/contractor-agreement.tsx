import "server-only";
import { Document, Page, Text, View } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import { MarkdownRenderer } from "./markdown-renderer";
import { styles } from "./styles";

/**
 * Stage 03b: signed contractor agreement PDF. Rendered once at sign
 * time and persisted for the life of the signature row — never
 * regenerated. The persisted bytes are the legal artifact, so the
 * component is intentionally inert (no current-time stamps, no
 * "latest content" hooks; everything comes from props captured at
 * sign time).
 *
 * The Stage 08 prose pipeline's `ProsePage` is not reused here
 * because its `DisclaimerFooter` is the case-output Computer
 * disclaimer ("AI-generated draft, attorney must review") — wrong
 * context for a contract. We render a leaner page directly.
 */

export type ContractorAgreementPdfProps = {
  /** Markdown body of the agreement (the exact bytes whose sha256
   *  was stored on the signature row). */
  body: string;
  fullLegalName: string;
  documentVersion: string;
  /** Truncated to 16 hex chars on screen — the full hash is on the
   *  DB row and surfaced in admin. */
  contentHash: string;
  signedAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
};

export function ContractorAgreementPdf(
  props: ContractorAgreementPdfProps,
): ReactElement<DocumentProps> {
  return (
    <Document
      title="Docket Contractor Agreement (signed)"
      author="Docket"
      subject={`Contractor agreement ${props.documentVersion} signed by ${props.fullLegalName}`}
    >
      <Page size="LETTER" style={styles.page}>
        <MarkdownRenderer content={props.body} />
        <SignatureBlock {...props} />
      </Page>
    </Document>
  );
}

function SignatureBlock(
  props: ContractorAgreementPdfProps,
): React.ReactElement {
  const signedAtIso = props.signedAt.toISOString();
  const hashShort = `${props.contentHash.slice(0, 16)}…`;
  return (
    <View
      style={{
        marginTop: 24,
        paddingTop: 12,
        borderTopWidth: 0.5,
        borderTopColor: "#888",
      }}
    >
      <Text style={[styles.h4, { marginBottom: 6 }]}>Electronic signature</Text>
      <Field label="Signed by" value={props.fullLegalName} />
      <Field label="Signed at (UTC)" value={signedAtIso} />
      <Field label="Agreement version" value={props.documentVersion} />
      <Field label="Content sha256" value={hashShort} />
      <Field label="IP address" value={props.ipAddress ?? "—"} />
      <Field
        label="User agent"
        value={props.userAgent ?? "—"}
      />
      <Text style={{ marginTop: 8, fontSize: 10, color: "#555" }}>
        Signed under the U.S. Electronic Signatures in Global and National
        Commerce Act (ESIGN) and applicable state e-signature laws.
      </Text>
    </View>
  );
}

function Field(props: { label: string; value: string }): React.ReactElement {
  return (
    <Text style={{ fontSize: 11, marginBottom: 2 }}>
      <Text style={styles.bold}>{props.label}: </Text>
      {props.value}
    </Text>
  );
}
