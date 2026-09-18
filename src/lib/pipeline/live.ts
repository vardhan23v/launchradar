import { z } from "zod";
import { CONFIG, regionName, type Engine, type QuestionType } from "../config";
import { LlmClient } from "../llm/client";
import {
  classifyPrompt,
  clusterPrompt,
  competitorPrompt,
  extractPrompt,
  gapPrompt,
  opportunityPrompt,
  planPrompt,
  skepticPrompt,
  verifyPrompt,
} from "../llm/prompts";
import type {
  Cluster,
  Competitor,
  Evidence,
  Gap,
  Opportunity,
  Signal,
} from "../schemas";
import { ResearchPlanSchema } from "../schemas";
import { SerpApiService } from "../serpapi/client";
import type { Store } from "../store";
import { normaliseQuery, pool } from "../utils";
import { validateSignals } from "../validate/citations";
import { computeScore, type ScoreInput } from "./score";

interface Ctx {
  store: Store;
  serp: SerpApiService;
  llm: LlmClient;
  runId: string;
  question: string;
  region: string;
  order: number;
}

function makeCtx(store: Store, runId: string, question: string, region: string): Ctx {
  return {
    store,
    serp: new SerpApiService(store, (e) => store.appendEvents(runId, [e])),
    llm: new LlmClient(),
    runId,
    question,
    region,
    order: 0,
  };
}

function stageEvent(
  ctx: Ctx,
  stage: string,
  message: string,
  level: "info" | "ok" | "warn" | "error" = "info",
): void {
  ctx.store.appendEvents(ctx.runId, [{ type: "stage", stage, message, level }]);
}

async function nextSearch(
  ctx: Ctx,
  stage: string,
  engine: Engine,
  params: Record<string, unknown>,
): Promise<Evidence[]> {
  ctx.order += 1;
  try {
    const out = await ctx.serp.search(engine, params as never, {
      runId: ctx.runId,
      stage,
      order: ctx.order,
    });
    return out.evidence;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.store.appendEvents(ctx.runId, [
      {
        type: "search_call",
        call: {
          stage,
          engine,
          query: String(params.q ?? params.search_query ?? ""),
          resultCount: 0,
          cached: false,
          latencyMs: 0,
          status: "failed",
        },
      },
    ]);
    ctx.store.appendEvents(ctx.runId, [
      { type: "stage", stage, message: msg.slice(0, 160), level: "warn" },
    ]);
    return [];
  }
}

export async function runLivePipeline(
  store: Store,
  runId: string,
  question: string,
  region: string,
): Promise<void> {
  const ctx = makeCtx(store, runId, question, region);
  const startedAt = Date.now();
  const root = CONFIG; // budget constants
  void root;

  try {
    stageEvent(ctx, "planner", "Planning research - classifying market type, seeding from autocomplete");

    // 1. classify market type
    const classified = await ctx.llm.complete({
      stage: "planner",
      description: "Classifying market type",
      schema: z.object({ type: z.enum(["consumer_app", "physical_product", "local_service", "b2b"]) }),
      prompt: classifyPrompt(question),
    });
    const questionType: QuestionType = classified.type;
    store.updateRun(runId, { questionType });

    // 2. autocomplete seed — real phrasing for the planner
    const suggestions = await seedAutocomplete(ctx, question);

    // 3. planner → queries
    const plan = await ctx.llm.complete({
      stage: "planner",
      description: "Building discovery queries",
      schema: ResearchPlanSchema,
      prompt: planPrompt({
        question,
        regionName: regionName(region),
        questionType,
        engines: "google, google_news, google_trends",
        suggestions: suggestions.join("; ") || "(none)",
        n: CONFIG.discoveryShare,
      }),
    });
    const seen = new Set<string>();
    const queries = plan.queries
      .filter((q) => {
        const nq = normaliseQuery(q.q);
        if (!nq || seen.has(nq)) return false;
        seen.add(nq);
        return true;
      })
      .slice(0, CONFIG.discoveryShare);

    // 4. discovery pass
    stageEvent(ctx, "discovery", `Discovery pass - ${queries.length} queries`, "info");
    const discovered: Evidence[] = [];
    await pool(queries, 3, async (q) => {
      discovered.push(...(await nextSearch(ctx, "discovery", q.engine, { q: q.q })));
    });
    if (discovered.length < 15) {
      throw new Error(`Discovery yielded only ${discovered.length} evidence rows (< 15); run failed.`);
    }

    // 5. signals + citation validation
    const signals = await extractSignals(ctx, discovered);
    store.addSignals(signals);

    // 6. clusters
    const clusters = await clusterSignals(ctx, signals);
    store.setClusters(runId, clusters);

    // 7. trends
    await trendsPass(ctx, clusters);

    // 8. competitors
    const competitors = await competitorPass(ctx, clusters, signals);
    store.addCompetitors(competitors);

    // 9. gap hypothesis
    const gaps = await gapHypothesis(ctx, clusters, competitors);
    store.setGaps(runId, gaps);

    // 10. gap verification (kill queries)
    await verifyPass(ctx, gaps);

    // 11. deterministic scoring + copy + skeptic
    const evidence = store.evidenceFor(runId);
    const metrics = runMetrics(evidence);
    await opportunitiesPass(ctx, clusters, signals, competitors, gaps, metrics);

    store.updateRun(runId, { status: "complete", finishedAt: Date.now() });
    store.appendEvents(ctx.runId, [
      { type: "status", status: "complete" },
      {
        type: "done",
        runId,
        searchesUsed: store.getRun(runId)?.searchesUsed ?? 0,
      },
    ]);
    stageEvent(ctx, "done", `Run complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`, "ok");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    store.updateRun(runId, { status: "failed", error: msg, finishedAt: Date.now() });
    stageEvent(ctx, "error", msg.slice(0, 300), "error");
  }
}

