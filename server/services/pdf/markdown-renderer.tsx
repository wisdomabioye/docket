import "server-only";
import { Fragment } from "react";
import type { ReactElement, ReactNode } from "react";
import { Link, Text, View } from "@react-pdf/renderer";
import { Marked } from "marked";
import type { Token, Tokens } from "marked";
import { styles } from "./styles";

/**
 * Markdown → React-PDF renderer. Single source of truth for all 5
 * prose templates; without this, each template would re-implement the
 * same Token-walk and the inline `<strong>` / `<em>` / `<a>` handling.
 *
 * Why parse markdown directly here (instead of running `lib/markdown.ts`
 * `mdToSafeHtml` and walking HTML): React-PDF's primitives (`<View>`,
 * `<Text>`) don't accept HTML strings — every node must be a React
 * element. Walking `marked`'s token stream is the cleanest path.
 *
 * Allowlist parity with `sanitizeHtml`: same tags (p, h1-h4, strong,
 * em, ul, ol, li, blockquote, sup, a). Anything outside the allowlist
 * is rendered as plain text (the token's raw form), so a paste from
 * Word with unknown markup still produces something readable rather
 * than throwing.
 *
 * Module-singleton `Marked` — same instance settings as `lib/markdown.ts`.
 */

const marked = new Marked({
  gfm: false,
  breaks: false,
  async: false,
});

export type MarkdownRendererProps = {
  /** Markdown source (canonical form from `case_outputs.content`). */
  content: string;
};

/** Walks marked's token tree and emits React-PDF elements. */
export function MarkdownRenderer({
  content,
}: MarkdownRendererProps): ReactElement {
  if (!content || content.trim().length === 0) {
    return (
      <Text style={[styles.paragraph, { color: "#888" }]}>(no content)</Text>
    );
  }
  const tokens = marked.lexer(content);
  return <View>{tokens.map((tok, i) => renderBlock(tok, i))}</View>;
}

function renderBlock(token: Token, key: number): ReactElement | null {
  switch (token.type) {
    case "heading": {
      const t = token as Tokens.Heading;
      const headingStyle =
        t.depth === 1
          ? styles.h1
          : t.depth === 2
            ? styles.h2
            : t.depth === 3
              ? styles.h3
              : styles.h4;
      return (
        <Text key={key} style={headingStyle}>
          {renderInlineTokens(t.tokens ?? [])}
        </Text>
      );
    }
    case "paragraph": {
      const t = token as Tokens.Paragraph;
      return (
        <Text key={key} style={styles.paragraph}>
          {renderInlineTokens(t.tokens ?? [])}
        </Text>
      );
    }
    case "list": {
      const t = token as Tokens.List;
      // marked's `Tokens.List.start` is `number | ''` (empty string
      // when the list isn't ordered). Default to 1 for ordered lists
      // when the source omits an explicit start number.
      const startNum: number =
        typeof t.start === "number" && Number.isFinite(t.start) ? t.start : 1;
      return (
        <View key={key} style={styles.list}>
          {t.items.map((item, j) => (
            <Text key={j} style={styles.listItem}>
              {t.ordered ? `${startNum + j}. ` : "• "}
              {renderInlineTokens(item.tokens ?? [])}
            </Text>
          ))}
        </View>
      );
    }
    case "blockquote": {
      const t = token as Tokens.Blockquote;
      return (
        <View key={key} style={styles.blockquote}>
          {t.tokens.map((sub, j) => renderBlock(sub, j))}
        </View>
      );
    }
    case "space":
      // Blank-line separator. React-PDF ignores it; the surrounding
      // paragraph margins handle spacing.
      return null;
    case "hr":
      return (
        <View
          key={key}
          style={{
            borderBottomWidth: 0.5,
            borderBottomColor: "#888",
            marginVertical: 8,
          }}
        />
      );
    case "html": {
      // Raw HTML in the source. We could parse + walk it, but the
      // attorney-edit pipeline already runs `sanitizeHtml` on the way
      // out of Tiptap, so anything reaching here is either trusted
      // model output or a pre-sanitization PDF render. Render as
      // monospace text so the raw HTML is visible (rather than
      // silently dropped or executed) — the attorney can spot it.
      const t = token as Tokens.HTML;
      return (
        <Text key={key} style={[styles.paragraph, { fontFamily: "Courier" }]}>
          {t.text}
        </Text>
      );
    }
    case "text": {
      // Top-level text token (rare — usually wrapped in a paragraph).
      const t = token as Tokens.Text;
      return (
        <Text key={key} style={styles.paragraph}>
          {t.tokens ? renderInlineTokens(t.tokens) : t.text}
        </Text>
      );
    }
    default:
      // Unknown block type — render as plain text fallback. Avoids
      // throwing on an unexpected token (e.g. table from a paste).
      return (
        <Text key={key} style={styles.paragraph}>
          {"raw" in token && typeof token.raw === "string" ? token.raw : ""}
        </Text>
      );
  }
}

/** Renders a flat list of inline tokens. Each maps to either a React
 *  fragment of plain text or a styled `<Text>` / `<Link>` span. */
function renderInlineTokens(tokens: Token[]): ReactNode {
  return tokens.map((tok, i) => (
    <Fragment key={i}>{renderInlineToken(tok)}</Fragment>
  ));
}

function renderInlineToken(token: Token): ReactNode {
  switch (token.type) {
    case "text": {
      const t = token as Tokens.Text;
      // `text` tokens may contain nested tokens (e.g. inside list items
      // that mix bold + plain). Recurse when present.
      return t.tokens ? renderInlineTokens(t.tokens) : t.text;
    }
    case "strong": {
      const t = token as Tokens.Strong;
      return <Text style={styles.bold}>{renderInlineTokens(t.tokens ?? [])}</Text>;
    }
    case "em": {
      const t = token as Tokens.Em;
      return <Text style={styles.italic}>{renderInlineTokens(t.tokens ?? [])}</Text>;
    }
    case "link": {
      const t = token as Tokens.Link;
      // Reject non-http(s) schemes inline — same allowlist as
      // `sanitizeHtml`. Defense in depth in case markdown source
      // contains a `javascript:` link the sanitizer didn't see.
      const href = t.href.startsWith("https://") || t.href.startsWith("http://")
        ? t.href
        : "";
      if (href === "") {
        return renderInlineTokens(t.tokens ?? []);
      }
      return (
        <Link src={href} style={styles.link}>
          {renderInlineTokens(t.tokens ?? [])}
        </Link>
      );
    }
    case "codespan": {
      const t = token as Tokens.Codespan;
      return <Text style={{ fontFamily: "Courier", fontSize: 11 }}>{t.text}</Text>;
    }
    case "br":
      return "\n";
    case "html": {
      // Inline raw HTML — most commonly `<sup>1</sup>`. Pick out the
      // narrow `<sup>` case and render as superscript; everything else
      // shows as plain text.
      const t = token as Tokens.HTML;
      const supMatch = /^<sup>(.*?)<\/sup>$/i.exec(t.text);
      if (supMatch) {
        return <Text style={styles.superscript}>{supMatch[1]}</Text>;
      }
      return t.text;
    }
    default: {
      const t = token as Tokens.Generic;
      return "raw" in t && typeof t.raw === "string" ? t.raw : "";
    }
  }
}
