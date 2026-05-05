import "server-only";
import { Page, Text, View } from "@react-pdf/renderer";
import { DISCLAIMER } from "@/lib/computer/disclaimer";
import { styles } from "./styles";
import { DisclaimerFooter } from "./disclaimer";

/**
 * Cover page for per-output AND package PDFs. Title reflects the
 * output type (or "Filing Package" for the bundle).
 *
 * Optional draft signaling (Stage 11 ε):
 *   - `draftBadge`     — short caps badge appended to the title row
 *                        ("DRAFT"). Used when the package contains
 *                        unsigned recommendation-letter templates.
 *   - `pendingNotice`  — bordered block listing what's missing. The
 *                        block is rendered ONLY when provided; cases
 *                        with full signed-letter coverage skip it.
 */

export type CoverPagePendingNotice = {
  headline: string;
  lines: ReadonlyArray<string>;
};

export type CoverPageProps = {
  /** "Personal Statement", "Filing Package", etc. */
  title: string;
  beneficiaryName: string;
  visaType: string;
  attorneyName: string;
  /** ISO-formatted date string. We let the caller format for locale. */
  generatedDateLabel: string;
  /** Optional caps badge after the title (e.g. "DRAFT"). */
  draftBadge?: string;
  /** Optional pending block rendered below the disclaimer box. */
  pendingNotice?: CoverPagePendingNotice;
};

export function CoverPage(props: CoverPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={{ marginTop: 96 }}>
        <Text style={styles.coverTitle}>
          {props.title}
          {props.draftBadge ? (
            <Text style={styles.coverDraftBadge}>{` · ${props.draftBadge}`}</Text>
          ) : null}
        </Text>
        <Text style={styles.coverSubtitle}>
          {props.visaType} — {props.beneficiaryName}
        </Text>
      </View>

      <View style={{ marginTop: 48 }}>
        <Text style={styles.coverField}>
          <Text style={styles.coverFieldLabel}>Beneficiary: </Text>
          {props.beneficiaryName}
        </Text>
        <Text style={styles.coverField}>
          <Text style={styles.coverFieldLabel}>Visa type: </Text>
          {props.visaType}
        </Text>
        <Text style={styles.coverField}>
          <Text style={styles.coverFieldLabel}>Prepared by: </Text>
          {props.attorneyName}
        </Text>
        <Text style={styles.coverField}>
          <Text style={styles.coverFieldLabel}>Generated: </Text>
          {props.generatedDateLabel}
        </Text>
      </View>

      <View style={styles.coverDisclaimerBox}>
        <Text style={[styles.coverField, styles.coverFieldLabel]}>
          IMPORTANT
        </Text>
        <Text style={styles.coverField}>{DISCLAIMER}</Text>
      </View>

      {props.pendingNotice ? (
        <View style={styles.coverPendingBox}>
          <Text style={[styles.coverField, styles.coverFieldLabel]}>
            {props.pendingNotice.headline}
          </Text>
          {props.pendingNotice.lines.map((line, i) => (
            <Text key={i} style={styles.coverField}>
              • {line}
            </Text>
          ))}
        </View>
      ) : null}

      <DisclaimerFooter />
    </Page>
  );
}
