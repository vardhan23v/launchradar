/**
 * Adapter: the real API shapes (src/lib/types.ts) -> the redesigned screens' view models.
 *
 * This is the only place that knows both vocabularies, so the screens stay pure. Everything mapped
 * here comes from data the backend already produces: no field is invented.
 */

import type { Evidence, Gap, Opportunity, Run, RunView, StepEvent } from "@/lib/types";
import { citeGroups } from "@/lib/evidence";
import type {
  CoverageVM,
  DensityVM,
  EvidenceVM,
  GapVM,
  LogEntryVM,
  MetricVM,
  OpportunityVM,
  RunVM,
  StageVM,
  ThemeVM,
} from "./viewModel";

/** The run budget the serverless host enforces (seconds), used by the progress ring. */
export const RUN_BUDGET_SECONDS = 270;

/* ------------------------------------------------------------------ stages */

interface StageDef {
  id: string;
  label: string;
  /** Stage keys the backend emits for this step (mirrors the report view's pipeline). */
  keys: string[];
}

export const PIPELINE: StageDef[] = [
  { id: "plan", label: "Plan", keys: ["planner", "autocomplete-seed"] },
  { id: "discover", label: "Discover", keys: ["discovery"] },
  { id: "extract", label: "Extract", keys: ["signals", "extract"] },
  { id: "cluster", label: "Cluster", keys: ["cluster", "trends"] },
  { id: "competitors", label: "Competitors", keys: ["competitors"] },
  { id: "verify", label: "Verify", keys: ["gaps", "verify"] },
  { id: "score", label: "Score", keys: ["score", "opportunity", "skeptic", "done"] },
];

const STAGE_LABELS: Record<string, string> = {
  planner: "Plan",
  "autocomplete-seed": "Plan",
  discovery: "Discover",
  signals: "Extract",
  extract: "Extract",
  cluster: "Cluster",
  trends: "Cluster",
  competitors: "Competitors",
  gaps: "Verify",
  verify: "Verify",
  score: "Score",
  opportunity: "Score",
  skeptic: "Score",
  done: "Score",
};

function stageKeyOf(e: StepEvent): string | null {
  if (e.type === "stage" || e.type === "llm") return e.stage;
  if (e.type === "search_call") return e.call.stage;
  return null;
}

function pipelineIndex(stageKey: string): number {
  return PIPELINE.findIndex((p) => p.keys.includes(stageKey));
}

/** Where the run is, derived purely from the event log, exactly as the report view does. */
export function stagesFromEvents(events: StepEvent[], status: Run["status"], view?: RunView): StageVM[] {
  let reached = -1;
  for (const e of events) {
    const key = stageKeyOf(e);
    if (!key) continue;
    const i = pipelineIndex(key);
    if (i > reached) reached = i;
  }

  const errored = new Set<string>();
  // a warn-level stage message mentioning a skip is the backend's way of saying a stage was
  // skipped (wholly or partly) — usually to fit the time budget. It is never "done".
  const skipNotes = new Map<string, string>();
  for (const e of events) {
    if (e.type !== "stage") continue;
    const i = pipelineIndex(e.stage);
    if (i < 0) continue;
    if (e.level === "error") errored.add(PIPELINE[i].id);
    else if (e.level === "warn" && /skip/i.test(e.message) && !skipNotes.has(PIPELINE[i].id)) {
      skipNotes.set(PIPELINE[i].id, e.message);
    }
  }

  /** Did the skipped stage leave anything in the run? "Gap analysis skipped" with zero gaps is a
   * whole missing stage; "Skipped one cluster" with four competitors left is only a part. */
  const stageLeftNothing = (id: string): boolean => {
    if (!view) return false;
    if (id === "verify") return view.gaps.length === 0;
    if (id === "competitors") return view.competitors.length === 0;
    if (id === "score") return view.opportunities.every((o) => o.skeptic.length === 0);
    return false;
  };

  const complete = status === "complete";
  const finished = complete || status === "failed";
  return PIPELINE.map((p, i) => {
    let state: StageVM["status"];
    let detail: string | undefined;
    const skip = skipNotes.get(p.id);
    if (errored.has(p.id)) {
      state = "failed";
      detail = "This stage reported an error; later stages did not run.";
    } else if (skip && stageLeftNothing(p.id)) {
      state = "skipped";
      detail = skip;
    } else if (complete || (finished && i < reached)) {
      state = "done";
      // the stage ran, but part of it was skipped: keep the reason visible
      if (skip) detail = skip;
    } else if (i === reached && status === "running") {
      state = "active";
    } else if (i === reached && status === "failed") {
      state = "failed";
    } else if (finished && i >= reached) {
      state = "skipped";
      detail = "The run ended before this stage could run.";
    } else {
      state = "pending";
    }
    const stage: StageVM = { id: p.id, label: p.label, status: state };
    if (state === "failed") stage.detail = detail ?? "This stage reported an error; later stages did not run.";
    else if (detail) stage.detail = detail;
    return stage;
  });
}

