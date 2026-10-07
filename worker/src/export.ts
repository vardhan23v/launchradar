/** Markdown report rendered server-side from a run view. */
import { regionName } from "./config";
import type { RunView } from "./types";
import { isRecord } from "./utils";

const LISTS = ["searchCalls", "evidence", "signals", "clusters", "competitors", "gaps", "opportunities"] as const;

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
  for (const key of LISTS) {
    const list = value[key] ?? [];
    if (!Array.isArray(list) || !list.every(isRecord)) throw new Error(`${key} must be a list`);
  }
  return value as unknown as RunView;
}

const s = (v: unknown): string => (typeof v === "string" ? v : v === null || v === undefined ? "" : String(v));
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const recs = (v: unknown): Record<string, unknown>[] => list(v).filter(isRecord);

export function exportMarkdown(view: RunView): string {
  const run = view.run;
  const evidence = recs(view.evidence);
  const day = new Date(run.finishedAt ?? run.createdAt).toISOString().slice(0, 10);
  const out: string[] = [
    `# LaunchRadar — ${run.question}`, "",
    `- Region: ${regionName(run.region)}`, `- Run: ${run.id} · ${day}`,
    `- Searches used: ${run.searchesUsed} / budget ${run.budget}`,
    `- Evidence: ${evidence.length} rows, ${new Set(evidence.map((e) => s(e.domain)).filter(Boolean)).size} domains, ${new Set(evidence.map((e) => s(e.blockType))).size} source types`, "",
    "## Opportunities (ranked)", "",
  ];
  const opps = recs(view.opportunities).sort((a, b) => Number(b.score ?? 0) - Number(a.score ?? 0));
  if (!opps.length) out.push("_None — every candidate gap is already served._", "");
  opps.forEach((o, i) => {
    const sub = isRecord(o.subScores) ? o.subScores : {};
    out.push(`### ${i + 1}. ${s(o.title)}`, "",
      `Score **${s(o.score)}/100** (${s(o.confidence)}). Pain ${s(sub.pain)}, Momentum ${s(sub.momentum)}, Commercial ${s(sub.commercial)}, Whitespace ${s(sub.whitespace)}, Weak rivals ${s(sub.weakRivals)}.`, "",
      `**Target:** ${s(o.target)}`, "", `**Problem:** ${s(o.problem)}`, "",
      `**Existing solutions:** ${s(o.existingSolutions)}`, "", `**Gap:** ${s(o.gap)}`, "",
      `**Pitch:** ${s(o.pitch)}`, "", "**MVP scope:**", ...list(o.mvpScope).map((b) => `- ${s(b)}`),
      "", `**First validation step:** ${s(o.firstValidationStep)}`, "");
    const skeptic = recs(o.skeptic);
    if (skeptic.length) {
      out.push("**Skeptic objections:**", "");
      skeptic.forEach((x, j) => out.push(`${j + 1}. ${s(x.objection)}`, `   Basis: ${s(x.basis)}`, `   Would change mind: ${s(x.wouldChangeMind)}`, ""));
    }
    out.push("---", "");
  });

  out.push("## Gap status", "");
  for (const g of recs(view.gaps)) {
    const products = recs(g.foundProducts).map((p) => s(p.name)).join(", ") || "—";
    const wedge = g.remainingWedge ? ` Wedge: ${s(g.remainingWedge)}` : "";
    out.push(`- **${s(g.status)}** — ${s(g.unmetNeed)} (cluster ${s(g.clusterId)}). Found: ${products}${wedge}`);
  }
  out.push("", "## Clusters", "");
  for (const c of recs(view.clusters)) {
    out.push(`- **${s(c.name)}** — ${s(c.jobToBeDone)}. Signals: ${list(c.signalIds).map(s).join(", ")}${c.weak ? " _(weak)_" : ""}`);
  }
  out.push("", "## Competitors", "");
  for (const c of recs(view.competitors)) {
    const rating = c.rating !== null && c.rating !== undefined ? `${s(c.rating)}★` : "n/a";
    const complaints = recs(c.complaints);
    const tail = complaints.length ? `; complaints: ${complaints.map((x) => s(x.text)).join("; ")}` : "";
    out.push(`- **${s(c.name)}** (${s(c.category)}) — ${s(c.pricing) || "pricing n/a"}, ${rating}${tail}`);
  }
  out.push("", "## Signals", "");
  for (const sig of recs(view.signals)) {
    out.push(`- [${s(sig.type)}, intensity ${s(sig.intensity)}] ${s(sig.statement)} _(${list(sig.evidenceIds).map(s).join(", ")})_ "${s(sig.quote)}"`);
  }
  out.push("", "## Research trace", "");
  for (const c of recs(view.searchCalls)) {
    const p = isRecord(c.params) ? c.params : {};
    const q = s(p.q || p.search_query || p.product_id || "");
    const status = s(c.status ?? "ok");
    const kind = status !== "ok" ? status : c.cached ? "cached" : "live";
    out.push(`- \`${s(c.engine)}\` — ${q} · ${Number(c.resultCount ?? 0)} rows · ${kind} · ${Number(c.latencyMs ?? 0)}ms`);
  }
  out.push("", "## Evidence", "");
  for (const e of evidence) {
    const url = e.url ? ` — ${s(e.url)}` : "";
    const snip = e.snippet ? ` · "${s(e.snippet)}"` : "";
    out.push(`- [${s(e.id)}] (${s(e.blockType)} · ${s(e.domain)}) ${s(e.title)}${url}${snip}`);
  }
  return out.join("\n");
}
