import { regionName } from "./config";
import type { RunView } from "./schemas";

/** Server-side Markdown report exported from a completed run view. */
export function exportMarkdown(view: RunView): string {
  const { run, opportunities, clusters, gaps, competitors, signals, evidence, searchCalls } = view;
  const lines: string[] = [];
  const now = new Date(run.finishedAt ?? run.createdAt).toISOString().slice(0, 10);

  lines.push(`# LaunchRadar — ${run.question}`, "");
  lines.push(`- Region: ${regionName(run.region)}`);
  lines.push(`- Run: ${run.id} · ${now}`);
  lines.push(`- Searches used: ${run.searchesUsed} / budget ${run.budget}`);
  lines.push(`- Confidence elements: ${evidence.length} evidence rows, ${new Set(evidence.map((e) => e.domain).filter(Boolean)).size} domains, ${new Set(evidence.map((e) => e.blockType)).size} source types`);
  lines.push("");

  lines.push("## Opportunities (ranked)", "");
  if (opportunities.length === 0) lines.push("_None — every candidate gap is already served._", "");
  opportunities.forEach((o, i) => {
    lines.push(`### ${i + 1}. ${o.title}`, "");
    lines.push(`Score **${o.score}/100** (${o.confidence}). Pain ${o.subScores.pain}, Momentum ${o.subScores.momentum}, Commercial ${o.subScores.commercial}, Whitespace ${o.subScores.whitespace}, Weak rivals ${o.subScores.weakRivals}.`, "");
    lines.push(`**Target:** ${o.target}`, "");
    lines.push(`**Problem:** ${o.problem}`, "");
    lines.push(`**Existing solutions:** ${o.existingSolutions}`, "");
    lines.push(`**Gap:** ${o.gap}`, "");
    lines.push(`**Pitch:** ${o.pitch}`, "");
    lines.push("**MVP scope:**", ...o.mvpScope.map((b) => `- ${b}`), "");
    lines.push(`**First validation step:** ${o.firstValidationStep}`, "");
    if (o.skeptic.length > 0) {
      lines.push("**Skeptic objections:**", "");
      o.skeptic.forEach((s, j) => {
        lines.push(`${j + 1}. ${s.objection}`);
        lines.push(`   Basis: ${s.basis}`);
        lines.push(`   Would change mind: ${s.wouldChangeMind}`, "");
      });
    }
    lines.push("---", "");
  });

  lines.push("## Gap status", "");
  gaps.forEach((g) => {
    const products = g.foundProducts.map((p) => p.name).join(", ") || "—";
    lines.push(`- **${g.status}** — ${g.unmetNeed} (cluster ${g.clusterId}). Found: ${products}${g.remainingWedge ? ` Wedge: ${g.remainingWedge}` : ""}`);
  });
  lines.push("");

  lines.push("## Clusters", "");
  clusters.forEach((c) => {
    const sigs = c.signalIds.join(", ");
    lines.push(`- **${c.name}** — ${c.jobToBeDone}. Signals: ${sigs}${c.weak ? " _(weak)_" : ""}`);
  });
  lines.push("");

  lines.push("## Competitors", "");
  competitors.forEach((c) => {
    const rating = c.rating !== null ? `${c.rating}★` : "n/a";
    const complaints = c.complaints.length > 0 ? `; complaints: ${c.complaints.map((x) => x.text).join("; ")}` : "";
    lines.push(`- **${c.name}** (${c.category}) — ${c.pricing ?? "pricing n/a"}, ${rating}${complaints}`);
  });
  lines.push("");

  lines.push("## Signals", "");
  signals.forEach((s) => {
    lines.push(
      `- [${s.type}, intensity ${s.intensity}] ${s.statement} _(${s.evidenceIds.join(", ")})_ "${s.quote}"`,
    );
  });
  lines.push("");

  lines.push("## Research trace", "");
  searchCalls.forEach((c) => {
    lines.push(`- \`${c.engine}\` — ${String(c.params.q ?? c.params.search_query ?? c.params.product_id ?? "")} · ${c.resultCount} rows · ${c.cached ? "cached" : "live"} · ${c.latencyMs}ms`);
  });
  lines.push("");

  lines.push("## Evidence", "");
  evidence.forEach((e) => {
    lines.push(`- [${e.id}] (${e.blockType} · ${e.domain}) ${e.title}${e.url ? ` — ${e.url}` : ""}${e.snippet ? ` · "${e.snippet}"` : ""}`);
  });

  return lines.join("\n");
}

export function markdownFileName(runId: string): string {
  return `launchradar-${runId}.md`;
}