// ---- stage implementations -------------------------------------------------

async function seedAutocomplete(ctx: Ctx, question: string): Promise<string[]> {
  const phrases = [corePhrase(question), question].filter((p) => p.length > 0);
  const suggestions: string[] = [];
  for (const phrase of phrases.slice(0, 2)) {
    const ev = await nextSearch(ctx, "autocomplete-seed", "google_autocomplete", {
      q: phrase.slice(0, 60),
    });
    suggestions.push(...ev.map((e) => e.title).filter(Boolean).slice(0, 8));
  }
  return [...new Set(suggestions)];
}

async function extractSignals(ctx: Ctx, evidence: Evidence[]): Promise<Signal[]> {
  stageEvent(ctx, "signals", "Extracting market signals from evidence", "info");
  const signalShape = z.object({
    type: z.enum(["pain", "workaround", "request", "trend", "complaint_about_competitor"]),
    statement: z.string(),
    who: z.string(),
    intensity: z.number().int().min(1).max(5),
    evidenceIds: z.array(z.string()),
    quote: z.string(),
  });
  const out: Signal[] = [];
  let rejected = 0;

  for (let offset = 0; offset < evidence.length; offset += 40) {
    const batch = evidence.slice(offset, offset + 40);
    const rows = batch
      .map((e) => `[E${numOf(e.id)}] (${e.blockType} · ${e.domain} · ${e.date ?? ""}) ${e.title} — ${e.snippet}`)
      .join("\n");
    const raw = await ctx.llm.complete({
      stage: "extract",
      description: `Extracting signals (batch of ${batch.length})`,
      schema: z.object({ signals: z.array(signalShape) }),
      prompt: extractPrompt(ctx.question, rows),
    });
    const candidates: Signal[] = (raw.signals as z.infer<typeof signalShape>[]).map((s, i) => ({
      id: `S${out.length + i + 1}`,
      runId: ctx.runId,
      type: s.type,
      statement: s.statement,
      who: s.who,
      intensity: s.intensity,
      evidenceIds: s.evidenceIds,
      quote: s.quote,
      domains: s.evidenceIds
        .map((id) => evidence.find((e) => e.id === id)?.domain ?? "")
        .filter(Boolean),
    }));
    const { valid, rejected: rj } = validateSignals(candidates, evidence);
    const validSet = new Set(valid);
    out.push(...candidates.filter((c) => validSet.has(c)));
    rejected += rj;
  }

  const prev = ctx.store.getRun(ctx.runId)?.rejectedSignals ?? 0;
  ctx.store.updateRun(ctx.runId, { rejectedSignals: prev + rejected });
  stageEvent(ctx, "signals", `Signal extraction complete - ${out.length} kept, ${rejected} rejected by citation validator`, "ok");
  return out;
}

