import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Evidence } from "../src/lib/schemas";
import { verifyQuote, validateSignals } from "../src/lib/validate/citations";
import { citeGroups } from "../src/lib/evidence";

interface SignalLike {
  evidenceIds: string[];
  quote: string;
}
interface Fixture {
  evidence: Array<Record<string, unknown>>;
  signals: SignalLike[];
  competitors: Array<{ complaints: Array<{ evidenceId: string; quote: string }> }>;
  opportunities: Array<{ problem: string; existingSolutions: string; gap: string }>;
  gaps: Array<{ clusterId: string }>;
  clusters: Array<{ id: string; signalIds: string[] }>;
}

const fixture = JSON.parse(
  readFileSync(join(process.cwd(), "fixtures", "demo", "ai-tools-college-india.json"), "utf8"),
) as Fixture;

const evidence = fixture.evidence.map((e) => ({
  ...e,
  runId: "demo",
  searchCallId: String(e.searchCallId ?? ""),
  blockType: String(e.blockType ?? "organic"),
  title: String(e.title ?? ""),
  url: String(e.url ?? ""),
  domain: String(e.domain ?? ""),
  snippet: String(e.snippet ?? ""),
  position: typeof e.position === "number" ? e.position : 0,
  meta: {},
})) as Evidence[];

describe("demo fixture integrity", () => {
  it("all stored signals pass the citation validator (quote is verbatim)", () => {
    const { valid, rejected } = validateSignals(fixture.signals, evidence);
    expect(rejected).toBe(0);
    expect(valid).toHaveLength(fixture.signals.length);
  });

  it("every competitor complaint quote resolves to its evidence", () => {
    for (const c of fixture.competitors) {
      for (const complaint of c.complaints) {
        const check = verifyQuote([complaint.evidenceId], complaint.quote, evidence);
        expect(check.ok).toBe(true);
      }
    }
  });

  it("every cited evidence id in opportunity copy exists and has non-empty evidence", () => {
    const byId = new Map(evidence.map((e) => [e.id, e]));
    for (const o of fixture.opportunities) {
      for (const field of [o.problem, o.existingSolutions, o.gap]) {
        for (const g of citeGroups(field)) {
          for (const id of g.ids) {
            const ev = byId.get(id);
            expect(ev, `${id} missing in ${field.slice(0, 60)}`).toBeTruthy();
            expect(ev!.snippet.length, `${id} has no snippet text`).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it("every cluster references real signal ids", () => {
    const sigIds = new Set((fixture as unknown as { signals: Array<{ id: string }> }).signals.map((s) => s.id));
    for (const c of fixture.clusters) {
      expect(c.id).toMatch(/^C\d+$/);
      for (const sid of c.signalIds) {
        expect(sigIds.has(sid), `${sid} referenced by ${c.id} is not a signal`).toBe(true);
      }
    }
  });

  it("every gap references a real cluster id", () => {
    const clusterIds = new Set(fixture.clusters.map((c) => c.id));
    for (const g of fixture.gaps) {
      expect(clusterIds.has(g.clusterId), `${g.clusterId} is not a cluster`).toBe(true);
    }
  });

  it("evidence ids are globally unique", () => {
    const ids = evidence.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});