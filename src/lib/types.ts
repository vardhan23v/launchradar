/**
 * Shapes of the JSON the Python API returns (backend/app). Types only — the
 * frontend holds no server logic, keys or SerpApi access.
 */
export type GapStatus = "open" | "partially-served" | "served";
export type RunStatus = "queued" | "running" | "complete" | "failed";
export type CallStatus = "ok" | "failed" | "skipped";

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
  unmetNeed: string;
  status: GapStatus;
  killQueries: string[];
  foundProducts: { name: string; evidenceId: string; match: string }[];
  remainingWedge: string | null;
}

export interface Opportunity {
  id: string;
  gapId: string;
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