/** The research log: search calls with engine, result count and latency, plus stage errors. */
export function logFromEvents(events: StepEvent[]): LogEntryVM[] {
  const out: LogEntryVM[] = [];
  events.forEach((e, i) => {
    if (e.type === "search_call") {
      const bad = e.call.status !== "ok";
      out.push({
        id: `search-${i}`,
        kind: "search",
        title: e.call.query,
        meta: bad
          ? `${e.call.engine} · ${e.call.status}`
          : `${e.call.engine} · ${e.call.resultCount} results · ${
              e.call.cached ? "cached" : `${(e.call.latencyMs / 1000).toFixed(1)}s`
            }`,
        tone: bad ? "bad" : "ok",
      });
      return;
    }
    if (e.type === "stage" && e.level !== "info") {
      out.push({
        id: `note-${i}`,
        kind: "note",
        title: e.message,
        tone: e.level === "error" ? "bad" : e.level === "warn" ? "warn" : "ok",
      });
      return;
    }
    if (e.type === "stage") {
      out.push({ id: `stage-${i}`, kind: "stage", title: STAGE_LABELS[e.stage] ?? e.stage });
    }
    // `llm` frames are implementation detail; the stage lines already tell the story.
  });
  return out;
}

export function searchTotals(events: StepEvent[]): { ok: number; failed: number } {
  let ok = 0;
  let failed = 0;
  for (const e of events) {
    if (e.type !== "search_call") continue;
    if (e.call.status === "ok") ok += 1;
    else failed += 1;
  }
  return { ok, failed };
}

/* ------------------------------------------------------------------ regions */

/** The backend takes short codes; the redesigned form shows the names the site already uses. */
export const V2_REGIONS: { code: string; label: string }[] = [
  { code: "in", label: "India" },
  { code: "us", label: "United States" },
  { code: "uk", label: "United Kingdom" },
];

export function codeForLabel(label: string): string {
  return V2_REGIONS.find((r) => r.label === label)?.code ?? "in";
}

export function labelForCode(code: string): string {
  return V2_REGIONS.find((r) => r.code === code)?.label ?? code.toUpperCase();
}
/* ------------------------------------------------------------------ row mapping */

const SUB_SCORES: { key: keyof Opportunity["subScores"]; label: string; max: number }[] = [
  { key: "pain", label: "Pain", max: 30 },
  { key: "momentum", label: "Momentum", max: 20 },
  { key: "commercial", label: "Commercial intent", max: 20 },
  { key: "whitespace", label: "Whitespace", max: 20 },
  { key: "weakRivals", label: "Weak rivals", max: 10 },
];

function statusOf(status: Run["status"]): RunVM["status"] {
  return status === "complete" ? "done" : status;
}

function gapVM(gap: Gap): GapVM {
  const vm: GapVM = {
    id: gap.id,
    statement: gap.unmetNeed,
    filled: gap.status === "served",
    status: gap.status,
  };
  if (gap.remainingWedge) vm.note = `What remains: ${gap.remainingWedge}`;
  else if (gap.status === "partially-served") vm.note = "Partially served by an existing product.";
  return vm;
}

function evidenceVMs(ids: string[], byId: Map<string, Evidence>): EvidenceVM[] {
  const seen = new Set<string>();
  const out: EvidenceVM[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const e = byId.get(id);
    if (!e) continue;
    const vm: EvidenceVM = {
      id: e.id,
      quote: e.snippet || e.text || e.title,
      url: e.url,
      domain: e.domain,
    };
    if (e.title) vm.title = e.title;
    // `date` is when the source was published, not when it was retrieved; shown as such
    if (e.date) vm.sourceDate = e.date.slice(0, 10);
    out.push(vm);
  }
  return out;
}

/**
 * Everything the report view shows about a finding is carried over into labelled rows, so the triage
 * board never hides the reasoning behind a score.
 */
function detailRows(o: Opportunity, gap: Gap | undefined): { label: string; text: string }[] {
  const rows: { label: string; text: string }[] = [];
  if (o.target) rows.push({ label: "For", text: o.target });
  rows.push({ label: "Problem", text: o.problem });
  rows.push({ label: "Existing solutions", text: o.existingSolutions });
  rows.push({ label: "The gap", text: o.gap });
  if (gap && gap.foundProducts.length > 0) {
    const found = gap.foundProducts.map((p) => `${p.name} — ${p.match}`).join("; ");
    rows.push({ label: "We looked for it", text: found });
  }
  if (o.mvpScope.length > 0) {
    rows.push({ label: "Smallest test", text: o.mvpScope.map((b, i) => `${i + 1}. ${b}`).join("  ") });
  }
  if (o.firstValidationStep) rows.push({ label: "This week", text: o.firstValidationStep });
  for (const s of o.skeptic) {
    rows.push({
      label: "The case against",
      text: `${s.objection} — ${s.basis} (would change with: ${s.wouldChangeMind})`,
    });
  }
  return rows.filter((r) => r.text.trim().length > 0);
}

