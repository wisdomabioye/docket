import "server-only";
import { Text } from "@react-pdf/renderer";
import { DISCLAIMER } from "@/lib/computer/disclaimer";
import { styles } from "./styles";

/**
 * AI-disclaimer footer rendered on EVERY PDF page (spec mandate, §17 +
 * Stage 08 locked decision). `fixed` so React-PDF re-renders on each
 * page even when content paginates. Page-number indicator sits next to
 * it; both are positioned absolutely so prose can flow over their
 * usual location without overlap (page padding-bottom in `styles.page`
 * accounts for the footer height).
 */

export function DisclaimerFooter() {
  return (
    <>
      <Text style={styles.disclaimer} fixed>
        {DISCLAIMER}
      </Text>
      <Text
        style={styles.pageNumber}
        fixed
        render={({ pageNumber, totalPages }) =>
          `${pageNumber} / ${totalPages}`
        }
      />
    </>
  );
}
