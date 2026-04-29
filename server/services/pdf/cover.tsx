import "server-only";
import { Page, Text, View } from "@react-pdf/renderer";
import { DISCLAIMER } from "@/lib/computer/disclaimer";
import { styles } from "./styles";
import { DisclaimerFooter } from "./disclaimer";

/**
 * Cover page for per-output AND package PDFs. Title reflects the
 * output type (or "Filing Package" for the bundle); the disclaimer
 * box dominates so the recipient sees it before flipping to the body.
 */

export type CoverPageProps = {
  /** "Personal Statement", "Filing Package", etc. */
  title: string;
  beneficiaryName: string;
  visaType: string;
  attorneyName: string;
  /** ISO-formatted date string. We let the caller format for locale. */
  generatedDateLabel: string;
};

export function CoverPage(props: CoverPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <View style={{ marginTop: 96 }}>
        <Text style={styles.coverTitle}>{props.title}</Text>
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

      <DisclaimerFooter />
    </Page>
  );
}
