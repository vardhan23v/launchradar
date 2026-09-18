import { z } from "zod";
import { ALL_ENGINES } from "./config";

export const EngineSchema = z.enum(ALL_ENGINES);
export const QuestionTypeSchema = z.enum([
  "consumer_app",
  "physical_product",
  "local_service",
  "b2b",
]);

export const IntentSchema = z.enum(["pain", "trend", "segment"]);

// ---- Planner ----

export const ResearchQuerySchema = z.object({
  q: z.string().min(1),
  engine: EngineSchema,
  intent: IntentSchema,
  rationale: z.string().optional(),
});
export const ResearchPlanSchema = z.object({
  questionType: QuestionTypeSchema.optional(),
  queries: z.array(ResearchQuerySchema).min(1),
});

// ---- Evidence (row-level, persisted) ----

export const BlockTypeSchema = z.enum([
  "organic",
  "related_question",
  "forum",
  "related_search",
  "ad",
  "news",
  "trend_point",
  "rising_query",
  "suggestion",
  "review",
  "product",
  "app",
  "place",
  "job",
]);

export const EvidenceSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  runId: z.string(),
  searchCallId: z.string(),
  blockType: BlockTypeSchema,
  title: z.string(),
  url: z.string().url().or(z.literal("")),
  domain: z.string(),
  snippet: z.string().default(""),
  text: z.string().optional(),
  date: z.string().optional(),
  position: z.number().int().nonnegative().default(0),
  meta: z.record(z.string(), z.unknown()).default({}),
});

// ---- Signals ----

export const SignalTypeSchema = z.enum([
  "pain",
  "workaround",
  "request",
  "trend",
  "complaint_about_competitor",
]);

export const SignalSchema = z.object({
  id: z.string().regex(/^S\d+$/),
  runId: z.string(),
  type: SignalTypeSchema,
  statement: z.string().min(1),
  who: z.string().optional(),
  intensity: z.number().int().min(1).max(5),
  quote: z.string().min(1),
  evidenceIds: z.array(z.string()),
  domains: z.array(z.string()).default([]),
});

// ---- Clusters ----

export const ClusterSchema = z.object({
  id: z.string().regex(/^C\d+$/),
  runId: z.string(),
  name: z.string().min(1),
  jobToBeDone: z.string().min(1),
  searchKeyword: z.string().min(1),
  signalIds: z.array(z.string()),
  weak: z.boolean().default(false),
});

// ---- Competitors ----

export const CompetitorCategorySchema = z.enum([
  "direct",
  "adjacent",
  "generic-substitute",
]);

export const ComplaintSchema = z.object({
  text: z.string().min(1),
  evidenceId: z.string(),
  quote: z.string().min(1),
});

export const CompetitorSchema = z.object({
  id: z.string().regex(/^CO\d+$/),
  runId: z.string(),
  name: z.string().min(1),
  url: z.string().url().nullable(),
  category: CompetitorCategorySchema,
  pricing: z.string().nullable(),
  rating: z.number().min(0).max(5).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  coveredNeeds: z.array(z.string()),
  complaints: z.array(ComplaintSchema),
  evidenceIds: z.array(z.string()),
});

// ---- Gaps ----

export const GapStatusSchema = z.enum([
  "open",
  "partially-served",
  "served",
]);

export const FoundProductSchema = z.object({
  name: z.string().min(1),
  evidenceId: z.string(),
  match: z.string().min(1),
});

export const GapSchema = z.object({
  id: z.string().regex(/^G\d+$/),
  runId: z.string(),
  clusterId: z.string(),
  unmetNeed: z.string().min(1),
  whyExistingFail: z.string().min(1),
  status: GapStatusSchema,
  killQueries: z.array(z.string()),
  foundProducts: z.array(FoundProductSchema).default([]),
  remainingWedge: z.string().nullable(),
  evidenceIds: z.array(z.string()),
});

// ---- Scoring ----

export const SubScoresSchema = z.object({
  pain: z.number().min(0).max(30).default(0),
  momentum: z.number().min(0).max(20).default(0),
  commercial: z.number().min(0).max(20).default(0),
  whitespace: z.number().min(0).max(20).default(0),
  weakRivals: z.number().min(0).max(10).default(0),
});

export const ConfidenceSchema = z.enum(["Low", "Med", "High"]);

// ---- Opportunities ----