async function clusterSignals(ctx: Ctx, signals: Signal[]): Promise<Cluster[]> {
  stageEvent(ctx, "cluster", "Clustering signals into problem clusters", "info");
  const clusterShape = z.object({
    name: z.string(),
    jobToBeDone: z.string(),
    searchKeyword: z.string(),
    signalIds: z.array(z.string()),
  });
  const lines = signals
    .map((s, i) => `[S${i + 1}] (${s.type}, intensity ${s.intensity}, ${s.who ?? "?"}) ${s.statement}`)
    .join("\n");
  const raw = await ctx.llm.complete({
    stage: "cluster",
    description: "Grouping signals",
    schema: z.object({ clusters: z.array(clusterShape), unassigned: z.array(z.string()) }),
    prompt: clusterPrompt(lines),
  });
  const byId = new Map(signals.map((s, i) => [`S${i + 1}`, s]));
  return raw.clusters.map((c: z.infer<typeof clusterShape>, i: number) => {
    const sigs = c.signalIds.map((id) => byId.get(id)).filter((s): s is Signal => Boolean(s));
    const domains = new Set(sigs.flatMap((s) => s.domains).filter(Boolean));
    return {
      id: `C${i + 1}`,
      runId: ctx.runId,
      name: c.name,
      jobToBeDone: c.jobToBeDone,
      searchKeyword: c.searchKeyword,
      signalIds: c.signalIds,
      weak: sigs.length < 2 || domains.size < 2,
    };
  });
}

async function trendsPass(ctx: Ctx, clusters: Cluster[]): Promise<void> {
  const top = [...clusters].sort((a, b) => b.signalIds.length - a.signalIds.length)[0];
  if (!top) return;
  stageEvent(ctx, "trends", "Google Trends - 12-month slope", "info");
  await nextSearch(ctx, "trends", "google_trends", {
    q: top.searchKeyword.slice(0, 60),
    data_type: "TIMESERIES",
    date: "today 12-m",
  });
}

async function competitorPass(ctx: Ctx, clusters: Cluster[], signals: Signal[]): Promise<Competitor[]> {
  stageEvent(ctx, "competitors", "Competitor pass", "info");
  const ordered = [...clusters].sort(
    (a, b) => sumIntensity(b, signals) - sumIntensity(a, signals),
  );
  const compShape = z.object({
    name: z.string(),
    url: z.string().url().nullable(),
    category: z.enum(["direct", "adjacent", "generic-substitute"]),
    pricing: z.string().nullable(),
    rating: z.number().nullable(),
    reviewCount: z.number().nullable(),
    coveredNeeds: z.array(z.string()),
    complaints: z.array(z.object({ text: z.string(), evidenceId: z.string(), quote: z.string() })),
    evidenceIds: z.array(z.string()),
  });
  const out: Competitor[] = [];

  for (const cluster of ordered.slice(0, 3)) {
    const ev = [
      ...(await nextSearch(ctx, "competitors", "google", { q: `best ${cluster.searchKeyword} app` })),
      ...(await nextSearch(ctx, "competitors", "google", { q: `${cluster.searchKeyword} alternatives` })),
    ];
    if (ev.length === 0) continue;
    const needs = cluster.signalIds
      .map((id) => signals.find((s) => s.id === id)?.statement)
      .filter(Boolean)
      .join("; ");
    const rows = ev.map((e) => `[${e.id}] (${e.blockType} · ${e.domain}) ${e.title} — ${e.snippet}`).join("\n");
    const raw = await ctx.llm.complete({
      stage: "competitors",
      description: `Competitors for ${cluster.name}`,
      schema: z.object({ competitors: z.array(compShape) }),
      prompt: competitorPrompt(cluster.name, cluster.jobToBeDone, needs, rows),
    });
    for (const c of raw.competitors as z.infer<typeof compShape>[]) {
      if (!c.evidenceIds.some((id) => ev.some((e) => e.id === id))) continue;
      out.push({
        id: `CO${out.length + 1}`,
        runId: ctx.runId,
        name: c.name,
        url: c.url,
        category: c.category,
        pricing: c.pricing,
        rating: c.rating,
        reviewCount: c.reviewCount,
        coveredNeeds: c.coveredNeeds,
        complaints: c.complaints,
        evidenceIds: c.evidenceIds,
      });
    }
  }
  stageEvent(ctx, "competitors", `${out.length} competitors mapped to evidence`, "ok");
  return out;
}

