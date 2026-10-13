/** The Markdown report and the link-preview summary, rendered server-side in the words the site uses. */
import { isRegion, regionName } from "./config";
import type { RunCounts } from "./store";
import type { Run, RunMeta, RunView } from "./types";
import { isRecord } from "./utils";

const LISTS = ["searchCalls", "evidence", "signals", "clusters", "competitors", "gaps", "opportunities"] as const;
/** A real run has a few hundred records; the cap keeps one request from building a huge document. */
const MAX_RECORDS = 2000;

/**
 * The browser sends the run it holds back for export, so the shape is checked before anything is
 * read from it. Throws on anything that is not a run view (the route answers 400).
 */
export function asRunView(value: unknown): RunView {
  if (!isRecord(value) || !isRecord(value.run)) throw new Error("not a run view");
  const run = value.run;
  if (typeof run.id !== "string" || typeof run.question !== "string" || typeof run.region !== "string"
    || typeof run.createdAt !== "number" || typeof run.searchesUsed !== "number" || typeof run.budget !== "number") {
    throw new Error("not a run view");
  }
  if (!(run.finishedAt === null || run.finishedAt === undefined || typeof run.finishedAt === "number")) throw new Error("not a run view");
  let total = 0;
  for (const key of LISTS) {
    const list = value[key] ?? [];
    if (!Array.isArray(list) || !list.every(isRecord)) throw new Error(`${key} must be a list`);
    total += list.length;
  }
  if (total > MAX_RECORDS) throw new Error("too many records");
  return value as unknown as RunView;
}

const s = (v: unknown): string =>
  (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v)).replace(/[\r\n\u2028\u2029]+/g, " ");
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const recs = (v: unknown): Record<string, unknown>[] => list(v).filter(isRecord);

/** The browser chooses the region text; an unknown value is reduced to a short code before it is written. */
export function regionLabel(region: unknown): string {
  if (isRegion(region)) return regionName(region);
  return s(region).replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 8) || "UNKNOWN";
}

/** Stored values are short codes; the report shows the words the site uses for them. */
const GAP_WORDS: Record<string, string> = { open: "Nobody solves this yet", "partially-served": "Partly solved", served: "Already solved" };
const SURE_WORDS: Record<string, string> = { High: "very sure", Medium: "fairly sure", Low: "not very sure" };
const CATEGORY_WORDS: Record<string, string> = { direct: "same kind of product", adjacent: "similar product", "generic-substitute": "workaround" };
const CALL_WORDS: Record<string, string> = { failed: "didn't work", skipped: "skipped" };
const word = (table: Record<string, string>, v: unknown): string => (Object.prototype.hasOwnProperty.call(table, s(v)) ? table[s(v)] : s(v));

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * What a link preview shows for a run: its counts and one sentence. A recorded example has every
 * result from the start, so it reads as finished even while its trace is still being replayed.
 */
export function runMeta(run: Run, counts: RunCounts): RunMeta {
  let summary: string;
  if (run.status === "failed") summary = "Stopped before it finished.";
  else if (run.status !== "complete" && !run.demo) summary = "Still searching.";
  else if (counts.opportunities === 0) summary = "Done, but no idea was found.";
  else {
    const proof = run.outcome === "limited" ? ", with less proof than usual" : "";
    summary = `${count(counts.opportunities, "idea")} from ${count(run.searchCalls, "lookup")} across ${count(counts.evidence, "web page")}${proof}.`;
  }
  return {
    id: run.id, question: run.question, region: run.region, status: run.status, outcome: run.outcome, demo: run.demo,
    createdAt: run.createdAt, finishedAt: run.finishedAt, ideas: counts.opportunities, complaints: counts.clusters,
    products: counts.competitors, lookups: run.searchCalls, failedSearches: run.failedSearches, summary,
  };
}

