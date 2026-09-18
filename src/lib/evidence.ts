export interface CiteGroup {
  ids: string[];
  index: number;
  length: number;
}

/** [E1,E2] -> groups of ids with positions in the source text */
export function citeGroups(text: string): CiteGroup[] {
  const re = /\[(E\d+(?:,E\d+)*)\]/g;
  const out: CiteGroup[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({ ids: m[1].split(","), index: m.index, length: m[0].length });
  }
  return out;
}

/** Highlight a (case/whitespace-normalised) verbatim quote within a text. */
export function findQuoteAt(text: string, quote: string): number {
  if (!quote) return -1;
  return text.toLowerCase().indexOf(quote.toLowerCase());
}