async function gapHypothesis(
  ctx: Ctx,
  clusters: Cluster[],
  competitors: Competitor[],
): Promise<Gap[]> {
  stageEvent(ctx, "gaps", "Hypothesising gaps with kill queries", "info");
  const gapShape = z.object({
    clusterId: z.string(),
    unmetNeed: z.string(),
    whyExistingFail: z.string(),
    evidenceIds: z.array(z.string()),
    killQueries: z.array(z.string()),
  });
  const clusterLines = clusters.map((c) => `[${c.id}] ${c.name} — ${c.jobToBeDone}`).join("\n");
  const compLines = competitors
    .map((c) => `[${c.id}] ${c.name} covers: ${c.coveredNeeds.join(", ")} complaints: ${c.complaints.length}`)
    .join("\n");
  const raw = await ctx.llm.complete({
    stage: "gaps",
    description: "Proposing candidate gaps",
    schema: z.object({ gaps: z.array(gapShape) }),
    prompt: gapPrompt(clusterLines, compLines),
  });
  return (raw.gaps as z.infer<typeof gapShape>[]).slice(0, 5).map((g, i) => ({
    id: `G${i + 1}`,
    runId: ctx.runId,
    clusterId: g.clusterId,
    unmetNeed: g.unmetNeed,
    whyExistingFail: g.whyExistingFail,
    status: "open" as const,
    killQueries: g.killQueries,
    foundProducts: [],
    remainingWedge: null,
    evidenceIds: g.evidenceIds,
  }));
}

async function verifyPass(ctx: Ctx, gaps: Gap[]): Promise<void> {
  stageEvent(ctx, "verify", "Gap verification - kill queries", "info");
  const vShape = z.object({
    status: z.enum(["open", "partially-served", "served"]),
    foundProducts: z.array(z.object({ name: z.string(), evidenceId: z.string(), match: z.string() })),
    remainingWedge: z.string().nullable(),
  });
  for (const gap of gaps) {
    const kill = gap.killQueries[0];
    if (!kill) continue;
    const ev = await nextSearch(ctx, "verify", "google", { q: kill });
    if (ev.length === 0) {
      gap.status = "partially-served";
      ctx.store.setGaps(ctx.runId, ctx.store.gapsFor(ctx.runId));
      continue;
    }
    const rows = ev.map((e) => `[${e.id}] (${e.blockType} · ${e.domain}) ${e.title} — ${e.snippet}`).join("\n");
    const raw = await ctx.llm.complete({
      stage: "verify",
      description: `Judging gap ${gap.id}`,
      schema: vShape,
      prompt: verifyPrompt(gap.unmetNeed, "students", regionName(ctx.region), rows),
    });
    gap.status = raw.status;
    gap.foundProducts = raw.foundProducts;
    gap.remainingWedge = raw.remainingWedge ?? null;
    ctx.store.setGaps(ctx.runId, ctx.store.gapsFor(ctx.runId));
  }
  const tally: Record<string, number> = { open: 0, "partially-served": 0, served: 0 };
  for (const g of gaps) tally[g.status] += 1;
  stageEvent(ctx, "verify", `Verification: ${tally.open} open, ${tally["partially-served"]} partially-served, ${tally.served} served`, "ok");
}

interface RunMetrics {
  adsCount: number;
  recentNewsCount: number;
  jobsCount: number;
  trendSlope: number | null;
}

function runMetrics(evidence: Evidence[]): RunMetrics {
  const adsCount = evidence.filter((e) => e.blockType === "ad").length;
  const jobsCount = evidence.filter((e) => e.blockType === "job").length;
  const cut = Date.now() - 90 * 24 * 3600 * 1000;
  let recentNewsCount = 0;
  for (const e of evidence) {
    if (e.blockType !== "news" || !e.date) continue;
    const t = Date.parse(e.date);
    if (!Number.isNaN(t) && t > cut) recentNewsCount += 1;
  }
  const points = evidence
    .filter((e) => e.blockType === "trend_point")
    .map((e) => ({ t: Date.parse(e.date ?? ""), v: Number((e.meta?.value ?? 0)) }))
    .filter((p) => !Number.isNaN(p.t));
  let trendSlope: number | null = null;
  if (points.length >= 2) {
    const sorted = [...points].sort((a, b) => a.t - b.t);
    const third = Math.max(1, Math.floor(sorted.length / 3));
    const mean = (ns: number[]) => ns.reduce((a, b) => a + b, 0) / ns.length;
    const base = mean(sorted.slice(0, third).map((p) => p.v));
    if (base > 0) trendSlope = (mean(sorted.slice(-third).map((p) => p.v)) - base) / base;
  }
  return { adsCount, recentNewsCount, jobsCount, trendSlope };
}

