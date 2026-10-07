/**
 * D1 (SQLite) store. Every mutation is one statement or one batch, so concurrent pipeline steps
 * never see a half-written run. Ids that must be dense and unique under concurrency (evidence
 * E1, E2, …; event indexes) are assigned by the database, not by the caller.
 */
import { hourlyRateGuard, monthlySearchBudget, runSearchBudget, type Settings } from "./config";
import type { Cluster, Competitor, Evidence, Gap, Opportunity, Row, Run, RunView, SearchCall, Signal, StepEvent } from "./types";
import { nowMs } from "./utils";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS runs (
     id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, status TEXT NOT NULL, demo INTEGER NOT NULL DEFAULT 0, data TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at)`,
  `CREATE INDEX IF NOT EXISTS runs_status ON runs(status, demo, created_at)`,
  `CREATE TABLE IF NOT EXISTS events (run_id TEXT NOT NULL, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, idx))`,
  `CREATE TABLE IF NOT EXISTS search_calls (
     id TEXT PRIMARY KEY, run_id TEXT NOT NULL, seq INTEGER NOT NULL, params_hash TEXT NOT NULL, status TEXT NOT NULL,
     billed INTEGER NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL, rows TEXT)`,
  `CREATE INDEX IF NOT EXISTS search_calls_run ON search_calls(run_id, seq)`,
  `CREATE INDEX IF NOT EXISTS search_calls_hash ON search_calls(params_hash, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS search_calls_billed ON search_calls(billed, created_at)`,
  `CREATE TABLE IF NOT EXISTS evidence (
     run_id TEXT NOT NULL, seq INTEGER NOT NULL, search_call_id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq))`,
  `CREATE TABLE IF NOT EXISTS entities (
     run_id TEXT NOT NULL, kind TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, kind, seq))`,
];

export const KINDS = ["signals", "clusters", "competitors", "gaps", "opportunities"] as const;
export type Kind = (typeof KINDS)[number];

/** A live run that has shown no progress for this long was interrupted (the workflow died). */
export const STALE_RUN_MS = 40 * 60_000;
export const INTERRUPTED = "Interrupted: the research job stopped before this run finished. Start it again; saved searches replay from cache.";
/** The home page shows the newest runs; older ones stay readable by id. */
export const LIST_LIMIT = 50;
const ALL_TABLES = ["events", "search_calls", "evidence", "entities"] as const;

const schemaReady = new WeakMap<D1Database, Promise<void>>();

/** Tests run on fresh storage per test; forget that the tables were created. */
export function resetSchemaCache(db: D1Database): void {
  schemaReady.delete(db);
}

/** Creates the tables once per isolate. Idempotent, so a redeploy needs no migration step. */
export function ensureSchema(db: D1Database): Promise<void> {
  let p = schemaReady.get(db);
  if (!p) {
    p = db.batch(SCHEMA.map((sql) => db.prepare(sql))).then(() => undefined);
    schemaReady.set(db, p);
    p.catch(() => schemaReady.delete(db)); // let the next request try again
  }
  return p;
}

interface RunRow { data: string }
interface SeqRow { seq: number; data: string; search_call_id?: string }
interface EventRow { idx: number; data: string }
interface CallRow { data: string; rows: string | null }
interface CountRow { n: number }

function parse<T>(text: string): T {
  return JSON.parse(text) as T;
}

export class Store {
  constructor(private readonly db: D1Database, private readonly settings: Settings) {}

  // ---- runs

  async createRun(run: Run): Promise<void> {
    await this.db.prepare("INSERT INTO runs (id, created_at, status, demo, data) VALUES (?, ?, ?, ?, ?)")
      .bind(run.id, run.createdAt, run.status, run.demo ? 1 : 0, JSON.stringify(run)).run();
  }

  /**
   * Creates a live run only while fewer than `limit` live runs are in progress, in ONE statement,
   * so two requests that arrive together cannot both slip under the limit.
   */
  async createRunIfCapacity(run: Run, limit: number, now = nowMs()): Promise<boolean> {
    const res = await this.db.prepare(
      `INSERT INTO runs (id, created_at, status, demo, data)
       SELECT ?, ?, ?, 0, ? WHERE (SELECT COUNT(*) FROM runs WHERE status = 'running' AND demo = 0 AND created_at >= ?) < ?`,
    ).bind(run.id, run.createdAt, run.status, JSON.stringify(run), now - STALE_RUN_MS, limit).run();
    return res.meta.changes === 1;
  }

  /** Applies `patch` only if the run is still running. True when this call made the transition. */
  async finishIfRunning(runId: string, patch: Partial<Run>): Promise<boolean> {
    const keys = Object.keys(patch) as (keyof Run)[];
    const sets = keys.map((k) => `'$.${k}', json(?)`).join(", ");
    const values = keys.map((k) => JSON.stringify(patch[k] ?? null));
    const status = typeof patch.status === "string" ? patch.status : "running";
    const res = await this.db.prepare(`UPDATE runs SET data = json_set(data, ${sets}), status = ? WHERE id = ? AND status = 'running'`)
      .bind(...values, status, runId).run();
    return res.meta.changes === 1;
  }

  /** Deletes a run and everything that belongs to it. */
  async deleteRun(runId: string): Promise<void> {
    await this.db.batch([
      ...ALL_TABLES.map((t) => this.db.prepare(`DELETE FROM ${t} WHERE run_id = ?`).bind(runId)),
      this.db.prepare("DELETE FROM runs WHERE id = ?").bind(runId),
    ]);
  }

  async demoRunsSince(since: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM runs WHERE demo = 1 AND created_at >= ?").bind(since).first<CountRow>();
    return row?.n ?? 0;
  }

  async newestDemoRunId(): Promise<string | null> {
    const row = await this.db.prepare("SELECT id FROM runs WHERE demo = 1 ORDER BY created_at DESC, id DESC LIMIT 1").first<{ id: string }>();
    return row?.id ?? null;
  }

  /** Keeps the newest `keep` copies of the recorded example and deletes the rest (it can always be replayed). */
  async pruneDemoRuns(keep: number): Promise<void> {
    const old = "SELECT id FROM runs WHERE demo = 1 ORDER BY created_at DESC, id DESC LIMIT -1 OFFSET ?";
    await this.db.batch([
      ...ALL_TABLES.map((t) => this.db.prepare(`DELETE FROM ${t} WHERE run_id IN (${old})`).bind(keep)),
      this.db.prepare(`DELETE FROM runs WHERE id IN (${old})`).bind(keep),
    ]);
  }

  /** Atomic field-level patch (json_set), so concurrent steps never overwrite each other's fields. */
  async updateRun(runId: string, patch: Partial<Run>): Promise<void> {
    const keys = Object.keys(patch) as (keyof Run)[];
    if (!keys.length) return;
    const sets = keys.map((k) => `'$.${k}', json(?)`).join(", ");
    const values = keys.map((k) => JSON.stringify(patch[k] ?? null));
    const status = typeof patch.status === "string" ? patch.status : null;
    const res = await this.db.prepare(`UPDATE runs SET data = json_set(data, ${sets}), status = COALESCE(?, status) WHERE id = ?`)
      .bind(...values, status, runId).run();
    if (!res.meta.changes) throw new Error(`run not found: ${runId}`);
  }

  /** searchesUsed + 1 in one statement: parallel searches cannot lose an increment. */
  async chargeSearch(runId: string): Promise<void> {
    await this.db.prepare("UPDATE runs SET data = json_set(data, '$.searchesUsed', json_extract(data, '$.searchesUsed') + 1) WHERE id = ?")
      .bind(runId).run();
  }

  async getRun(runId: string): Promise<Run | null> {
    const row = await this.db.prepare("SELECT data FROM runs WHERE id = ?").bind(runId).first<RunRow>();
    return row ? parse<Run>(row.data) : null;
  }

  async listRuns(limit = LIST_LIMIT): Promise<Run[]> {
    const { results } = await this.db.prepare("SELECT data FROM runs ORDER BY created_at DESC, id DESC LIMIT ?").bind(limit).all<RunRow>();
    return results.map((r) => parse<Run>(r.data));
  }

  /**
   * A live run that is still "running" long after it started was interrupted: nothing will finish
   * it, so it is closed with an explanation instead of spinning forever in the browser.
   */
  async failStaleRuns(now = nowMs()): Promise<number> {
    const { results } = await this.db.prepare("SELECT data FROM runs WHERE status = 'running' AND demo = 0 AND created_at < ?")
      .bind(now - STALE_RUN_MS).all<RunRow>();
    for (const r of results) {
      const run = parse<Run>(r.data);
      // two requests can see the same stale run; only the one that makes the transition closes it
      if (!(await this.finishIfRunning(run.id, { status: "failed", finishedAt: now, error: INTERRUPTED }))) continue;
      await this.appendEvents(run.id, [
        { type: "stage", stage: "error", message: INTERRUPTED, level: "error" },
        { type: "status", status: "failed" },
        { type: "done", runId: run.id, searchesUsed: run.searchesUsed },
      ]);
    }
    return results.length;
  }

  // ---- search calls, cache and quota

  /** `rows` is the cached normalised result; it never travels to the browser. */
  async addSearchCall(call: SearchCall, rows: Row[] | null): Promise<void> {
    const { __rows: _ignored, ...params } = call.params as Record<string, unknown>;
    void _ignored;
    const data = JSON.stringify({ ...call, params });
    await this.db.prepare(
      `INSERT INTO search_calls (id, run_id, seq, params_hash, status, billed, created_at, data, rows)
       SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ?, ?, ?, ?, ?, ? FROM search_calls WHERE run_id = ?`,
    ).bind(call.id, call.runId, call.paramsHash, call.status, call.billed ? 1 : 0, call.createdAt, data,
      rows === null ? null : JSON.stringify(rows), call.runId).run();
  }

  async searchCallById(id: string): Promise<SearchCall | null> {
    const row = await this.db.prepare("SELECT data FROM search_calls WHERE id = ?").bind(id).first<RunRow>();
    return row ? parse<SearchCall>(row.data) : null;
  }

  async evidenceForCall(runId: string, searchCallId: string): Promise<Evidence[]> {
    const { results } = await this.db.prepare("SELECT seq, data, search_call_id FROM evidence WHERE run_id = ? AND search_call_id = ? ORDER BY seq")
      .bind(runId, searchCallId).all<SeqRow>();
    return results.map((r) => this.evidenceOf(runId, r));
  }

  async searchCallsFor(runId: string): Promise<SearchCall[]> {
    const { results } = await this.db.prepare("SELECT data FROM search_calls WHERE run_id = ? ORDER BY seq").bind(runId).all<RunRow>();
    return results.map((r) => parse<SearchCall>(r.data));
  }

  /** Newest successful call with the same param hash, no older than the TTL, with its rows. */
  async findCachedCall(paramsHash: string, maxAgeMs: number, now = nowMs()): Promise<{ call: SearchCall; rows: Row[] } | null> {
    const row = await this.db.prepare(
      "SELECT data, rows FROM search_calls WHERE params_hash = ? AND status = 'ok' AND rows IS NOT NULL AND created_at >= ? ORDER BY created_at DESC, seq DESC LIMIT 1",
    ).bind(paramsHash, now - maxAgeMs).first<CallRow>();
    if (!row || row.rows === null) return null;
    const rows = parse<unknown>(row.rows);
    return Array.isArray(rows) ? { call: parse<SearchCall>(row.data), rows: rows as Row[] } : null;
  }

  /** Searches that cost SerpApi quota (cache hits and fixtures excluded). */
  async billedSearchesSince(sinceMs: number): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM search_calls WHERE billed = 1 AND created_at >= ?").bind(sinceMs).first<CountRow>();
    return row?.n ?? 0;
  }

  async billedSearchesThisMonth(now = nowMs()): Promise<number> {
    const d = new Date(now);
    return this.billedSearchesSince(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  }

  /**
   * Why a NEW live run cannot start, or null. Besides the search guards it reserves a whole run's
   * budget: a run that would hit the hourly or monthly guard halfway would spend LLM calls and
   * then fail, so it is refused up front.
   */
  async runStartBlock(now = nowMs()): Promise<string | null> {
    const blocked = await this.quotaBlock(now);
    if (blocked) return blocked;
    const need = runSearchBudget(this.settings);
    const monthLimit = monthlySearchBudget(this.settings);
    const month = await this.billedSearchesThisMonth(now);
    if (month + need > monthLimit) {
      return `This month's search budget cannot cover another run (${month} of ${monthLimit} used; a run needs up to ${need}). It resets on the 1st.`;
    }
    const limit = hourlyRateGuard(this.settings);
    if (need > limit) return "The hourly search limit is smaller than one run's budget, so no run can start. Raise HOURLY_SEARCH_GUARD.";
    const { results } = await this.db.prepare("SELECT created_at FROM search_calls WHERE billed = 1 AND created_at >= ? ORDER BY created_at")
      .bind(now - 3_600_000).all<{ created_at: number }>();
    const mustExpire = results.length + need - limit;
    if (mustExpire > 0) {
      const minutes = Math.max(1, Math.ceil((results[mustExpire - 1].created_at + 3_600_000 - now) / 60_000));
      return `The hourly search limit leaves too little room for a run (${results.length} of ${limit} used in the last hour). Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return null;
  }

  /** Why a billed search cannot run right now, in words a person can act on. Null when it can. */
  async quotaBlock(now = nowMs()): Promise<string | null> {
    const monthLimit = monthlySearchBudget(this.settings);
    const month = await this.billedSearchesThisMonth(now);
    if (month >= monthLimit) return `This month's search budget is used up (${month} of ${monthLimit}). It resets on the 1st.`;
    const limit = hourlyRateGuard(this.settings);
    const { results } = await this.db.prepare("SELECT created_at FROM search_calls WHERE billed = 1 AND created_at >= ? ORDER BY created_at")
      .bind(now - 3_600_000).all<{ created_at: number }>();
    if (results.length >= limit) {
      // the slot frees when the oldest search inside the window turns an hour old
      const freesAt = results[results.length - limit].created_at + 3_600_000;
      const minutes = Math.max(1, Math.ceil((freesAt - now) / 60_000));
      return `The hourly search limit is reached (${results.length} of ${limit} in the last hour). Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
    }
    return null;
  }

  // ---- evidence and entities

  /**
   * Rows get E<seq> ids from the database in one transaction, so two searches that finish at the
   * same moment can never produce the same id. Rows that already carry an id (the recorded
   * example) keep it.
   */
  async addEvidence(runId: string, searchCallId: string, rows: (Row & { id?: string; searchCallId?: string })[]): Promise<Evidence[]> {
    if (!rows.length) return [];
    const stmt = this.db.prepare(
      "INSERT INTO evidence (run_id, seq, search_call_id, data) SELECT ?, COALESCE(MAX(seq), 0) + 1, ?, ? FROM evidence WHERE run_id = ?",
    );
    await this.db.batch(rows.map(({ searchCallId: own, ...r }) => stmt.bind(runId, own ?? searchCallId, JSON.stringify(r), runId)));
    return this.evidenceForCall(runId, searchCallId);
  }

  private evidenceOf(runId: string, r: SeqRow): Evidence {
    const data = parse<Row & { id?: string }>(r.data);
    return { ...data, id: data.id ?? `E${r.seq}`, runId, searchCallId: r.search_call_id ?? "" };
  }

  async evidenceFor(runId: string): Promise<Evidence[]> {
    const { results } = await this.db.prepare("SELECT seq, data, search_call_id FROM evidence WHERE run_id = ? ORDER BY seq").bind(runId).all<SeqRow>();
    return results.map((r) => this.evidenceOf(runId, r));
  }

  private async add(kind: Kind, runId: string, rows: object[]): Promise<void> {
    if (!rows.length) return;
    const stmt = this.db.prepare(
      "INSERT INTO entities (run_id, kind, seq, data) SELECT ?, ?, COALESCE(MAX(seq), 0) + 1, ? FROM entities WHERE run_id = ? AND kind = ?",
    );
    await this.db.batch(rows.map((r) => stmt.bind(runId, kind, JSON.stringify(r), runId, kind)));
  }

  private async set(kind: Kind, runId: string, rows: object[]): Promise<void> {
    const stmts = [this.db.prepare("DELETE FROM entities WHERE run_id = ? AND kind = ?").bind(runId, kind)];
    const insert = this.db.prepare("INSERT INTO entities (run_id, kind, seq, data) VALUES (?, ?, ?, ?)");
    rows.forEach((r, i) => stmts.push(insert.bind(runId, kind, i + 1, JSON.stringify(r))));
    await this.db.batch(stmts);
  }

  private async list<T>(kind: Kind, runId: string): Promise<T[]> {
    const { results } = await this.db.prepare("SELECT data FROM entities WHERE run_id = ? AND kind = ? ORDER BY seq").bind(runId, kind).all<RunRow>();
    return results.map((r) => parse<T>(r.data));
  }

  addSignals = (runId: string, rows: Signal[]) => this.add("signals", runId, rows);
  addCompetitors = (runId: string, rows: Competitor[]) => this.add("competitors", runId, rows);
  setClusters = (runId: string, rows: Cluster[]) => this.set("clusters", runId, rows);
  setGaps = (runId: string, rows: Gap[]) => this.set("gaps", runId, rows);
  setOpportunities = (runId: string, rows: Opportunity[]) => this.set("opportunities", runId, rows);
  signalsFor = (runId: string) => this.list<Signal>("signals", runId);
  clustersFor = (runId: string) => this.list<Cluster>("clusters", runId);
  competitorsFor = (runId: string) => this.list<Competitor>("competitors", runId);
  gapsFor = (runId: string) => this.list<Gap>("gaps", runId);
  opportunitiesFor = (runId: string) => this.list<Opportunity>("opportunities", runId);

  // ---- step events

  async setEvents(runId: string, events: StepEvent[]): Promise<void> {
    const stmts = [this.db.prepare("DELETE FROM events WHERE run_id = ?").bind(runId)];
    const insert = this.db.prepare("INSERT INTO events (run_id, idx, data) VALUES (?, ?, ?)");
    events.forEach((e, i) => stmts.push(insert.bind(runId, i, JSON.stringify(e))));
    await this.db.batch(stmts);
  }

  async appendEvents(runId: string, events: StepEvent[]): Promise<void> {
    if (!events.length) return;
    const stmt = this.db.prepare("INSERT INTO events (run_id, idx, data) SELECT ?, COALESCE(MAX(idx) + 1, 0), ? FROM events WHERE run_id = ?");
    await this.db.batch(events.map((e) => stmt.bind(runId, JSON.stringify(e), runId)));
  }

  /** Events from `fromIndex` on, as [index, event]. */
  async eventsFor(runId: string, fromIndex = 0): Promise<[number, StepEvent][]> {
    const { results } = await this.db.prepare("SELECT idx, data FROM events WHERE run_id = ? AND idx >= ? ORDER BY idx").bind(runId, fromIndex).all<EventRow>();
    return results.map((r) => [r.idx, parse<StepEvent>(r.data)]);
  }

  async eventCount(runId: string): Promise<number> {
    const row = await this.db.prepare("SELECT COUNT(*) AS n FROM events WHERE run_id = ?").bind(runId).first<CountRow>();
    return row?.n ?? 0;
  }

  async view(runId: string): Promise<RunView | null> {
    const run = await this.getRun(runId);
    if (!run) return null;
    const [searchCalls, evidence, signals, clusters, competitors, gaps, opportunities] = await Promise.all([
      this.searchCallsFor(runId), this.evidenceFor(runId), this.signalsFor(runId), this.clustersFor(runId),
      this.competitorsFor(runId), this.gapsFor(runId), this.opportunitiesFor(runId),
    ]);
    return { run, searchCalls, evidence, signals, clusters, competitors, gaps, opportunities };
  }
}
