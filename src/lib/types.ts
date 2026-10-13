/**
 * Shapes of the JSON the research API returns (worker/src/types.ts is the server side). Types
 * only — the frontend holds no server logic, keys or SerpApi access.
 */
export type GapStatus = "open" | "partially-served" | "served";
export type RunStatus = "queued" | "running" | "complete" | "failed";
export type CallStatus = "ok" | "failed" | "skipped";
/** How much evidence a finished run ended with: "limited" when many searches failed, "empty" when it found nothing. */
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
  /** searches that failed (timed out, refused); older servers leave it out */
  failedSearches?: number;
  /** every search the run made, including failed ones (searchesUsed counts only charged ones) */
  searchCalls?: number;
  /** set by newer servers when the run finishes */
  outcome?: RunOutcome | null;
}

export interface Evidence {
  id: string;
  blockType: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  text?: string;
  date?: string;
  /** what the lookup knew besides the text, e.g. `values` (keyword -> search interest) on a trend_point row */
  meta?: Record<string, unknown>;
}

export interface Signal {
  id: string;
  type: string;
  statement: string;
  who?: string;
  intensity: number;
  quote: string;
  evidenceIds: string[];
  domains: string[];
}

export interface Cluster {
  id: string;
  name: string;
  jobToBeDone: string;
  /** the 2-4 words the trends lookup searched for this group */
  searchKeyword?: string;
  signalIds: string[];
  weak: boolean;
}

export interface Competitor {
  id: string;
  name: string;
  category: string;
  pricing: string | null;
  rating: number | null;
  complaints: { text: string; evidenceId: string; quote: string }[];
}

export interface Gap {
  id: string;
  /** the complaint group this gap came from */
  clusterId?: string;
  unmetNeed: string;
  status: GapStatus;
  killQueries: string[];
  foundProducts: { name: string; evidenceId: string; match: string }[];
  remainingWedge: string | null;
}

export interface Opportunity {
  id: string;
  gapId: string;
  /** the complaint group this idea came from */
  clusterId?: string;
  title: string;
  target: string;
  problem: string;
  existingSolutions: string;
  gap: string;
  pitch: string;
  mvpScope: string[];
  firstValidationStep: string;
  score: number;
  subScores: { pain: number; momentum: number; commercial: number; whitespace: number; weakRivals: number };
  confidence: string;
  skeptic: { objection: string; basis: string; evidenceIds: string[]; wouldChangeMind: string }[];
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

/** Extra frame on the single-request stream: the results so far, so no second request is needed. */
export type LiveFrame = StepEvent | { type: "view"; view: RunView };

export interface RunView {
  run: Run;
  /** kept opaque: the page never reads it, but the Markdown export needs it back */
  searchCalls?: unknown[];
  evidence: Evidence[];
  signals: Signal[];
  clusters: Cluster[];
  competitors: Competitor[];
  gaps: Gap[];
  opportunities: Opportunity[];
}
