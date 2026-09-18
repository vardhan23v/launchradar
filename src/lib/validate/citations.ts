import type { Evidence } from "../schemas";

export interface CitationCheck {
  ok: boolean;
  reason?: string;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[”"“]/g, "")
    .trim();
}

function sourceText(e: Evidence): string {
  return norm([e.title, e.snippet, e.text ?? ""].join(" "));
}

/**
 * Every signal must:
 *  - reference only Evidence ids that exist for this run
 *  - quote a verbatim substring of at least one cited row (case/whitespace normalised)
 */
export function verifyQuote(
  evidenceIds: string[],
  quote: string,
  allEvidence: Evidence[],
): CitationCheck {
  const byId = new Map(allEvidence.map((e) => [e.id, e]));
  const q = norm(quote);

  if (q.length === 0) return { ok: false, reason: "empty quote" };

  for (const id of evidenceIds) {
    const ev = byId.get(id);
    if (!ev) return { ok: false, reason: `unknown evidence id ${id}` };
    if (q.length > 0 && sourceText(ev).includes(q)) {
      return { ok: true };
    }
  }

  const known = evidenceIds.filter((id) => byId.has(id));
  if (known.length === 0) {
    return { ok: false, reason: "no evidence id resolves to this run" };
  }
  return { ok: false, reason: "quote is not a substring of any cited row" };
}

export function validateSignals(
  signals: Array<{ evidenceIds: string[]; quote: string }>,
  allEvidence: Evidence[],
): { valid: typeof signals; rejected: number } {
  const valid: typeof signals = [];
  let rejected = 0;
  for (const s of signals) {
    const check = verifyQuote(s.evidenceIds, s.quote, allEvidence);
    if (check.ok) valid.push(s);
    else rejected++;
  }
  return { valid, rejected };
}