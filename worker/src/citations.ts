/** Citation validator: the gate every Signal, complaint and found product passes before it is persisted. */

interface Quotable {
  id: string;
  title?: string;
  snippet?: string;
  text?: string | null;
}

/** Fields are joined with a mark no scraped text or model quote contains, so a quote cannot straddle two fields. */
const FIELD_BREAK = " ¶ ";

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[”"“]/g, "").trim();
}

function sourceText(e: Quotable): string {
  return norm([e.title ?? "", e.snippet ?? "", e.text ?? ""].join(FIELD_BREAK));
}

/** Evidence ids the run actually contains, in the order given (unknown ids dropped). */
export function knownIds(evidenceIds: Iterable<unknown>, allEvidence: Quotable[]): string[] {
  const ids = new Set(allEvidence.map((e) => e.id));
  return [...evidenceIds].filter((i): i is string => typeof i === "string" && ids.has(i));
}

/**
 * The quote must be a verbatim (case/whitespace-normalised) substring of one field of a cited row
 * that exists in this run. Ids the run does not contain are ignored wherever they appear in the
 * list; a quote whose every id is unknown fails.
 */
export function verifyQuote(evidenceIds: Iterable<unknown>, quote: unknown, allEvidence: Quotable[]): [boolean, string] {
  const byId = new Map(allEvidence.map((e) => [e.id, e]));
  const q = norm(typeof quote === "string" ? quote : "");
  if (!q) return [false, "empty quote"];
  if (q.includes(FIELD_BREAK.trim())) return [false, "quote spans two fields"];
  const ids = [...evidenceIds];
  if (!ids.length) return [false, "no evidence id given"];
  const known = knownIds(ids, allEvidence);
  if (!known.length) return [false, `unknown evidence id ${ids.map(String).join(", ")}`];
  for (const i of known) {
    if (sourceText(byId.get(i) as Quotable).includes(q)) return [true, ""];
  }
  return [false, "quote is not a substring of any cited row"];
}

export function validateSignals<T extends { evidenceIds?: string[]; quote?: string }>(signals: T[], allEvidence: Quotable[]): [T[], number] {
  const valid = signals.filter((s) => verifyQuote(s.evidenceIds ?? [], s.quote ?? "", allEvidence)[0]);
  return [valid, signals.length - valid.length];
}
