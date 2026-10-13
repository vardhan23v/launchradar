/**
 * Shapes shared by the store, the pipeline and the HTTP layer. They mirror the JSON the previous
 * Python API returned, so the frontend (src/lib/types.ts in the repository root) needs no change.
 */

export type RunStatus = "queued" | "running" | "complete" | "failed";
export type CallStatus = "ok" | "failed" | "skipped";
export type GapStatus = "open" | "partially-served" | "served";
/**
 * How much evidence a finished run ended with: "empty" when it found no opportunity, "limited"
 * when a discovery or competitor search failed or the citation validator rejected most signals.
 */
export type RunOutcome = "full" | "limited" | "empty";

export interface Run {
  id: string;
  question: string;
  region: string;
  questionType: string | null;
  status: RunStatus;
  budget: number;
  searchesUsed: number;
  createdAt: number;
  finishedAt: number | null;
  demo: boolean;
  demoLabel: string | null;
  rejectedSignals: number;
  error: string | null;
  /** every search the run made (ok, failed and skipped); `searchesUsed` counts only the billed ones */
  searchCalls: number;
  /** searches with status "failed" (timed out, refused upstream) */
  failedSearches: number;
  /** null until the run finishes (and for interrupted runs) */
  outcome: RunOutcome | null;
  /** when the run last wrote to its log; the watchdog closes a run that is silent for 15 minutes */
  lastProgressAt: number;
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Params = Record<string, unknown>;

/** One normalised search result (before it is given an evidence id). */
export interface Row {
  blockType: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  position: number;
  meta: Record<string, unknown>;
  date?: string;
  text?: string;
}

export interface Evidence extends Row {
  id: string;
  runId: string;
  searchCallId: string;
}

export interface SearchCall {
  id: string;
  runId: string;
  stage: string;
  engine: string;
  /** redacted request params; never the api key */
  params: Params;
  paramsHash: string;
  cached: boolean;
  status: CallStatus;
  latencyMs: number;
  resultCount: number;
  createdAt: number;
  billed: boolean;
  error?: string;
  serpapiSearchId?: string;
}

export interface Signal {
  id: string;
  runId: string;
  type: string;
  statement: string;
  intensity: number;
  evidenceIds: string[];
  quote: string;
  domains: string[];
  who?: string;
}

export interface Cluster {
  id: string;
  runId: string;
  name: string;
  jobToBeDone: string;
  searchKeyword: string;
  signalIds: string[];
  weak: boolean;
}

export interface Complaint {
  text: string;
  evidenceId: string;
  quote: string;
}

export interface Competitor {
  id: string;
  runId: string;
  name: string;
  url: string | null;
  category: string;
  pricing: string | null;
  rating: number | null;
  reviewCount: number | null;
  coveredNeeds: string[];
  complaints: Complaint[];
  evidenceIds: string[];
  clusterIds: string[];
}

export interface FoundProduct {
  name: string;
  evidenceId: string;
  match: string;
}

export interface Gap {
  id: string;
  runId: string;
  clusterId: string;
  unmetNeed: string;
  whyExistingFail: string;
  status: GapStatus;
  killQueries: string[];
  foundProducts: FoundProduct[];
  remainingWedge: string | null;
  evidenceIds: string[];
}

export interface SubScores {
  pain: number;
  momentum: number;
  commercial: number;
  whitespace: number;
  weakRivals: number;
}

export interface Objection {
  objection: string;
  basis: string;
  wouldChangeMind: string;
  evidenceIds: string[];
}

export interface Opportunity {
  id: string;
  runId: string;
  gapId: string;
  clusterId: string;
  title: string;
  target: string;
  problem: string;
  existingSolutions: string;
  gap: string;
  pitch: string;
  mvpScope: string[];
  firstValidationStep: string;
  score: number;
  subScores: SubScores;
  confidence: string;
  skeptic: Objection[];
}

export type StepEvent =
  | { type: "stage"; stage: string; message: string; level: "info" | "ok" | "warn" | "error" }
  | {
      type: "search_call";
      call: { stage: string; engine: string; query: string; resultCount: number; cached: boolean; latencyMs: number; status: CallStatus };
    }
  | { type: "llm"; stage: string; model: string; description: string }
  | { type: "status"; status: RunStatus }
  | { type: "done"; runId: string; searchesUsed: number };

export interface RunView {
  run: Run;
  searchCalls: SearchCall[];
  evidence: Evidence[];
  signals: Signal[];
  clusters: Cluster[];
  competitors: Competitor[];
  gaps: Gap[];
  opportunities: Opportunity[];
}

/** A run as the list reports it: the run plus its idea count (one grouped query for the whole list, never one per run). */
export interface RunListItem extends Run {
  ideas: number;
}

/** What a link preview needs: the run's counts and one sentence about it, never the rows behind them. */
export interface RunMeta {
  id: string;
  question: string;
  region: string;
  status: RunStatus;
  outcome: RunOutcome | null;
  demo: boolean;
  createdAt: number;
  finishedAt: number | null;
  /** opportunities */
  ideas: number;
  /** complaint groups (clusters) */
  complaints: number;
  /** existing products (competitors) */
  products: number;
  /** every search the run made, as `Run.searchCalls` */
  lookups: number;
  failedSearches: number;
  /** one plain sentence in the site's words, e.g. "3 ideas from 24 lookups across 112 web pages." */
  summary: string;
}

export interface DemoFixture {
  slug: string;
  label: string;
  question: string;
  region: string;
  run: Partial<Run>;
  searchCalls: Array<Omit<SearchCall, "runId"> & { runId?: string }>;
  evidence: Array<Omit<Evidence, "runId"> & { runId?: string }>;
  signals: Array<Omit<Signal, "runId"> & { runId?: string }>;
  clusters: Array<Omit<Cluster, "runId"> & { runId?: string }>;
  competitors: Array<Omit<Competitor, "runId" | "clusterIds"> & { runId?: string; clusterIds?: string[] }>;
  gaps: Array<Omit<Gap, "runId"> & { runId?: string }>;
  opportunities: Array<Omit<Opportunity, "runId"> & { runId?: string }>;
  events: StepEvent[];
}
