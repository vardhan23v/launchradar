import { readFileSync } from "node:fs";
import { join } from "node:path";
import type {
  Cluster,
  Competitor,
  Evidence,
  Gap,
  Opportunity,
  Run,
  SearchCall,
  Signal,
  StepEvent,
} from "../schemas";
import { RunSchema } from "../schemas";
import { makeId } from "../serpapi/client";
import type { Store } from "../store";

interface DemoFixture {
  slug: string;
  label: string;
  question: string;
  region: string;
  run: Omit<Run, "id" | "createdAt" | "finishedAt">;
  searchCalls: Array<Omit<SearchCall, "runId">>;
  evidence: Array<Omit<Evidence, "runId">>;
  signals: Array<Omit<Signal, "runId">>;
  clusters: Array<Omit<Cluster, "runId">>;
  competitors: Array<Omit<Competitor, "runId">>;
  gaps: Array<Omit<Gap, "runId">>;
  opportunities: Array<Omit<Opportunity, "runId">>;
  events: StepEvent[];
}

export function listDemoSlugs(): string[] {
  return ["ai-tools-college-india"];
}

export function loadDemoFixture(slug: string): DemoFixture {
  const file = join(process.cwd(), "fixtures", "demo", `${slug}.json`);
  const raw = JSON.parse(readFileSync(file, "utf8")) as DemoFixture;
  RunSchema.omit({ id: true, createdAt: true, finishedAt: true }).parse(raw.run);
  return raw;
}

/**
 * Materialise a recorded demo run into the store. The run starts "running";
 * the SSE stream then replays the recorded step events so the trace animates.
 */
export function startDemoRun(
  s: Store,
  slug: string,
): string {
  const fixture = loadDemoFixture(slug);
  const runId = makeId("run");
  const now = Date.now();
  const run: Run = {
    ...fixture.run,
    id: runId,
    createdAt: now,
    finishedAt: null,
    status: "running",
  };
  s.createRun(run);

  s.addSearchCalls(fixture.searchCalls.map((c) => ({ ...c, runId })));
  s.addEvidence(fixture.evidence.map((e) => ({ ...e, runId })));
  s.addSignals(fixture.signals.map((x) => ({ ...x, runId })));
  s.setClusters(runId, fixture.clusters.map((x) => ({ ...x, runId })));
  s.addCompetitors(fixture.competitors.map((x) => ({ ...x, runId })));
  s.setGaps(runId, fixture.gaps.map((x) => ({ ...x, runId })));
  s.setOpportunities(runId, fixture.opportunities.map((x) => ({ ...x, runId })));
  s.events(runId, fixture.events);

  return runId;
}