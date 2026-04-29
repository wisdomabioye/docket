import "server-only";
import { Page, Text, View } from "@react-pdf/renderer";
import { styles } from "./styles";
import { DisclaimerFooter } from "./disclaimer";
import { MarkdownRenderer } from "./markdown-renderer";

/**
 * Shared `<Page>` wrapper for all prose output types
 * (personal-statement, petition-letter, recommendation-letter,
 * criteria-analysis, evidence-plan). Each per-type wrapper just sets
 * the running heading and (optionally) a subtitle; the body is
 * rendered identically via `MarkdownRenderer`. Single source of truth
 * — without this, 5 prose templates would re-implement the same
 * `<Page>` + heading + footer scaffolding.
 *
 * Running heading stays at the top of EVERY page (`fixed`) so a
 * 30-page petition letter is browsable. Disclaimer footer lives at
 * the bottom of every page (also fixed). Body content paginates
 * naturally between them.
 */

export type ProsePageProps = {
  /** Shown at the top of every page. */
  runningHeading: string;
  /** Optional subtitle (e.g. "Letter for Dr. Jane Doe" for
   *  recommendation letters). Empty string = no subtitle row. */
  subtitle?: string;
  /** Markdown source to render in the body. */
  content: string;
};

export function ProsePage(props: ProsePageProps) {
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
        <Text style={[styles.h2, { marginBottom: 0 }]}>
          {props.runningHeading}
        </Text>
        {props.subtitle ? (
          <Text style={[styles.coverSubtitle, { marginTop: 2, marginBottom: 0 }]}>
            {props.subtitle}
          </Text>
        ) : null}
      </View>
      <MarkdownRenderer content={props.content} />
      <DisclaimerFooter />
    </Page>
  );
}