export const SkepticObjectionSchema = z.object({
  objection: z.string().min(1),
  basis: z.string().min(1),
  evidenceIds: z.array(z.string()),
  wouldChangeMind: z.string().min(1),
});

export const OpportunitySchema = z.object({
  id: z.string().regex(/^O\d+$/),
  runId: z.string(),
  gapId: z.string(),
  clusterId: z.string(),
  title: z.string().min(1),
  target: z.string().min(1),
  problem: z.string().min(1),
  existingSolutions: z.string().min(1),
  gap: z.string().min(1),
  pitch: z.string().min(1),
  mvpScope: z.array(z.string()),
  firstValidationStep: z.string().min(1),
  score: z.number().min(0).max(100),
  subScores: SubScoresSchema,
  confidence: ConfidenceSchema,
  skeptic: z.array(SkepticObjectionSchema).default([]),
});

// ---- SearchCall (persisted trace row) ----

export const SearchCallSchema = z.object({
  id: z.string(),
  runId: z.string(),
  stage: z.string(),
  engine: EngineSchema,
  params: z.record(z.string(), z.unknown()),
  paramsHash: z.string(),
  cached: z.boolean(),
  status: z.enum(["ok", "failed", "skipped"]).default("ok"),
  latencyMs: z.number().int().nonnegative(),
  resultCount: z.number().int().nonnegative().default(0),
  serpapiSearchId: z.string().optional(),
});

// ---- Run ----

export const RunStatusSchema = z.enum([
  "queued",
  "running",
  "complete",
  "failed",
]);

export const RunSchema = z.object({
  id: z.string(),
  question: z.string(),
  region: z.string(),
  questionType: QuestionTypeSchema.nullable().default(null),
  status: RunStatusSchema,
  budget: z.number().int().positive(),
  searchesUsed: z.number().int().nonnegative().default(0),
  createdAt: z.number(),
  finishedAt: z.number().nullable().default(null),
  demo: z.boolean().default(false),
  demoLabel: z.string().nullable().default(null),
  rejectedSignals: z.number().int().nonnegative().default(0),
  error: z.string().nullable().default(null),
});

// ---- Step events (SSE payloads) ----

export const StepEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("stage"),
    stage: z.string(),
    message: z.string(),
    level: z.enum(["info", "ok", "warn", "error"]).default("info"),
  }),
  z.object({
    type: z.literal("search_call"),
    call: z.object({
      stage: z.string(),
      engine: EngineSchema,
      query: z.string(),
      resultCount: z.number().int().nonnegative(),
      cached: z.boolean(),
      latencyMs: z.number().int().nonnegative(),
      status: z.enum(["ok", "failed", "skipped"]),
    }),
  }),
  z.object({
    type: z.literal("llm"),
    stage: z.string(),
    model: z.string(),
    description: z.string(),
  }),
  z.object({
    type: z.literal("status"),
    status: RunStatusSchema,
  }),
  z.object({
    type: z.literal("done"),
    runId: z.string(),
    searchesUsed: z.number().int().nonnegative(),
  }),
]);

export type Engine = z.infer<typeof EngineSchema>;
export type QuestionType = z.infer<typeof QuestionTypeSchema>;
export type ResearchPlan = z.infer<typeof ResearchPlanSchema>;
export type ResearchQuery = z.infer<typeof ResearchQuerySchema>;
export type Evidence = z.infer<typeof EvidenceSchema>;
export type BlockType = z.infer<typeof BlockTypeSchema>;
export type Signal = z.infer<typeof SignalSchema>;
export type SignalType = z.infer<typeof SignalTypeSchema>;
export type Cluster = z.infer<typeof ClusterSchema>;
export type Competitor = z.infer<typeof CompetitorSchema>;
export type CompetitorCategory = z.infer<typeof CompetitorCategorySchema>;
export type Complaint = z.infer<typeof ComplaintSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type GapStatus = z.infer<typeof GapStatusSchema>;
export type FoundProduct = z.infer<typeof FoundProductSchema>;
export type SubScores = z.infer<typeof SubScoresSchema>;
export type Confidence = z.infer<typeof ConfidenceSchema>;
export type Opportunity = z.infer<typeof OpportunitySchema>;
export type SkepticObjection = z.infer<typeof SkepticObjectionSchema>;
export type SearchCall = z.infer<typeof SearchCallSchema>;
export type Run = z.infer<typeof RunSchema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type StepEvent = z.infer<typeof StepEventSchema>;

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