export function exportMarkdown(view: RunView): string {
  const run = view.run;
  const evidence = recs(view.evidence);
  const day = new Date(run.finishedAt ?? run.createdAt).toISOString().slice(0, 10);
  const out: string[] = [
    `# LaunchRadar — ${s(run.question)}`, "",
    `- Region: ${regionLabel(run.region)}`, `- Search: ${s(run.id)} · ${day}`,
    `- Lookups used: ${run.searchesUsed} of ${run.budget}`,
    `- Web pages we read: ${evidence.length}, from ${new Set(evidence.map((e) => s(e.domain)).filter(Boolean)).size} websites and ${new Set(evidence.map((e) => s(e.blockType))).size} kinds of result`, "",
    "## Ideas (ranked)", "",
  ];
  const opps = recs(view.opportunities).sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  if (!opps.length) out.push("_None: someone already solves each one._", "");
  opps.forEach((o, i) => {
    const sub = isRecord(o.subScores) ? o.subScores : {};
    out.push(`### ${i + 1}. ${s(o.title)}`, "",
      `Idea score **${s(o.score)}/100** (how sure we are: ${word(SURE_WORDS, o.confidence)}). How much it hurts ${s(sub.pain)}, Getting popular ${s(sub.momentum)}, People would pay ${s(sub.commercial)}, Room for something new ${s(sub.whitespace)}, Weak existing products ${s(sub.weakRivals)}.`, "",
      `**Who it's for:** ${s(o.target)}`, "", `**The problem:** ${s(o.problem)}`, "",
      `**What people use now:** ${s(o.existingSolutions)}`, "", `**What's missing:** ${s(o.gap)}`, "",
      `**The idea:** ${s(o.pitch)}`, "", "**What to build first:**", ...list(o.mvpScope).map((b) => `- ${s(b)}`),
      "", `**How to check it first:** ${s(o.firstValidationStep)}`, "");
    const skeptic = recs(o.skeptic);
    if (skeptic.length) {
      out.push("**Why it might not work:**", "");
      skeptic.forEach((x, j) => out.push(`${j + 1}. ${s(x.objection)}`, `   Based on: ${s(x.basis)}`, `   What would change our mind: ${s(x.wouldChangeMind)}`, ""));
    }
    out.push("---", "");
  });

  out.push("## What's missing, and whether anyone solves it", "");
  for (const g of recs(view.gaps)) {
    const products = recs(g.foundProducts).map((p) => s(p.name)).join(", ") || "none";
    const wedge = g.remainingWedge ? ` Still missing: ${s(g.remainingWedge)}` : "";
    out.push(`- **${word(GAP_WORDS, g.status)}** — ${s(g.unmetNeed)} (complaint group ${s(g.clusterId)}). Products found: ${products}${wedge}`);
  }
  out.push("", "## What people complain about", "");
  for (const c of recs(view.clusters)) {
    out.push(`- **${s(c.name)}** — ${s(c.jobToBeDone)}. Complaints: ${list(c.signalIds).map(s).join(", ")}${c.weak ? " _(only a little proof)_" : ""}`);
  }
  out.push("", "## Existing products", "");
  for (const c of recs(view.competitors)) {
    const rating = c.rating !== null && c.rating !== undefined ? `${s(c.rating)}★` : "no star rating";
    const complaints = recs(c.complaints);
    const tail = complaints.length ? `; what people complain about: ${complaints.map((x) => s(x.text)).join("; ")}` : "";
    out.push(`- **${s(c.name)}** (${word(CATEGORY_WORDS, c.category)}) — ${s(c.pricing) || "price not found"}, ${rating}${tail}`);
  }
  out.push("", "## Complaints", "");
  for (const sig of recs(view.signals)) {
    out.push(`- [${s(sig.type)}, hurts ${s(sig.intensity)} out of 5] ${s(sig.statement)} _(${list(sig.evidenceIds).map(s).join(", ")})_ "${s(sig.quote)}"`);
  }
  out.push("", "## Lookups", "");
  for (const c of recs(view.searchCalls)) {
    const p = isRecord(c.params) ? c.params : {};
    const q = s(p.q || p.search_query || p.product_id || "");
    const status = s(c.status ?? "ok");
    const kind = status !== "ok" ? word(CALL_WORDS, status) : c.cached ? "from cache" : "live";
    out.push(`- \`${s(c.engine)}\` — ${q} · ${Number(c.resultCount ?? 0)} results · ${kind} · ${Number(c.latencyMs ?? 0)}ms`);
  }
  out.push("", "## Web pages we read", "");
  for (const e of evidence) {
    const url = e.url ? ` — ${s(e.url)}` : "";
    const snip = e.snippet ? ` · "${s(e.snippet)}"` : "";
    out.push(`- [${s(e.id)}] (${s(e.blockType)} · ${s(e.domain)}) ${s(e.title)}${url}${snip}`);
  }
  return out.join("\n");
}
