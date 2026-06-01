/**
 * Parses h1–h3 headings out of an output's markdown `content` for the
 * editor's "Sections" table-of-contents (Stage 13 / #72). Pure + tested;
 * the editor renders the list and scrolls to the matching rendered
 * heading by text.
 *
 * Skips lines inside fenced code blocks (so a `# comment` in a code
 * sample isn't mistaken for a heading) and strips inline emphasis/code
 * markers so the parsed text matches the rendered `<h*>` textContent.
 */

export type TocEntry = { level: 1 | 2 | 3; text: string };

export function parseHeadings(markdown: string): TocEntry[] {
  const out: TocEntry[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,3})\s+(.+?)\s*#*$/.exec(line);
    if (!m) continue;
    const [, hashes, raw] = m;
    if (!hashes || !raw) continue;
    const level = hashes.length as 1 | 2 | 3;
    const text = raw.replace(/[*_`]/g, "").trim();
    if (text) out.push({ level, text });
  }
  return out;
}
