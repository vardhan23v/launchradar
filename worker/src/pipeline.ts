/**
 * Fixed research pipeline: plan → discover → extract+validate → cluster → trends →
 * competitors → gap hypothesis → gap verification → score → copy → sceptic.
 * SerpApi supplies every fact; the LLM only plans searches and structures evidence.
 *
 * The pipeline is a resumable step machine: `runUnit` performs ONE unit of work (one search, one
 * LLM call, or one bookkeeping step) and returns the next state. The Durable Object in runner.ts
 * persists that state and runs the next unit in a fresh alarm invocation, so every unit gets the
 * free plan's own CPU, subrequest and D1-query budget instead of sharing one.
 */
import * as config from "./config";
import { verifyQuote } from "./citations";
import { LlmClient, LlmError } from "./llm";
import * as prompts from "./prompts";
import { computeScore } from "./score";
import { BudgetExceeded, SerpApiError, SerpApiService } from "./serpapi";
import type { Store } from "./store";
import type { Cluster, Competitor, Complaint, Evidence, FoundProduct, Gap, Opportunity, Params, Signal, StepEvent } from "./types";
import { isRecord, keepKnownCitations, keyTerms, need, normaliseQuery, nowMs, num, parseSerpDate, str, strList, uniq } from "./utils";

// engines the planner may address with a plain text query
export const QUERY_ENGINES = ["google", "google_news", "google_shopping", "google_jobs", "google_maps", "youtube"];
// rows that are not user voice and must not be mined for signals
export const NON_SIGNAL_BLOCKS = new Set(["suggestion", "trend_point", "rising_query", "related_search"]);
const SIGNAL_TYPES = new Set(["pain", "workaround", "request", "trend", "complaint_about_competitor"]);
const QUESTION_TYPES = new Set(Object.keys(config.ROUTING));
// voice-of-customer first (ARCH §1 #3); ≤3 extractor batches keeps a run near the ≤10 LLM calls of ARCH §9
export const EXTRACT_PRIORITY = ["forum", "related_question", "review", "organic", "news", "place", "product", "job", "app", "ad"];
export const MAX_EXTRACT_ROWS = 120;
const EXTRACT_BATCH = 40;
const CATEGORIES = new Set(["direct", "adjacent", "generic-substitute"]);
const GAP_STATUSES = new Set(["open", "partially-served", "served"]);
// planners sometimes describe a search ("Reddit discussion on X") instead of writing it
const QUERY_LABEL = /^\s*(google\s+news|google|news|reddit|quora|forum|youtube)\b[^:]{0,40}:\s*/i;
const QUERY_LEADIN = /^\s*(reddit|quora|forum)\s+(discussion|thread|question|post)s?\s+(on|about|for)\s+/i;

export type Phase =
  | "classify" | "seed" | "plan" | "discover" | "discovered" | "extract" | "cluster" | "trends"
  | "comp-search" | "comp-llm" | "gaps" | "verify-search" | "verify-llm" | "opportunity" | "skeptic" | "finish" | "done";

export type Bucket = "discovery" | "trends" | "competitors" | "verify";

export interface PlannedQuery {
  q: string;
  engine: string;
}

/** Everything a unit needs from the units before it. Small on purpose: evidence lives in the store. */
export interface PipelineState {
  runId: string;
  question: string;
  region: string;
  startedAt: number;
  phase: Phase;
  /** index of the next unit inside the current phase */
  i: number;
  order: number;
  allowance: Record<Bucket, number>;
  questionType: string | null;
  suggestions: string[];
  queries: PlannedQuery[];
  /** evidence ids per extractor batch, chosen once after discovery */
  batches: string[][];
  rejected: number;
  signals: Signal[];
  clusters: Cluster[];
  /** clusters the competitor pass covers, strongest first */
  compClusters: string[];
  /** evidence ids found by the two competitor searches, per cluster */
  compEvidence: Record<string, string[]>;
  competitors: Competitor[];
  gaps: Gap[];
  /** kill-query evidence ids per gap */
  verifyFound: Record<string, string[]>;
  /** (gap index, kill-query round) pairs, most decisive query of every gap first */
  verifyPlan: [number, number][];
  opportunities: Opportunity[];
  /** cited evidence ids per gap, for the sceptic's evidence block */
  citedByGap: Record<string, string[]>;
  status: "complete" | "failed" | null;
}

export function initialState(runId: string, question: string, region: string): PipelineState {
  return {
    runId, question, region, startedAt: nowMs(), phase: "classify", i: 0, order: 0,
    allowance: { discovery: config.DISCOVERY_SHARE, trends: config.TRENDS_SHARE, competitors: config.COMPETITORS_SHARE, verify: config.GAP_VERIFY_SHARE },
    questionType: null, suggestions: [], queries: [], batches: [], rejected: 0, signals: [], clusters: [], compClusters: [], compEvidence: {},
    competitors: [], gaps: [], verifyFound: {}, verifyPlan: [], opportunities: [], citedByGap: {}, status: null,
  };
}

export interface Ctx {
  store: Store;
  serp: SerpApiService;
  llm: LlmClient;
  settings: config.Settings;
}

export function makeCtx(store: Store, settings: config.Settings, runId: string, serp?: SerpApiService, llm?: LlmClient): Ctx {
  const emit = (e: StepEvent) => store.appendEvents(runId, [e]);
  const s = serp ?? new SerpApiService(store, settings);
  const l = llm ?? new LlmClient(settings);
  s.onEvent = s.onEvent ?? emit;
  l.onEvent = l.onEvent ?? emit;
  return { store, serp: s, llm: l, settings };
}

// ---- small helpers ---------------------------------------------------------

/** A failure the pipeline describes itself, in words safe to show every visitor. */
export class PipelineError extends Error {}

/**
 * Text for the public research log. Run records are readable by anyone, so only messages this
 * code wrote itself are shown (scrubbed of keys once more); anything else, such as a runtime or
 * database error, is replaced by a fixed sentence and its details go to the operator's log.
 */
