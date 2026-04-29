import "server-only";
import { Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { DisclaimerFooter } from "./disclaimer";
import { MarkdownRenderer } from "./markdown-renderer";

/**
 * Exhibit-index page. The Stage 07 evidence-plan / exhibit-index
 * sub-functions emit JSON-mode output (parsed via Zod), but we don't
 * commit the schema for the exhibit table here — Stage 08 spec defers
 * that to Stage 11 polish. For now we render the raw markdown the
 * model produced via `MarkdownRenderer` so a textual exhibit list
 * still flows; if the content happens to start with a JSON object,
 * the renderer falls through to plain-text fallback gracefully.
 *
 * `metadataExhibitCount` (from `OutputMetadata.exhibit_index`) is
 * stamped in the header for at-a-glance count.
 */

export type ExhibitIndexPageProps = {
  beneficiaryName: string;
  visaType: string;
  /** Markdown the exhibit-index generator produced. May contain a
   *  table; the markdown-renderer handles tables via plain-text
   *  fallback (we don't render `<table>` in PDFs by Stage 08 scope). */
  content: string;
  exhibitCount: number | null;
};

export function ExhibitIndexPage(props: ExhibitIndexPageProps) {
  return (
    <Page size="LETTER" style={styles.page}>
      <View
        fixed
        style={{
          marginBottom: 12,
          paddingBottom: 6,
          borderBottomWidth: 0.5,
          borderBottomColor: "#ccc",
        }}
      >
        <Text style={[styles.h2, { marginBottom: 0 }]}>Exhibit Index</Text>
        <Text style={[styles.coverSubtitle, { marginTop: 2, marginBottom: 0 }]}>
          {props.visaType} — {props.beneficiaryName}
          {props.exhibitCount !== null
            ? ` — ${props.exhibitCount} exhibit${props.exhibitCount === 1 ? "" : "s"}`
            : ""}
        </Text>
      </View>
      <MarkdownRenderer content={props.content} />
      <DisclaimerFooter />
    </Page>
  );
}
