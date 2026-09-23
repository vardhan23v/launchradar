export interface CiteGroup {
  ids: string[];
  index: number;
  length: number;
}

/**
 * Matches one citation group: [E1,E2], also with a letter suffix (E9b, used when one search result
 * is split into two evidence rows) and with spaces after the commas.
 */
export const CITE_RE = /\[(E\d+[a-z]?(?:\s*,\s*E\d+[a-z]?)*)\]/g;

/** [E1,E2] -> groups of ids with positions in the source text */
export function citeGroups(text: string): CiteGroup[] {
  const re = new RegExp(CITE_RE.source, "g");
  const out: CiteGroup[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ ids: m[1].split(",").map((id) => id.trim()), index: m.index, length: m[0].length });
  }
  return out;
}

/** Highlight a (case/whitespace-normalised) verbatim quote within a text. */
export function findQuoteAt(text: string, quote: string): number {
  if (!quote) return -1;
  return text.toLowerCase().indexOf(quote.toLowerCase());
}