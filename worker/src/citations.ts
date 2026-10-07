/** Citation validator: the gate every Signal, complaint and found product passes before it is persisted. */

interface Quotable {
  id: string;
  title?: string;
  snippet?: string;
  text?: string | null;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").replace(/[”"“]/g, "").trim();
}

function sourceText(e: Quotable): string {
  return norm([e.title ?? "", e.snippet ?? "", e.text ?? ""].join(" "));
}

/** Ids must exist in this run, and the quote must be a verbatim (case/whitespace-normalised) substring. */
export function verifyQuote(evidenceIds: Iterable<unknown>, quote: unknown, allEvidence: Quotable[]): [boolean, string] {
  const byId = new Map(allEvidence.map((e) => [e.id, e]));
  const q = norm(typeof quote === "string" ? quote : "");
  if (!q) return [false, "empty quote"];
  const ids = [...evidenceIds];
  for (const i of ids) {
    const ev = typeof i === "string" ? byId.get(i) : undefined;
    if (ev === undefined) return [false, `unknown evidence id ${String(i)}`];
    if (sourceText(ev).includes(q)) return [true, ""];
  }
  if (!ids.length) return [false, "no evidence id given"];
  return [false, "quote is not a substring of any cited row"];
}

export function validateSignals<T extends { evidenceIds?: string[]; quote?: string }>(signals: T[], allEvidence: Quotable[]): [T[], number] {
  const valid = signals.filter((s) => verifyQuote(s.evidenceIds ?? [], s.quote ?? "", allEvidence)[0]);
  return [valid, signals.length - valid.length];
}
