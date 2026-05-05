import "server-only";
import { StyleSheet } from "@react-pdf/renderer";

/**
 * Shared PDF styles for Stage 08 templates. Locked decisions:
 *   - Times Roman 12pt body, Helvetica 14pt bold heading (spec §13).
 *   - 1in margins (US Letter convention for petitioning).
 *   - 1.4 line-height for legible prose at 12pt.
 *   - No `Font.register` for custom fonts at module load — the
 *     Times/Helvetica families ship with `@react-pdf/renderer` and we
 *     dodge a license-due-diligence question. Non-Latin scripts get
 *     `Font.register` of Noto Sans on demand via `loadUnicodeFont()`
 *     in `render.ts`.
 */

export const styles = StyleSheet.create({
  page: {
    paddingTop: 72, // 1in
    paddingBottom: 96, // 1in + extra for footer disclaimer
    paddingHorizontal: 72, // 1in
    fontFamily: "Times-Roman",
    fontSize: 12,
    lineHeight: 1.4,
  },
  h1: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    marginBottom: 12,
    marginTop: 12,
  },
  h2: {
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    marginBottom: 10,
    marginTop: 10,
  },
  h3: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    marginBottom: 8,
    marginTop: 8,
  },
  h4: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    marginBottom: 6,
    marginTop: 6,
  },
  paragraph: {
    marginBottom: 8,
  },
  list: {
    marginLeft: 18,
    marginBottom: 8,
  },
  listItem: {
    marginBottom: 4,
  },
  blockquote: {
    marginLeft: 24,
    marginRight: 24,
    marginBottom: 8,
    paddingLeft: 8,
    borderLeftWidth: 2,
    borderLeftColor: "#888",
    fontStyle: "italic",
  },
  link: {
    color: "#1F3D2F", // Forest green accent (Open Decision #4)
    textDecoration: "underline",
  },
  bold: {
    fontFamily: "Times-Bold",
  },
  italic: {
    fontFamily: "Times-Italic",
  },
  superscript: {
    fontSize: 8,
    verticalAlign: "super",
  },
  // Disclaimer footer — fixed-position, every page.
  disclaimer: {
    position: "absolute",
    bottom: 36,
    left: 72,
    right: 72,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#555",
    borderTopWidth: 0.5,
    borderTopColor: "#ccc",
    paddingTop: 6,
    textAlign: "center",
  },
  // Page-number running footer (right of disclaimer).
  pageNumber: {
    position: "absolute",
    bottom: 18,
    left: 0,
    right: 72,
    fontSize: 9,
    fontFamily: "Helvetica",
    color: "#888",
    textAlign: "right",
  },
  // Cover-page styles
  coverTitle: {
    fontFamily: "Times-Roman",
    fontSize: 28,
    marginBottom: 24,
    textAlign: "center",
  },
  coverSubtitle: {
    fontFamily: "Helvetica",
    fontSize: 14,
    marginBottom: 12,
    textAlign: "center",
    color: "#444",
  },
  coverField: {
    fontSize: 12,
    marginBottom: 8,
  },
  coverFieldLabel: {
    fontFamily: "Helvetica-Bold",
  },
  coverDisclaimerBox: {
    marginTop: 48,
    padding: 16,
    borderWidth: 1,
    borderColor: "#888",
    backgroundColor: "#f7f7f5",
  },
  // Caps badge appended to the cover title when the package is in
  // draft state (unsigned recommendation letters present).
  coverDraftBadge: {
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
    color: "#b1330e",
  },
  // "Pending signed letters" block on the cover.
  coverPendingBox: {
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#b1830e",
    backgroundColor: "#fbf3df",
  },
  // Diagonal "DRAFT — UNSIGNED" watermark on prose pages whose source
  // is an unsigned recommendation-letter template. Fixed-position so
  // it repeats on every paginated page of the letter.
  watermark: {
    position: "absolute",
    top: "45%",
    left: 0,
    right: 0,
    textAlign: "center",
    fontFamily: "Helvetica-Bold",
    fontSize: 56,
    color: "#b1330e",
    opacity: 0.18,
    transform: "rotate(-24deg)",
    letterSpacing: 4,
  },
  // Exhibit-index table cells
  exhibitTable: {
    flexDirection: "column",
    marginTop: 12,
  },
  exhibitRow: {
    flexDirection: "row",
    borderBottomWidth: 0.5,
    borderBottomColor: "#ccc",
    paddingVertical: 4,
  },
  exhibitRowHeader: {
    fontFamily: "Helvetica-Bold",
    backgroundColor: "#eee",
  },
  exhibitColNum: { width: "12%" },
  exhibitColTitle: { width: "48%" },
  exhibitColType: { width: "25%" },
  exhibitColPages: { width: "15%", textAlign: "right" },
});
