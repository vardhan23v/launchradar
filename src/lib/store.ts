import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type {
  Cluster,
  Competitor,
  Evidence,
  Gap,
  Opportunity,
  Run,
  RunView,
  SearchCall,
  Signal,
  StepEvent,
} from "./schemas";

export interface DBShape {
  runs: Run[];
  searchCalls: SearchCall[];
  evidence: Evidence[];
  signals: Signal[];
  clusters: Cluster[];
  competitors: Competitor[];
  gaps: Gap[];
  opportunities: Opportunity[];
  events: Record<string, StepEvent[]>; // runId -> step events
}

function empty(): DBShape {
  return { runs: [], searchCalls: [], evidence: [], signals: [], clusters: [], competitors: [], gaps: [], opportunities: [], events: {} };
}

export class Store {
  private path: string;
  private mem: DBShape;

  constructor(path?: string) {
    this.path = path ?? process.env.STORE_PATH ?? join(process.cwd(), "data", "store.json");
    this.mem = this.read();
  }

  private read(): DBShape {
    try {
      if (!existsSync(this.path)) return empty();
      return JSON.parse(readFileSync(this.path, "utf8")) as DBShape;
    } catch {
      return empty();
    }
  }

  private persist(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.mem, null, 2), "utf8");
  }

  private load<T>(field: keyof DBShape, runId: string): T[] {
    const arr = this.mem[field];
    return Array.isArray(arr)
      ? (arr.filter((x) => (x as { runId?: string }).runId === runId) as T[])
      : [];
  }

  createRun(run: Run): void {
    this.mem.runs.push(run);
    this.events(run.id, []);
    this.persist();
  }

  updateRun(id: string, patch: Partial<Run>): Run {
    const run = this.mem.runs.find((r) => r.id === id);
    if (!run) throw new Error(`run not found: ${id}`);
    Object.assign(run, patch);
    this.persist();
    return run;
  }

  getRun(id: string): Run | undefined {
    return this.mem.runs.find((r) => r.id === id);
  }

  listRuns(): Run[] {
    return [...this.mem.runs].sort((a, b) => b.createdAt - a.createdAt);
  }

  addSearchCalls(calls: SearchCall[]): void {
    this.mem.searchCalls.push(...calls);
    this.persist();
  }

  findCachedCall(paramsHash: string, runId?: string): SearchCall | undefined {
    return this.mem.searchCalls.find((c) =>
      runId ? c.runId === runId && c.paramsHash === paramsHash : c.paramsHash === paramsHash,
    );
  }

  searchCallsFor(runId: string): SearchCall[] {
    return this.load<SearchCall>("searchCalls", runId);
  }

  addEvidence(rows: Evidence[]): void {
    this.mem.evidence.push(...rows);
    this.persist();
  }

  evidenceFor(runId: string): Evidence[] {
    return this.load<Evidence>("evidence", runId);
  }

  addSignals(rows: Signal[]): void {
    this.mem.signals.push(...rows);
    this.persist();
  }

  signalsFor(runId: string): Signal[] {
    return this.load<Signal>("signals", runId);
  }

  setClusters(runId: string, rows: Cluster[]): void {
    this.mem.clusters = [
      ...this.mem.clusters.filter((c) => c.runId !== runId),
      ...rows,
    ];
    this.persist();
  }

  clustersFor(runId: string): Cluster[] {
    return this.load<Cluster>("clusters", runId);
  }

  addCompetitors(rows: Competitor[]): void {
    this.mem.competitors.push(...rows);
    this.persist();
  }

  competitorsFor(runId: string): Competitor[] {
    return this.load<Competitor>("competitors", runId);
  }

  setGaps(runId: string, rows: Gap[]): void {
    this.mem.gaps = [
      ...this.mem.gaps.filter((g) => g.runId !== runId),
      ...rows,
    ];
    this.persist();
  }

  gapsFor(runId: string): Gap[] {
    return this.load<Gap>("gaps", runId);
  }

  setOpportunities(runId: string, rows: Opportunity[]): void {
    this.mem.opportunities = [
      ...this.mem.opportunities.filter((o) => o.runId !== runId),
      ...rows,
    ];
    this.persist();
  }

  opportunitiesFor(runId: string): Opportunity[] {
    return this.load<Opportunity>("opportunities", runId);
  }

  events(runId: string, events: StepEvent[]): void {
    this.mem.events[runId] = events;
    this.persist();
  }

  appendEvents(runId: string, events: StepEvent[]): void {
    this.mem.events[runId] = [...(this.mem.events[runId] ?? []), ...events];
    this.persist();
  }

  eventsFor(runId: string): StepEvent[] {
    return this.mem.events[runId] ?? [];
  }

  view(runId: string): RunView {
    const run = this.getRun(runId);
    if (!run) throw new Error(`run not found: ${runId}`);
    return {
      run,
      searchCalls: this.searchCallsFor(runId),
      evidence: this.evidenceFor(runId),
      signals: this.signalsFor(runId),
      clusters: this.clustersFor(runId),
      competitors: this.competitorsFor(runId),
      gaps: this.gapsFor(runId),
      opportunities: this.opportunitiesFor(runId),
    };
  }

  recordVoice(): { searchesUsed: number; searchesMonth: number } {
    const calls = this.mem.searchCalls.length;
    return { searchesUsed: calls, searchesMonth: calls };
  }

  serialize(): DBShape {
    return this.mem;
  }
}

export const store = new Store();