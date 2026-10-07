/** Recorded demo runs: materialised into the store instantly; the stream replays their trace. */
import fixture from "../fixtures/demo/ai-tools-college-india.json";
import type { Store } from "./store";
import type { Cluster, Competitor, DemoFixture, Gap, Opportunity, Run, SearchCall, Signal } from "./types";
import { makeId, nowMs } from "./utils";

/** allow-list: a slug never becomes an arbitrary lookup */
const DEMOS: Record<string, DemoFixture> = { "ai-tools-college-india": fixture as unknown as DemoFixture };

export function loadFixture(slug: string): DemoFixture | null {
  return Object.prototype.hasOwnProperty.call(DEMOS, slug) ? DEMOS[slug] : null;
}

export function listDemos(): { slug: string; label: string; question: string; region: string; searches: number }[] {
  return Object.entries(DEMOS).map(([slug, f]) => ({ slug, label: f.label, question: f.question, region: f.region, searches: f.searchCalls.length }));
}

export async function startDemoRun(store: Store, slug: string): Promise<string> {
  const f = loadFixture(slug);
  if (!f) throw new Error("unknown demo run");
  const runId = makeId("run");
  const defaults: Run = {
    id: runId, question: f.question, region: f.region, questionType: null, status: "running", budget: 25, searchesUsed: 0,
    createdAt: nowMs(), finishedAt: null, demo: true, demoLabel: null, rejectedSignals: 0, error: null,
  };
  const recorded: Partial<Run> = { ...f.run };
  delete recorded.id;
  delete recorded.createdAt;
  delete recorded.finishedAt;
  delete recorded.status;
  const run: Run = { ...defaults, ...recorded };
  await store.createRun(run);
  try {
    // the fixture's call ids (sc_demo_1…) are global keys: give every copy its own
    const callIds = new Map<string, string>();
    f.searchCalls.forEach((c, i) => callIds.set(c.id, `sc_${runId}_${i + 1}`));
    const tag = <T extends object>(rows: T[]): (T & { runId: string })[] => rows.map((r) => ({ ...r, runId }));
    for (const c of tag(f.searchCalls)) {
      // recorded calls predate the budget bookkeeping: they were never billed and carry no timestamp
      const call = c as Partial<SearchCall> & typeof c;
      await store.addSearchCall({ ...c, id: callIds.get(c.id) as string, billed: false, createdAt: call.createdAt ?? run.createdAt } as SearchCall, null);
    }
    // the recorded rows keep their original evidence ids (the example splits some results into E9 and E9b)
    await store.addEvidence(runId, "demo", f.evidence.map(({ runId: _r, searchCallId, ...rest }) => ({ ...rest, searchCallId: callIds.get(searchCallId) ?? "demo" })));
    await store.addSignals(runId, tag(f.signals) as Signal[]);
    await store.setClusters(runId, tag(f.clusters) as Cluster[]);
    await store.addCompetitors(runId, tag(f.competitors).map((c) => ({ ...c, clusterIds: c.clusterIds ?? [] })) as Competitor[]);
    await store.setGaps(runId, tag(f.gaps) as Gap[]);
    await store.setOpportunities(runId, tag(f.opportunities) as Opportunity[]);
    await store.setEvents(runId, f.events);
  } catch (err) {
    // never leave a half-written example "running" in the public list
    await store.deleteRun(runId).catch(() => undefined);
    throw err;
  }
  return runId;
}