export function publicMessage(err: unknown, settings: config.Settings, max = 300): string {
  const known = err instanceof PipelineError || err instanceof LlmError || err instanceof BudgetExceeded || err instanceof SerpApiError;
  if (known) return config.scrubSecrets(err.message, settings).slice(0, max);
  console.error("pipeline error", config.scrubSecrets(err instanceof Error ? `${err.name}: ${err.message}` : String(err), settings));
  return "An internal error interrupted this step.";
}

/** Model-written text is stored and shown to everyone: bound it. */
const cap = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 1)}…` : v);
const MIN_QUOTE = 12; // a quote has to say something: "the app" matches almost any row
const MAX_QUOTE = 400;

/** 'Quora question: best X' → 'best X quora'; typographic dashes/quotes → plain ASCII. */
export function cleanQuery(input: string): string {
  let q = input.replace(/‑|–|—/g, "-").replace(/“|”/g, '"').replace(/’/g, "'");
  let site: string | null = null;
  const m = QUERY_LABEL.exec(q) ?? QUERY_LEADIN.exec(q);
  if (m) {
    const word = m[1].toLowerCase();
    site = word === "reddit" || word === "quora" || word === "forum" ? word : null;
    q = q.slice(m[0].length);
  }
  q = q.replace(/\s+/g, " ").replace(/^[ ."']+|[ ."']+$/g, "");
  if (site && !q.toLowerCase().includes(site)) q = `${q} ${site}`;
  return q.slice(0, 150);
}

/** Best rows for the extractor: user-voice block types first, round-robin across searches. */
export function selectForExtraction<T extends { blockType: string; position?: number }>(evidence: T[]): T[] {
  const rank = new Map(EXTRACT_PRIORITY.map((b, i) => [b, i]));
  const ordered = [...evidence].sort((a, b) =>
    (rank.get(a.blockType) ?? 99) - (rank.get(b.blockType) ?? 99) || (a.position ?? 0) - (b.position ?? 0));
  return ordered.slice(0, MAX_EXTRACT_ROWS);
}

function paramsFor(engine: string, q: string): Params {
  if (engine === "youtube") return { search_query: q };
  if (engine === "google_maps") return { q, type: "search" };
  return { q };
}

/** Scraped text may not open or close the evidence block, or fake another row's id. */
function neutral(t: string): string {
  return t.replace(/<\/?\s*evidence\s*>/gi, "[evidence]").replace(/\[(E\d+[a-z]?)\]/g, "($1)").replace(/[\r\n]+/g, " ");
}

function row(e: Evidence): string {
  const text = neutral([e.title, e.snippet].filter(Boolean).join(" — "));
  const date = e.date ? ` · ${e.date.slice(0, 10)}` : "";
  return `[${e.id}] (${e.blockType} · ${e.domain || "n/a"}${date}) ${text}`;
}

const corePhrase = (q: string) => q.trim().split(/\s+/).slice(0, 8).join(" ");

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(v: number): number {
  const f = Math.floor(v);
  const diff = v - f;
  if (diff > 0.5) return f + 1;
  if (diff < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** (mean of last 3 months − mean of first 3 months) / mean of first 3 months, per keyword. */
export function trendSlope(evidence: Evidence[], keyword: string): number | null {
  const key = keyword.toLowerCase();
  const points: [number, number][] = [];
  for (const e of evidence) {
    if (e.blockType !== "trend_point") continue;
    const t = parseSerpDate(e.date);
    const values = isRecord(e.meta) && isRecord(e.meta.values) ? e.meta.values : {};
    const v = values[key];
    if (t !== null && typeof v === "number" && Number.isFinite(v)) points.push([t, v]);
  }
  if (points.length < 8) return null;
  points.sort((a, b) => a[0] - b[0]);
  const quarter = Math.max(1, roundHalfEven(points.length / 4));
  const first = points.slice(0, quarter).reduce((a, p) => a + p[1], 0) / quarter;
  const last = points.slice(-quarter).reduce((a, p) => a + p[1], 0) / quarter;
  if (first <= 0) return last > 0 ? 1.0 : null;
  return (last - first) / first;
}

function byStrength(clusters: Cluster[], signals: Signal[]): Cluster[] {
  const total = (c: Cluster) => signals.filter((s) => c.signalIds.includes(s.id)).reduce((a, s) => a + s.intensity, 0);
  return [...clusters].sort((a, b) => total(b) - total(a));
}

function segmentOf(cluster: Cluster | undefined, signals: Signal[]): string {
  const counts = new Map<string, number>();
  for (const s of signals) {
    if (cluster && cluster.signalIds.includes(s.id) && s.who) counts.set(s.who, (counts.get(s.who) ?? 0) + 1);
  }
  let best: string | null = null, bestN = -1;
  for (const [who, n] of counts) if (n > bestN) [best, bestN] = [who, n];
  return best ?? "people asking this question";
}

class Pipeline {
  constructor(private readonly ctx: Ctx, private readonly s: PipelineState) {}

  why(err: unknown, max: number): string {
    return publicMessage(err, this.ctx.settings, max);
  }

  stage(stage: string, message: string, level: "info" | "ok" | "warn" | "error" = "info"): Promise<void> {
    return this.ctx.store.appendEvents(this.s.runId, [{ type: "stage", stage, message, level }]);
  }

  /** One budgeted search. A failure is logged to the trace and the run continues. */
  async search(bucket: Bucket, stage: string, engine: string, params: Params): Promise<Evidence[]> {
    if (this.s.allowance[bucket] <= 0) return [];
    this.s.allowance[bucket] -= 1;
    this.s.order += 1;
    try {
      return (await this.ctx.serp.search(engine, params, this.s.runId, stage, this.s.order, this.s.region)).evidence;
    } catch (err) { // the client already recorded the failed/skipped call
      await this.stage(stage, this.why(err, 200), "warn");
      return [];
    }
  }

  private next(phase: Phase): void {
    this.s.phase = phase;
    this.s.i = 0;
  }

  // ---- planner -------------------------------------------------------------

  async classify(): Promise<void> {
    await this.stage("planner", "Planning research — classifying market type, seeding from autocomplete");
    this.s.questionType = await this.ctx.llm.complete("planner", "Classifying market type", prompts.classifyPrompt(this.s.question), (v) => {
      const t = need(v, "type");
      if (typeof t !== "string" || !QUESTION_TYPES.has(t)) throw new Error(`type must be one of ${[...QUESTION_TYPES].sort().join(", ")}`);
      return t;
    });
    await this.ctx.store.updateRun(this.s.runId, { questionType: this.s.questionType });
    this.next("seed");
  }

  private seedPhrases(): string[] {
    return uniq([corePhrase(this.s.question), this.s.question.trim()].filter(Boolean)).slice(0, config.AUTOCOMPLETE_SEEDS);
  }

  async seed(): Promise<void> {
    const phrases = this.seedPhrases();
    if (this.s.i < phrases.length) {
      const ev = await this.search("discovery", "autocomplete-seed", "google_autocomplete", { q: phrases[this.s.i].slice(0, 80) });
      this.s.suggestions = uniq([...this.s.suggestions, ...ev.map((e) => e.title).filter(Boolean).slice(0, 8)]);
      this.s.i += 1;
    }
    if (this.s.i >= phrases.length) this.next("plan");
  }

  async plan(): Promise<void> {
    const n = this.s.allowance.discovery;
    const allowed = (config.ROUTING[this.s.questionType ?? ""] ?? []).filter((e) => QUERY_ENGINES.includes(e)); // routing is code, not LLM
    const domainTerms = new Set(keyTerms(this.s.question));
    for (const sug of this.s.suggestions) for (const t of keyTerms(sug)) domainTerms.add(t);

    let planned: PlannedQuery[] = [];
    try {
      planned = await this.ctx.llm.complete("planner", "Building discovery queries", prompts.planPrompt(
        this.s.question, config.regionName(this.s.region), this.s.questionType ?? "", allowed.join(", "),
        this.s.suggestions.join("; ") || "(none)", n), (v) => {
        const out: PlannedQuery[] = [];
        const queries = need(v, "queries");
        if (!Array.isArray(queries)) throw new Error("queries must be a list");
        for (const q of queries) {
          const text = isRecord(q) ? cleanQuery(str(q.q)) : "";
          if (text) {
            const engine = isRecord(q) ? q.engine : null;
            out.push({ q: text, engine: typeof engine === "string" && allowed.includes(engine) ? engine : "google" }); // unknown engine → google
          }
        }
        if (!out.length) throw new Error("queries must contain at least one query");
        return out;
      });
    } catch (err) {
      await this.stage("planner", `Planner failed, using template queries: ${this.why(err, 120)}`, "warn");
    }

    const seen = new Set<string>();
    const dedupe = (items: PlannedQuery[]) => {
      const out: PlannedQuery[] = [];
      for (const q of items) {
        const key = `${q.engine}:${normaliseQuery(q.q)}`;
        if (normaliseQuery(q.q) && !seen.has(key)) {
          seen.add(key);
          out.push(q);
        }
      }
      return out;
    };
    // guardrail: a query must share a domain term with the question or its autocomplete phrasing
    const onTopic = dedupe(planned).filter((q) => keyTerms(q.q).some((t) => domainTerms.has(t)));
    const core = corePhrase(this.s.question);
    const templates: PlannedQuery[] = [
      { q: `${core} problems`, engine: "google" }, { q: `${core} reddit`, engine: "google" },
      { q: `${core} complaints review`, engine: "google" }, { q: `why is ${core} so hard`, engine: "google" },
      { q: `${core} alternatives`, engine: "google" },
      { q: core, engine: allowed.includes("google_news") ? "google_news" : "google" },
    ];
    this.s.queries = [...onTopic, ...dedupe(templates)].slice(0, n);
    await this.stage("discovery", `Discovery pass — ${this.s.queries.length} queries`);
    this.next("discover");
  }

  // ---- discovery -----------------------------------------------------------

  async discover(): Promise<void> {
    if (this.s.i < this.s.queries.length && this.s.allowance.discovery > 0) {
      const q = this.s.queries[this.s.i];
      await this.search("discovery", "discovery", q.engine, paramsFor(q.engine, q.q));
      this.s.i += 1;
    }
    if (this.s.i >= this.s.queries.length || this.s.allowance.discovery <= 0) this.next("discovered");
  }

  async discovered(): Promise<void> {
    const discovered = (await this.ctx.store.evidenceFor(this.s.runId)).filter((e) => !NON_SIGNAL_BLOCKS.has(e.blockType));
    if (discovered.length < config.MIN_DISCOVERY_EVIDENCE) {
      // say the real reason: a quota guard, not the user's question
      const calls = await this.ctx.store.searchCallsFor(this.s.runId);
      const skipped = calls.filter((c) => c.status === "skipped");
      if (skipped.length && skipped.length >= Math.floor(calls.length / 2)) {
        throw new PipelineError((await this.ctx.store.quotaBlock()) ?? "Searches were skipped by a budget guard.");
      }
      throw new PipelineError(`Discovery yielded only ${discovered.length} evidence rows (< ${config.MIN_DISCOVERY_EVIDENCE}). Try a broader question.`);
    }
    const rows = selectForExtraction(discovered);
    this.s.batches = [];
    for (let offset = 0; offset < rows.length; offset += EXTRACT_BATCH) this.s.batches.push(rows.slice(offset, offset + EXTRACT_BATCH).map((e) => e.id));
    await this.stage("signals", "Extracting market signals from evidence");
    this.next("extract");
  }

  // ---- extract + validate --------------------------------------------------

  async extract(): Promise<void> {
    const all = await this.ctx.store.evidenceFor(this.s.runId);
    const byId = new Map(all.map((e) => [e.id, e]));
    const batch = (this.s.batches[this.s.i] ?? []).map((id) => byId.get(id)).filter((e): e is Evidence => e !== undefined);
    let raw: Record<string, unknown>[] = [];
    try {
      raw = await this.ctx.llm.complete("extract", `Extracting signals (${batch.length} rows)`,
        prompts.extractPrompt(this.s.question, batch.map(row).join("\n")), (v) => {
          const good: Record<string, unknown>[] = [];
          const signals = need(v, "signals");
          if (!Array.isArray(signals)) throw new Error("signals must be a list");
          for (const sig of signals) { // tolerate individually malformed signals, keep the batch
            if (!isRecord(sig)) continue;
            const intensity = num(sig.intensity);
            const ids = strList(sig.evidenceIds);
            if (typeof sig.type === "string" && SIGNAL_TYPES.has(sig.type) && str(sig.statement) && str(sig.quote) && ids.length
              && intensity !== null && Math.trunc(intensity) >= 1 && Math.trunc(intensity) <= 5) {
              good.push({ ...sig, intensity: Math.trunc(intensity), evidenceIds: ids });
            }
          }
          return good;
        });
    } catch (err) {
      await this.stage("signals", `Batch skipped: ${this.why(err, 140)}`, "warn");
    }
    const seen = new Set(this.s.signals.map((x) => normaliseQuery(x.statement)));
    for (const sig of raw) {
      const ids = strList(sig.evidenceIds);
      const quote = str(sig.quote);
      // the validator is the gate: unknown id, non-verbatim or trivially short quote → dropped and counted
      if (quote.length < MIN_QUOTE || quote.length > MAX_QUOTE || !verifyQuote(ids, quote, batch)[0]) {
        this.s.rejected += 1;
        continue;
      }
      const statement = cap(str(sig.statement), 400);
      const key = normaliseQuery(statement);
      if (seen.has(key)) continue;
      seen.add(key);
      const signal: Signal = {
        id: `S${this.s.signals.length + 1}`, // assigned after validation: dense and unique
        runId: this.s.runId, type: sig.type as string, statement, intensity: sig.intensity as number, evidenceIds: ids.slice(0, 4), quote,
        domains: uniq(ids.map((i) => byId.get(i)?.domain ?? "").filter(Boolean)),
      };
      if (str(sig.who)) signal.who = cap(str(sig.who), 120);
      this.s.signals.push(signal);
    }
    this.s.i += 1;
    if (this.s.i < this.s.batches.length) return;

    const run = await this.ctx.store.getRun(this.s.runId);
    await this.ctx.store.updateRun(this.s.runId, { rejectedSignals: (run?.rejectedSignals ?? 0) + this.s.rejected });
    await this.stage("signals", `${this.s.signals.length} signals kept, ${this.s.rejected} rejected by the citation validator`, "ok");
    if (!this.s.signals.length) throw new PipelineError("No signal survived the citation validator. Try a broader question.");
    await this.ctx.store.addSignals(this.s.runId, this.s.signals);
    this.next("cluster");
  }

  // ---- cluster -------------------------------------------------------------

  async cluster(): Promise<void> {
    await this.stage("cluster", "Clustering signals into problem clusters");
    const lines = this.s.signals.map((s) => `[${s.id}] (${s.type}, intensity ${s.intensity}, ${s.who ?? "?"}) ${s.statement}`).join("\n");
    const raw = await this.ctx.llm.complete("cluster", "Grouping signals", prompts.clusterPrompt(lines), (v) => {
      const clusters = need(v, "clusters");
      if (!Array.isArray(clusters)) throw new Error("clusters must be a list");
      const out = clusters.filter((c): c is Record<string, unknown> => isRecord(c) && Boolean(str(c.name) && str(c.jobToBeDone) && str(c.searchKeyword)));
      if (!out.length) throw new Error("clusters must contain at least one valid cluster");
      return out;
    });
    const byId = new Map(this.s.signals.map((s) => [s.id, s]));
    const taken = new Set<string>();
    const clusters: Cluster[] = [];
    for (const c of raw.slice(0, 7)) {
      // every signal in at most one cluster; unknown ids are discarded
      const ids = uniq(strList(c.signalIds)).filter((i) => byId.has(i) && !taken.has(i));
      if (!ids.length) continue;
      for (const i of ids) taken.add(i);
      const domains = new Set(ids.flatMap((i) => byId.get(i)?.domains ?? []));
      clusters.push({
        id: `C${clusters.length + 1}`, runId: this.s.runId, name: cap(str(c.name), 160), jobToBeDone: cap(str(c.jobToBeDone), 400),
        // the keyword is sent to Google Trends with the operator's key: same cleaning as planner queries
        searchKeyword: cleanQuery(str(c.searchKeyword).replace(/,/g, " ")).slice(0, 80) || cap(str(c.name), 80), signalIds: ids, weak: ids.length < 2 || domains.size < 2,
      });
    }
    if (!clusters.length) throw new PipelineError("Clustering produced no usable cluster.");
    await this.stage("cluster", `${clusters.length} clusters (${clusters.filter((c) => c.weak).length} weak)`, "ok");
    this.s.clusters = clusters;
    await this.ctx.store.setClusters(this.s.runId, clusters);
    this.next("trends");
  }

  // ---- trends --------------------------------------------------------------

  async trends(): Promise<void> {
    const ordered = byStrength(this.s.clusters, this.s.signals);
    // one TIMESERIES call compares up to 5 cluster keywords; RELATED_QUERIES takes exactly one
    const keywords = uniq(ordered.map((c) => c.searchKeyword.toLowerCase())).slice(0, 5);
    if (this.s.i === 0 && ordered.length) {
      await this.stage("trends", "Google Trends — 12-month interest and rising queries");
      await this.search("trends", "trends", "google_trends", { q: keywords.join(","), data_type: "TIMESERIES", date: "today 12-m" });
      this.s.i = 1;
      return;
    }
    if (this.s.i === 1 && ordered.length) {
      await this.search("trends", "trends", "google_trends", { q: keywords[0], data_type: "RELATED_QUERIES", date: "today 12-m" });
    }
    await this.stage("competitors", "Competitor pass — searching for existing products");
    this.s.compClusters = ordered.slice(0, 3).map((c) => c.id);
    this.next("comp-search");
  }

  // ---- competitors ---------------------------------------------------------

  private compKeyword(cluster: Cluster): string {
    // cluster keywords often already start with "best" or end with "app"
    return cluster.searchKeyword.trim().replace(/^(best|top)\s+|\s+apps?$/gi, "");
  }

  async compSearch(): Promise<void> {
    // unit i: cluster i>>1, query i&1 (0 = "best … app", 1 = "… alternatives")
    const total = this.s.compClusters.length * 2;
    if (this.s.i < total) {
      const cluster = this.s.clusters.find((c) => c.id === this.s.compClusters[this.s.i >> 1]);
      if (cluster) {
        const kw = this.compKeyword(cluster);
        const ev = await this.search("competitors", "competitors", "google", { q: this.s.i % 2 === 0 ? `best ${kw} app` : `${kw} alternatives` });
        const found = this.s.compEvidence[cluster.id] ?? [];
        this.s.compEvidence[cluster.id] = [...found, ...ev.filter((e) => !NON_SIGNAL_BLOCKS.has(e.blockType)).map((e) => e.id)];
      }
      this.s.i += 1;
    }
    if (this.s.i >= total) this.next("comp-llm");
  }

  async compLlm(): Promise<void> {
    if (this.s.i < this.s.compClusters.length) {
      const cluster = this.s.clusters.find((c) => c.id === this.s.compClusters[this.s.i]);
      this.s.i += 1;
      if (cluster) await this.competitorsFor(cluster);
      if (this.s.i < this.s.compClusters.length) return;
    }
    await this.stage("competitors", `${this.s.competitors.length} competitors, each traced to an evidence row`, "ok");
    await this.ctx.store.addCompetitors(this.s.runId, this.s.competitors);
    this.next("gaps");
  }

  private async competitorsFor(cluster: Cluster): Promise<void> {
    const wanted = new Set(this.s.compEvidence[cluster.id] ?? []);
    if (!wanted.size) return;
    const ev = (await this.ctx.store.evidenceFor(this.s.runId)).filter((e) => wanted.has(e.id));
    if (!ev.length) return;
    const needs = this.s.signals.filter((s) => cluster.signalIds.includes(s.id)).map((s) => s.statement).join("; ");
    let raw: Record<string, unknown>[];
    try {
      raw = await this.ctx.llm.complete("competitors", `Competitors for "${cluster.name}"`, prompts.competitorPrompt(
        cluster.name, cluster.jobToBeDone, needs, ev.map(row).join("\n")), (v) => {
        const comps = need(v, "competitors");
        if (!Array.isArray(comps)) throw new Error("competitors must be a list");
        return comps.filter((c): c is Record<string, unknown> => isRecord(c) && Boolean(str(c.name)));
      });
    } catch (err) {
      await this.stage("competitors", `Skipped "${cluster.name}": ${this.why(err, 120)}`, "warn");
      return;
    }

    const evById = new Map(ev.map((e) => [e.id, e]));
    for (const c of raw) {
      // a competitor must originate from an evidence row, never from LLM memory:
      // its name has to literally appear in one of the rows it cites
      const name = cap(str(c.name), 120);
      const needle = name.toLowerCase();
      const cited = strList(c.evidenceIds).filter((i) => evById.has(i));
      if (needle.length < 2 || !cited.some((i) => {
        const e = evById.get(i) as Evidence;
        return `${e.title} ${e.snippet} ${e.url}`.toLowerCase().includes(needle);
      })) continue;
      const complaints: Complaint[] = [];
      const quoted = new Set<string>();
      for (const x of Array.isArray(c.complaints) ? c.complaints : []) {
        if (!isRecord(x) || !str(x.text) || typeof x.evidenceId !== "string") continue;
        const quote = str(x.quote);
        // one verbatim quote is one complaint, even when the model repeats it
        if (quote.length < MIN_QUOTE || quote.length > MAX_QUOTE || quoted.has(normaliseQuery(quote)) || !verifyQuote([x.evidenceId], quote, ev)[0]) continue;
        quoted.add(normaliseQuery(quote));
        complaints.push({ text: cap(str(x.text), 300), evidenceId: x.evidenceId, quote });
      }
      let rating = num(c.rating), reviews = num(c.reviewCount);
      rating = rating !== null && rating >= 0 && rating <= 5 ? rating : null;
      reviews = reviews !== null && reviews >= 0 ? Math.round(reviews) : null;
      // the link must be one of the pages the competitor was found on, never a model-made address
      const host = (u: string) => {
        try {
          return /^https?:\/\//i.test(u) ? new URL(u).hostname.replace(/^www\./, "") : "";
        } catch {
          return "";
        }
      };
      const citedHosts = new Set(cited.map((i) => host((evById.get(i) as Evidence).url)).filter(Boolean));
      const url = typeof c.url === "string" && host(c.url) && citedHosts.has(host(c.url)) ? c.url.slice(0, 500) : null;
      const pricing = cap(str(c.pricing), 120) || null;
      const category = typeof c.category === "string" && CATEGORIES.has(c.category) ? c.category : "adjacent";

      const existing = this.s.competitors.find((x) => x.name.toLowerCase() === needle);
      if (existing) {
        existing.evidenceIds = uniq([...existing.evidenceIds, ...cited]);
        existing.clusterIds = uniq([...existing.clusterIds, cluster.id]);
        existing.coveredNeeds = uniq([...existing.coveredNeeds, ...strList(c.coveredNeeds).map((n) => cap(n, 200))]).slice(0, 12);
        // the same page resurfaces under other searches with a new evidence id;
        // one verbatim quote is one complaint, however often it is found
        const known = new Set(existing.complaints.map((y) => normaliseQuery(y.quote)));
        existing.complaints.push(...complaints.filter((x) => !known.has(normaliseQuery(x.quote))));
        existing.pricing = existing.pricing || pricing;
        existing.rating = existing.rating !== null ? existing.rating : rating;
        existing.reviewCount = existing.reviewCount !== null ? existing.reviewCount : reviews;
        continue;
      }
      this.s.competitors.push({
        id: `CO${this.s.competitors.length + 1}`, runId: this.s.runId, name, url, category, pricing, rating, reviewCount: reviews,
        coveredNeeds: uniq(strList(c.coveredNeeds).map((n) => cap(n, 200))).slice(0, 12), complaints, evidenceIds: cited, clusterIds: [cluster.id],
      });
    }
  }

  // ---- gaps ----------------------------------------------------------------

  async gaps(): Promise<void> {
    let gaps: Gap[] = [];
    try {
      gaps = await this.gapHypothesis();
    } catch (err) {
      // the problems and competitors found so far are still worth showing
      await this.stage("gaps", `Gap analysis skipped: ${this.why(err, 160)}`, "warn");
    }
    this.s.gaps = gaps;
    await this.ctx.store.setGaps(this.s.runId, gaps);
    // most decisive kill query per gap first; spare budget goes to second queries
    this.s.verifyPlan = [];
    for (const rnd of [0, 1]) gaps.forEach((g, gi) => { if (rnd < g.killQueries.length) this.s.verifyPlan.push([gi, rnd]); });
    if (gaps.length) await this.stage("verify", "Gap verification — running kill queries");
    this.next(gaps.length ? "verify-search" : "opportunity");
    if (!gaps.length) await this.stage("score", "Scoring opportunities (deterministic, no LLM)");
  }

  private async gapHypothesis(): Promise<Gap[]> {
    await this.stage("gaps", "Hypothesising gaps and the searches most likely to disprove them");
    const clusterLines = this.s.clusters.map((c) => {
      const sigs = this.s.signals.filter((s) => c.signalIds.includes(s.id));
      const domains = new Set(sigs.flatMap((s) => s.domains));
      const body = sigs.map((s) => `    - ${s.statement} [${s.evidenceIds.join(",")}]`).join("\n");
      return `[${c.id}] ${c.name} — ${c.jobToBeDone} (${sigs.length} signals, ${domains.size} domains${c.weak ? ", WEAK" : ""})\n${body}`;
    });
    const compLines = this.s.competitors.map((c) =>
      `${c.name} (${c.category}; clusters ${c.clusterIds.join(",")}) [${c.evidenceIds.join(",")}] covers: ${c.coveredNeeds.join("; ") || "unknown"} | complaints: ${
        c.complaints.map((x) => `${x.text} [${x.evidenceId}]`).join("; ") || "none found"}`).join("\n") || "(no competitors found in evidence)";

    const raw = await this.ctx.llm.complete("gaps", "Proposing candidate gaps", prompts.gapPrompt(clusterLines.join("\n"), compLines), (v) => {
      const gaps = need(v, "gaps");
      if (!Array.isArray(gaps)) throw new Error("gaps must be a list");
      return gaps.filter((g): g is Record<string, unknown> => isRecord(g) && Boolean(str(g.unmetNeed) && str(g.whyExistingFail)));
    });
    const known = new Set((await this.ctx.store.evidenceFor(this.s.runId)).map((e) => e.id));
    const clusterIds = new Set(this.s.clusters.map((c) => c.id));
    const gaps: Gap[] = [];
    for (const g of raw) {
      const clusterId = str(g.clusterId).replace(/^\[+|\]+$/g, "");
      // kill queries are searched with the operator's key: cleaned and bounded like planner queries
      const kill = uniq(strList(g.killQueries).map((q) => cleanQuery(q)).filter(Boolean)).slice(0, 3);
      if (!clusterIds.has(clusterId) || !kill.length) continue;
      gaps.push({
        id: `G${gaps.length + 1}`, runId: this.s.runId, clusterId, unmetNeed: cap(str(g.unmetNeed), 400), whyExistingFail: cap(str(g.whyExistingFail), 800), status: "open",
        killQueries: kill, foundProducts: [], remainingWedge: null, evidenceIds: strList(g.evidenceIds).filter((i) => known.has(i)),
      });
      if (gaps.length === 5) break;
    }
    await this.stage("gaps", `${gaps.length} candidate gaps`, "ok");
    return gaps;
  }

  async verifySearch(): Promise<void> {
    if (this.s.i < this.s.verifyPlan.length) {
      const [gi, rnd] = this.s.verifyPlan[this.s.i];
      const gap = this.s.gaps[gi];
      if (gap && this.s.allowance.verify > 0) {
        const ev = await this.search("verify", "verify", "google", { q: gap.killQueries[rnd] });
        this.s.verifyFound[gap.id] = [...(this.s.verifyFound[gap.id] ?? []), ...ev.filter((e) => !NON_SIGNAL_BLOCKS.has(e.blockType)).map((e) => e.id)];
      }
      this.s.i += 1;
    }
    if (this.s.i >= this.s.verifyPlan.length) this.next("verify-llm");
  }

  async verifyLlm(): Promise<void> {
    if (this.s.i < this.s.gaps.length) {
      await this.judgeGap(this.s.gaps[this.s.i]);
      this.s.i += 1;
      if (this.s.i < this.s.gaps.length) return;
    }
    await this.ctx.store.setGaps(this.s.runId, this.s.gaps);
    const tally = (status: string) => this.s.gaps.filter((g) => g.status === status).length;
    await this.stage("verify", `${tally("open")} open, ${tally("partially-served")} partially served, ${tally("served")} served (crowded)`, "ok");
    await this.stage("score", "Scoring opportunities (deterministic, no LLM)");
    this.next("opportunity");
  }

  private async judgeGap(gap: Gap): Promise<void> {
    const wanted = new Set(this.s.verifyFound[gap.id] ?? []);
    const ev = wanted.size ? (await this.ctx.store.evidenceFor(this.s.runId)).filter((e) => wanted.has(e.id)) : [];
    if (!ev.length) {
      // an unverified gap must never be presented as open whitespace
      gap.status = "partially-served";
      gap.remainingWedge = "Not verified — the kill query returned no evidence.";
      return;
    }
    try {
      const cluster = this.s.clusters.find((c) => c.id === gap.clusterId);
      const raw = await this.ctx.llm.complete("verify", `Judging gap ${gap.id}`, prompts.verifyPrompt(
        gap.unmetNeed, segmentOf(cluster, this.s.signals), config.regionName(this.s.region), ev.map(row).join("\n")), (v) => {
        const status = need(v, "status");
        if (typeof status !== "string" || !GAP_STATUSES.has(status)) throw new Error(`status must be one of ${[...GAP_STATUSES].sort().join(", ")}`);
        return v as Record<string, unknown> & { status: Gap["status"] };
      });
      const ids = new Set(ev.map((e) => e.id));
      const products = Array.isArray(raw.foundProducts) ? raw.foundProducts : [];
      gap.foundProducts = products
        .filter((p): p is Record<string, unknown> => isRecord(p) && Boolean(str(p.name)) && typeof p.evidenceId === "string" && ids.has(p.evidenceId))
        .map((p): FoundProduct => ({ name: cap(str(p.name), 120), evidenceId: p.evidenceId as string, match: cap(str(p.match), 300) || "found by kill query" }))
        .slice(0, 8);
      // "served" needs at least one product that resolves to kill-query evidence, and a gap with such
      // a product is never "open"
      if (raw.status === "served") gap.status = gap.foundProducts.length ? "served" : "partially-served";
      else if (raw.status === "open") gap.status = gap.foundProducts.length ? "partially-served" : "open";
      else gap.status = raw.status;
      gap.remainingWedge = cap(str(raw.remainingWedge), 400) || null;
    } catch (err) {
      gap.status = "partially-served";
      gap.remainingWedge = "Not verified — the verifier failed.";
      await this.stage("verify", `Gap ${gap.id}: ${this.why(err, 140)}`, "warn");
    }
  }

  // ---- score + copy + sceptic ----------------------------------------------

  async opportunity(): Promise<void> {
    if (this.s.i < this.s.gaps.length) {
      await this.opportunityFor(this.s.gaps[this.s.i]);
      this.s.i += 1;
      if (this.s.i < this.s.gaps.length) return;
    }
    this.s.opportunities.sort((a, b) => b.score - a.score);
    this.s.opportunities.forEach((o, i) => { o.id = `O${i + 1}`; });
    this.next("skeptic");
  }

  private async opportunityFor(gap: Gap): Promise<void> {
    if (gap.status === "served") return; // kept and shown as "crowded", never an opportunity card
    const cluster = this.s.clusters.find((c) => c.id === gap.clusterId);
    if (!cluster) return;
    const evidence = await this.ctx.store.evidenceFor(this.s.runId);
    const evById = new Map(evidence.map((e) => [e.id, e]));
    const known = new Set(evById.keys());
    const now = nowMs();
    const ads = evidence.filter((e) => e.blockType === "ad").length;
    const jobs = evidence.filter((e) => e.blockType === "job").length;
    const news = evidence.filter((e) => e.blockType === "news" && (parseSerpDate(e.date, now) ?? 0) > now - 90 * 86_400_000).length;
    const distinctDomains = new Set(evidence.map((e) => e.domain).filter(Boolean)).size;
    const blockTypes = new Set(evidence.map((e) => e.blockType)).size;

    const sigs = this.s.signals.filter((s) => cluster.signalIds.includes(s.id));
    const relevant = this.s.competitors.filter((c) => c.clusterIds.includes(cluster.id));
    const direct = relevant.filter((c) => c.category === "direct");
    const weak = relevant.length
      ? relevant.filter((c) => (c.rating !== null && c.rating < 4) || c.complaints.length >= 3).length / relevant.length : 0;
    const slope = trendSlope(evidence, cluster.searchKeyword);
    const scored = computeScore({
      signals: sigs.map((s) => ({ intensity: s.intensity, domains: s.domains })), trendSlope: slope, recentNewsCount: news, adsCount: ads,
      hasPricedCompetitors: relevant.some((c) => Boolean(c.pricing)), jobsCount: jobs, gapStatus: gap.status,
      directCompetitors: direct.length + gap.foundProducts.length, weakCompetitorShare: weak, evidenceCount: evidence.length,
      distinctDomains, blockTypeCount: blockTypes,
    });

    const cited = uniq([...sigs.flatMap((s) => s.evidenceIds), ...relevant.flatMap((c) => c.evidenceIds), ...gap.evidenceIds, ...gap.foundProducts.map((p) => p.evidenceId)]);
    const rowIds = cited.filter((i) => evById.has(i)).slice(0, 40);
    const rows = rowIds.map((i) => row(evById.get(i) as Evidence)).join("\n");
    const target = segmentOf(cluster, this.s.signals);
    const cite = (ids: string[]) => {
      const u = uniq(ids).slice(0, 4);
      return u.length ? ` [${u.join(",")}]` : "";
    };
    let copy: Record<string, unknown> = {};
    const fields = ["title", "target", "problem", "existingSolutions", "gap", "pitch", "firstValidationStep"];
    try {
      copy = await this.ctx.llm.complete("opportunity", `Writing opportunity card for "${cluster.name}"`, prompts.opportunityPrompt(JSON.stringify({
        cluster: { name: cluster.name, jobToBeDone: cluster.jobToBeDone }, segment: target,
        signals: sigs.map((s) => ({ statement: s.statement, quote: s.quote, evidenceIds: s.evidenceIds })),
        competitors: relevant.map((c) => ({ name: c.name, category: c.category, pricing: c.pricing, rating: c.rating, complaints: c.complaints.map((x) => x.text), evidenceIds: c.evidenceIds })),
        gap: { unmetNeed: gap.unmetNeed, whyExistingFail: gap.whyExistingFail, status: gap.status, foundProducts: gap.foundProducts, remainingWedge: gap.remainingWedge },
        trendSlope12m: slope,
      }), rows), (v) => {
        for (const f of fields) if (!str(need(v, f))) throw new Error(`${f} must be a non-empty string`);
        return v as Record<string, unknown>;
      });
    } catch (err) {
      await this.stage("opportunity", `Card copy fell back to evidence summary: ${this.why(err, 120)}`, "warn");
    }

    const existingFallback = relevant.map((c) => `${c.name}${cite(c.evidenceIds)}`).join(", ") || "No competitor surfaced in the evidence.";
    this.s.opportunities.push({
      id: "O0", runId: this.s.runId, gapId: gap.id, clusterId: cluster.id,
      title: cap(str(copy.title), 120) || cluster.name, target: cap(str(copy.target), 160) || target,
      problem: cap(keepKnownCitations(str(copy.problem) || sigs.map((s) => `${s.statement}${cite(s.evidenceIds)}`).join(" "), known), 1500),
      existingSolutions: cap(keepKnownCitations(str(copy.existingSolutions) || existingFallback, known), 1500),
      gap: cap(keepKnownCitations(str(copy.gap) || `${gap.unmetNeed}${cite(gap.evidenceIds)}`, known), 1500),
      pitch: cap(keepKnownCitations(str(copy.pitch), known), 400) || "Validate this gap with target users before building.",
      mvpScope: strList(copy.mvpScope).map((m) => cap(keepKnownCitations(m.trim(), known), 300)).filter(Boolean).slice(0, 5),
      firstValidationStep: cap(keepKnownCitations(str(copy.firstValidationStep), known), 400) || "Interview five people from the target segment this week.",
      score: scored.total, subScores: scored.subScores, confidence: scored.confidence, skeptic: [],
    });
    this.s.citedByGap[gap.id] = rowIds;
  }

  async skeptic(): Promise<void> {
    const reviewed = this.s.opportunities.slice(0, 3);
    if (this.s.i < reviewed.length) {
      await this.skepticFor(reviewed[this.s.i]);
      this.s.i += 1;
      if (this.s.i < reviewed.length) return;
    }
    await this.ctx.store.setOpportunities(this.s.runId, this.s.opportunities);
    await this.stage("score", `${this.s.opportunities.length} opportunities ranked`, "ok");
    this.next("finish");
  }

  private async skepticFor(o: Opportunity): Promise<void> {
    const evidence = await this.ctx.store.evidenceFor(this.s.runId);
    const evById = new Map(evidence.map((e) => [e.id, e]));
    const known = new Set(evById.keys());
    const rows = (this.s.citedByGap[o.gapId] ?? []).map((i) => evById.get(i)).filter((e): e is Evidence => e !== undefined).map(row).join("\n");
    try {
      const raw = await this.ctx.llm.complete("skeptic", `Sceptic review of "${o.title}"`, prompts.skepticPrompt(JSON.stringify({
        title: o.title, target: o.target, problem: o.problem, existingSolutions: o.existingSolutions, gap: o.gap, score: o.score, subScores: o.subScores, confidence: o.confidence,
      }), rows), (v) => {
        const objections = need(v, "objections");
        if (!Array.isArray(objections)) throw new Error("objections must be a list");
        return objections.filter((x): x is Record<string, unknown> => isRecord(x) && Boolean(str(x.objection) && str(x.basis) && str(x.wouldChangeMind)));
      });
      o.skeptic = raw.slice(0, 3).map((x) => ({
        objection: cap(str(x.objection), 400), basis: cap(keepKnownCitations(str(x.basis), known), 600), wouldChangeMind: cap(str(x.wouldChangeMind), 400),
        evidenceIds: uniq(strList(x.evidenceIds).filter((i) => known.has(i))).slice(0, 6),
      }));
    } catch (err) {
      await this.stage("skeptic", `Skipped: ${this.why(err, 120)}`, "warn");
    }
  }

  // ---- terminal ------------------------------------------------------------

  async finish(): Promise<void> {
    // the log line first, so a viewer that sees the run turn complete has it; a run already closed
    // (as interrupted) keeps that ending
    await this.stage("done", `Run complete in ${((nowMs() - this.s.startedAt) / 1000).toFixed(1)}s`, "ok");
    if (await this.ctx.store.finishIfRunning(this.s.runId, { status: "complete", finishedAt: nowMs() })) await this.terminal("complete");
    this.s.status = "complete";
    this.next("done");
  }

  async fail(err: unknown): Promise<void> {
    const message = this.why(err, 300);
    if (await this.ctx.store.finishIfRunning(this.s.runId, { status: "failed", error: message, finishedAt: nowMs() })) {
      await this.stage("error", message, "error");
      await this.terminal("failed");
    }
    this.s.status = "failed";
    this.next("done");
  }

  private async terminal(status: "complete" | "failed"): Promise<void> {
    const run = await this.ctx.store.getRun(this.s.runId);
    await this.ctx.store.appendEvents(this.s.runId, [{ type: "status", status }, { type: "done", runId: this.s.runId, searchesUsed: run?.searchesUsed ?? 0 }]);
    this.s.status = status;
    this.next("done");
  }

  async unit(): Promise<void> {
    switch (this.s.phase) {
      case "classify": return this.classify();
      case "seed": return this.seed();
      case "plan": return this.plan();
      case "discover": return this.discover();
      case "discovered": return this.discovered();
      case "extract": return this.extract();
      case "cluster": return this.cluster();
      case "trends": return this.trends();
      case "comp-search": return this.compSearch();
      case "comp-llm": return this.compLlm();
      case "gaps": return this.gaps();
      case "verify-search": return this.verifySearch();
      case "verify-llm": return this.verifyLlm();
      case "opportunity": return this.opportunity();
      case "skeptic": return this.skeptic();
      case "finish": return this.finish();
      case "done": return;
    }
  }
}

/**
 * Performs one unit of work and returns the state to persist. A fatal error inside a unit marks
 * the run failed (the state then reads `done`), exactly where the Python pipeline's outer
 * try/except did; optional stages catch their own errors and log them to the trace.
 */
export async function runUnit(ctx: Ctx, state: PipelineState): Promise<PipelineState> {
  const s: PipelineState = structuredClone(state);
  const pipeline = new Pipeline(ctx, s);
  try {
    await pipeline.unit();
  } catch (err) {
    await pipeline.fail(err);
  }
  return s;
}

/** Runs a whole pipeline to completion in-process (tests and local tooling). */
export async function runPipeline(ctx: Ctx, runId: string, question: string, region: string): Promise<PipelineState> {
  let state = initialState(runId, question, region);
  while (state.phase !== "done") state = await runUnit(ctx, state);
  return state;
}
