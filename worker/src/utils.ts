/** Small pure helpers shared by the pipeline, the store and the HTTP layer. */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "how", "why", "what",
  "who", "can", "not", "you", "your", "best", "top", "new", "app", "apps", "tool", "tools",
]);

const UNIT_MS: Record<string, number> = {
  minute: 60_000, min: 60_000, hour: 3_600_000, day: 86_400_000,
  week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
};
const REL = /^(an?|\d+)\s+(minute|min|hour|day|week|month|year)s?\s+ago$/i;
const NEWS = /^(\d{2})\/(\d{2})\/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)/i;
// [E1,E2]; ids may carry a letter suffix (E9b: one search result split into two evidence rows)
const CITE = /\[(E\d+[a-z]?(?:\s*,\s*E\d+[a-z]?)*)\]/g;
const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

export function nowMs(): number {
  return Date.now();
}

export function normaliseQuery(q: string): string {
  return q.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

/** Significant lowercase tokens (the planner's domain-term guard). */
export function keyTerms(text: string): string[] {
  return normaliseQuery(text).split(" ").filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

function utc(y: number, m: number, d: number, h = 0, min = 0): number | null {
  const t = Date.UTC(y, m, d, h, min);
  // Date.UTC silently rolls invalid dates over (Feb 30 → Mar 2); refuse those like Python does
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m && back.getUTCDate() === d ? t : null;
}

/** ISO, 'Mar 5, 2026', '3 days ago', and Google News' '01/02/2026, 10:30 PM, +0700 +07' → epoch ms. */
export function parseSerpDate(value: string | undefined | null, now?: number): number | null {
  if (!value) return null;
  const s = value.trim();
  if (!s) return null;
  const base = now ?? nowMs();
  const rel = REL.exec(s);
  if (rel) {
    const n = /^an?$/i.test(rel[1]) ? 1 : Number.parseInt(rel[1], 10);
    return base - n * UNIT_MS[rel[2].toLowerCase()];
  }
  if (s.toLowerCase() === "yesterday") return base - 86_400_000;
  const news = NEWS.exec(s);
  if (news) {
    const hour = (Number(news[4]) % 12) + (news[6].toUpperCase() === "PM" ? 12 : 0);
    return utc(Number(news[3]), Number(news[1]) - 1, Number(news[2]), hour, Number(news[5]));
  }
  // ISO 8601 (Python's fromisoformat): date, or date+time with optional offset
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/.exec(s);
  if (iso) {
    const t = utc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] ?? 0), Number(iso[5] ?? 0));
    if (t === null) return null;
    let ms = t + Number(iso[6] ?? 0) * 1000;
    const off = iso[7];
    if (off && off !== "Z") {
      const sign = off[0] === "-" ? -1 : 1;
      const digits = off.slice(1).replace(":", "");
      ms -= sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2))) * 60_000;
    }
    return ms;
  }
  // 'Mar 5, 2026' · 'March 5, 2026' · '5 Mar 2026'
  const mdy = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(s);
  if (mdy && mdy[1].toLowerCase() in MONTHS) return utc(Number(mdy[3]), MONTHS[mdy[1].toLowerCase()], Number(mdy[2]));
  const dmy = /^(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})$/.exec(s);
  if (dmy && dmy[2].toLowerCase() in MONTHS) return utc(Number(dmy[3]), MONTHS[dmy[2].toLowerCase()], Number(dmy[1]));
  return null;
}

export interface CiteGroup {
  ids: string[];
  index: number;
  length: number;
}

/** [E1,E2] → groups of ids with their position in the text. */
export function citeGroups(text: string): CiteGroup[] {
  const out: CiteGroup[] = [];
  for (const m of text.matchAll(CITE)) {
    out.push({ ids: m[1].split(",").map((i) => i.trim()), index: m.index, length: m[0].length });
  }
  return out;
}

/** Drop citation ids the run does not contain, so every rendered [E..] resolves. */
export function keepKnownCitations(text: string, known: Set<string>): string {
  let out = text;
  for (const g of citeGroups(text).reverse()) {
    const ids = g.ids.filter((i) => known.has(i));
    const repl = ids.length ? `[${ids.join(",")}]` : "";
    out = out.slice(0, g.index) + repl + out.slice(g.index + g.length);
  }
  out = out.replace(/\s+([.,;])/g, "$1");
  return out.replace(/\s{2,}/g, " ").trim();
}

/** Insertion-ordered de-duplication (Python's dict.fromkeys idiom). */
export function uniq<T>(items: Iterable<T>): T[] {
  return [...new Set(items)];
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Trimmed string or "" (the Python helper `_s`). */
export function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Finite number from a number or numeric string; booleans and junk → null (the Python helper `_num`). */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === "boolean") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function need(d: unknown, key: string): unknown {
  if (!isRecord(d) || !(key in d)) throw new Error(`missing field '${key}'`);
  return d[key];
}

/** Python's str(float): 1.0 → "1.0" matters nowhere here, but ints must print without ".0". */
export function fmtNum(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1e6) / 1e6);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** run_1a0cfafca7a6qn1vc: time stamp + 6 random lowercase alphanumerics. */
export function makeId(prefix: string): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let tail = "";
  for (const b of bytes) tail += alphabet[b % alphabet.length];
  return `${prefix}_${nowMs().toString(16)}${tail}`;
}
