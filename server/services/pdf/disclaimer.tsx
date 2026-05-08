import "server-only";
import { Text } from "@react-pdf/renderer";
import { DISCLAIMER } from "@/lib/computer/disclaimer";
import { styles } from "./styles";

/**
 * AI-disclaimer footer rendered on EVERY PDF page (spec mandate, §17 +
 * Stage 08 locked decision). `fixed` so React-PDF re-renders on each
 * page even when content paginates.
 *
 * open_issues #54 — the page-number `<Text fixed render={...}>` sibling
 * was removed because its layout interacts badly with paginated
 * `MarkdownRenderer` output: on a multi-page page the page-number
 * element's translate matrix gets a corrupted box and pdfkit throws
 * "unsupported number: -1.83…e+21". Disclaimer-only renders cleanly.
 * Restore page numbers via a different mechanism when react-pdf
 * releases a fix (or move the page number to a fixed top-of-page
 * position, which doesn't trigger the bug).
 */

export function DisclaimerFooter() {
  return (
    <Text style={styles.disclaimer} fixed>
      {DISCLAIMER}
    </Text>
  );
}