function opportunityVM(o: Opportunity, view: RunView, byId: Map<string, Evidence>): OpportunityVM {
  const gap = view.gaps.find((g) => g.id === o.gapId);
  // the prose cites its sources inline as [E1,E2]; those citations must survive into the board,
  // alongside the ones the report view gathers from found products and skeptic objections
  const prose = [o.problem, o.existingSolutions, o.gap, o.pitch, o.firstValidationStep, ...o.mvpScope];
  const cited = prose.flatMap((text) => citeGroups(text).flatMap((g) => g.ids));
  const ids = [
    ...cited,
    ...(gap?.foundProducts ?? []).map((p) => p.evidenceId),
    ...o.skeptic.flatMap((s) => s.evidenceIds),
  ];
  const metrics: MetricVM[] = SUB_SCORES.map((s) => ({
    id: `${o.id}-${s.key}`,
    label: s.label,
    value: o.subScores[s.key],
    max: s.max,
  }));
  return {
    id: o.id,
    name: o.title,
    oneLiner: o.pitch,
    score: o.score,
    metrics,
    evidence: evidenceVMs(ids, byId),
    gaps: gap ? [gapVM(gap)] : [],
    detail: detailRows(o, gap),
  };
}

function coverageOf(view: RunView): CoverageVM {
  const { run, signals, gaps } = view;
  return {
    claims: signals.length + run.rejectedSignals,
    sourced: signals.length,
    discarded: run.rejectedSignals,
    gapsTested: gaps.length,
    gapsFilled: gaps.filter((g) => g.status === "served").length,
  };
}

/** A run-list entry: enough for the home rail, without loading the whole view. */
export function runListVM(run: Run, opportunityCount?: number): RunVM {
  const vm: RunVM = {
    id: run.id,
    question: run.question,
    region: labelForCode(run.region),
    status: statusOf(run.status),
    startedAt: new Date(run.createdAt).toISOString(),
    budgetSeconds: RUN_BUDGET_SECONDS,
    searchesUsed: run.searchesUsed,
    searchesCap: run.budget,
    stages: stagesFromEvents([], run.status),
    opportunities: [],
    opportunityCount: opportunityCount ?? 0,
    coverage: { claims: 0, sourced: 0, discarded: run.rejectedSignals, gapsTested: 0, gapsFilled: 0 },
    notes: run.error ? [run.error] : [],
    demo: run.demo,
  };
  if (run.finishedAt) vm.endedAt = new Date(run.finishedAt).toISOString();
  return vm;
}

/** A full run: rows, coverage and the research log, all from what the backend already sent. */
export function viewToRunVM(view: RunView, opts: { events?: StepEvent[] } = {}): RunVM {
  const events = opts.events ?? [];
  const byId = new Map(view.evidence.map((e) => [e.id, e]));
  const opportunities = view.opportunities
    .map((o) => opportunityVM(o, view, byId))
    .sort((a, b) => b.score - a.score);
  const running = view.run.status === "running";
  const waitingOnFirstSearch = running && !events.some((e) => e.type === "search_call");
  const vm: RunVM = {
    id: view.run.id,
    question: view.run.question,
    region: labelForCode(view.run.region),
    status: statusOf(view.run.status),
    startedAt: new Date(view.run.createdAt).toISOString(),
    budgetSeconds: RUN_BUDGET_SECONDS,
    searchesUsed: view.run.searchesUsed,
    searchesCap: view.run.budget,
    stages: stagesFromEvents(events, view.run.status, view),
    opportunities,
    opportunityCount: opportunities.length,
    coverage: coverageOf(view),
    notes: view.run.error ? [view.run.error] : [],
    demo: view.run.demo,
  };
  if (view.run.finishedAt) vm.endedAt = new Date(view.run.finishedAt).toISOString();
  if (waitingOnFirstSearch) vm.notes = [...vm.notes, "Waiting for the first search to come back."];
  return vm;
}
/* ------------------------------------------------------------------ browser prefs */

const THEME_KEY = "lr:v2:theme";
const DENSITY_KEY = "lr:v2:density";
const idKey = (runId: string, kind: "shortlist" | "dismissed") => `lr:v2:${kind}:${runId}`;

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null; // private mode or blocked storage
  }
}

function writeRaw(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* quota exceeded or blocked: the page still works, the choice just will not survive a reload */
  }
}

export function loadTheme(): ThemeVM {
  const raw = readRaw(THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export function saveTheme(value: ThemeVM): void {
  writeRaw(THEME_KEY, value);
}

export function loadDensity(): DensityVM {
  const raw = readRaw(DENSITY_KEY);
  return raw === "compact" || raw === "comfortable" ? raw : "comfortable";
}

export function saveDensity(value: DensityVM): void {
  writeRaw(DENSITY_KEY, value);
}

function parseIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function loadIds(runId: string, kind: "shortlist" | "dismissed"): string[] {
  return parseIds(readRaw(idKey(runId, kind)));
}

export function saveIds(runId: string, kind: "shortlist" | "dismissed", ids: string[]): void {
  writeRaw(idKey(runId, kind), JSON.stringify(ids));
}

/**
 * True when this browser will keep a choice. Used to warn that triage will not survive a reload,
 * rather than failing silently the way a full quota does.
 */
export function storageWorks(): boolean {
  try {
    const probe = "lr:v2:probe";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}