async function opportunitiesPass(
  ctx: Ctx,
  clusters: Cluster[],
  signals: Signal[],
  competitors: Competitor[],
  gaps: Gap[],
  metrics: RunMetrics,
): Promise<void> {
  stageEvent(ctx, "score", "Scoring opportunities (deterministic)", "info");
  const evidence = ctx.store.evidenceFor(ctx.runId);
  const distinctDomains = new Set(evidence.map((e) => e.domain).filter(Boolean)).size;
  const blockTypeCount = new Set(evidence.map((e) => e.blockType)).size;
  const oppShape = z.object({
    title: z.string(),
    target: z.string(),
    problem: z.string(),
    existingSolutions: z.string(),
    gap: z.string(),
    pitch: z.string(),
    mvpScope: z.array(z.string()),
    firstValidationStep: z.string(),
  });
  const opps: Opportunity[] = [];

  for (const gap of gaps) {
    if (gap.status === "served") continue;
    const cluster = clusters.find((c) => c.id === gap.clusterId);
    if (!cluster) continue;
    const sigs = signals.filter((s) => cluster.signalIds.includes(s.id));
    const relevant = competitors.filter((c) =>
      c.evidenceIds.some((id) => evidence.some((e) => e.id === id)),
    );
    const direct = relevant.filter((c) => c.category === "direct");
    const weakShare =
      relevant.length === 0
        ? 0
        : relevant.filter((c) => (c.rating !== null && c.rating < 4) || c.complaints.length >= 3).length /
          relevant.length;

    const input: ScoreInput = {
      signals: sigs.map((s) => ({ intensity: s.intensity, domains: s.domains })),
      trendSlope: metrics.trendSlope,
      recentNewsCount: metrics.recentNewsCount,
      adsCount: metrics.adsCount,
      hasPricedCompetitors: relevant.some((c) => Boolean(c.pricing)),
      jobsCount: metrics.jobsCount,
      gapStatus: gap.status,
      directCompetitors: direct.length,
      weakCompetitorShare: weakShare,
      evidenceCount: evidence.length,
      distinctDomains,
      blockTypeCount,
    };
    const scored = computeScore(input);

    let copy: z.infer<typeof oppShape> | null = null;
    try {
      const raw = await ctx.llm.complete({
        stage: "opportunity",
        description: `Writing opportunity card for ${cluster.name}`,
        schema: oppShape,
        prompt: opportunityPrompt(
          JSON.stringify({
            cluster: cluster.name,
            gap: gap.unmetNeed,
            status: gap.status,
            signals: sigs.map((s) => s.statement),
            competitors: competitors.map((c) => c.name),
          }),
        ),
      });
      copy = raw as unknown as z.infer<typeof oppShape>;
    } catch {
      copy = null;
    }

    opps.push({
      id: `O${opps.length + 1}`,
      runId: ctx.runId,
      gapId: gap.id,
      clusterId: cluster.id,
      title: copy?.title ?? cluster.searchKeyword,
      target: copy?.target ?? "students",
      problem:
        copy?.problem ??
        `Cluster signals: ${sigs.map((s) => s.statement).join("; ")} [${sigs.map((s) => s.evidenceIds[0]).join(",")}]`,
      existingSolutions:
        copy?.existingSolutions ?? `Competitors found: ${direct.map((c) => c.name).join(", ") || "none direct"}`,
      gap: copy?.gap ?? gap.unmetNeed,
      pitch: copy?.pitch ?? "Validate before building.",
      mvpScope: copy?.mvpScope ?? [],
      firstValidationStep: copy?.firstValidationStep ?? "Interview five potential users this week.",
      score: scored.total,
      subScores: scored.subScores,
      confidence: scored.confidence,
      skeptic: [],
    });
  }

  // skeptic for top 3
  opps.sort((a, b) => b.score - a.score);
  const objShape = z.object({
    objection: z.string(),
    basis: z.string(),
    evidenceIds: z.array(z.string()),
    wouldChangeMind: z.string(),
  });
  for (const o of opps.slice(0, 3)) {
    try {
      const raw = await ctx.llm.complete({
        stage: "skeptic",
        description: `Sceptic review of ${o.title}`,
        schema: z.object({ objections: z.array(objShape) }),
        prompt: skepticPrompt(`${o.title}\nproblem: ${o.problem}\nscore: ${o.score}`),
      });
      o.skeptic = raw.objections.map((x) => ({
        objection: x.objection,
        basis: x.basis,
        evidenceIds: x.evidenceIds,
        wouldChangeMind: x.wouldChangeMind,
      }));
    } catch {
      o.skeptic = [];
    }
  }
  ctx.store.setOpportunities(ctx.runId, opps);
}

function corePhrase(q: string): string {
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  return words.slice(0, 6).join(" ") || q;
}

function numOf(id: string): number {
  const n = Number.parseInt(id.slice(1), 10);
  return Number.isFinite(n) ? n : 0;
}

function sumIntensity(cluster: Cluster, signals: Signal[]): number {
  return signals.filter((s) => cluster.signalIds.includes(s.id)).reduce((a, s) => a + s.intensity, 0);
}