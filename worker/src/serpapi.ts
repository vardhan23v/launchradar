/**
 * The only module allowed to reach SerpApi. Every search passes through:
 * budget guard → cache lookup → call → normalise → persist → emit step event.
 */
import { cacheTtlHours, RETRIES_ON_5XX, scrubSecrets, SEARCH_TIMEOUT_MS, serpapiKey, serpapiMode, type Settings } from "./config";
import { fmt, hashParams, redact, toRawParams } from "./engines";
import { normalise } from "./normalise";
import type { Store } from "./store";
import type { Evidence, Params, Row, SearchCall, StepEvent } from "./types";
import { isRecord, nowMs } from "./utils";

export const HOUR_MS = 3_600_000;
export type Emitter = (event: StepEvent) => Promise<void> | void;
export type Fetch = (input: string, init: RequestInit) => Promise<Response>;
/** Replay source for tests and local development: raw SerpApi JSON by params hash, or null. */
export type FixtureSource = (hash: string) => Promise<unknown | null>;

export class BudgetExceeded extends Error {}

/**
 * A search that failed for a reason this client describes itself (message already scrubbed).
 * `maybeBilled` is true when SerpApi may have completed the search after this side gave up on it
 * (a timeout): the call is then counted as billed, so the spend guards never under-count.
 */
export class SerpApiError extends Error {
  constructor(message: string, public readonly maybeBilled = false) {
    super(message);
  }
}

/**
 * An HTTP failure, described in words this code wrote: the response body stays out of the public
 * research log (it goes, scrubbed, to the operator's console only). The status code is kept.
 */
export class SerpApiHttpError extends Error {
  constructor(public readonly status: number) {
    super(`The web lookup service said no (${status}): ${httpReason(status)}`);
  }
}

function httpReason(status: number): string {
  if (status === 401) return "the key was rejected (SERPAPI_API_KEY).";
  if (status === 403) return "this key or plan isn't allowed to do that.";
  if (status === 429) return "too many lookups, or the plan's allowance is used up.";
  if (status >= 500) return "something went wrong on its side.";
  return "it refused the request.";
}

/** Secrets never reach logs, the store or the browser — even inside error text. */
export function scrub(text: string, settings: Settings): string {
  return scrubSecrets(text, settings);
}

function queryOf(params: Params): string {
  for (const k of ["q", "search_query", "product_id", "data_id"]) if (params[k]) return String(params[k]);
  return "";
}

export interface SearchResult {
  call: SearchCall;
  evidence: Evidence[];
  cached: boolean;
}

interface CallCtx {
  runId: string;
  stage: string;
  order: number;
}

export class SerpApiService {
  constructor(
    private readonly store: Store,
    private readonly settings: Settings,
    public onEvent: Emitter | null = null,
    private readonly fetchImpl: Fetch = (url, init) => fetch(url, init),
    private readonly fixtures: FixtureSource | null = null,
  ) {}

  async search(engine: string, params: Params, runId: string, stage: string, order: number, region?: string): Promise<SearchResult> {
    const run = await this.store.getRun(runId);
    if (run === null) throw new BudgetExceeded("This search no longer exists, so no lookup can be charged to it.");
    const rawParams = toRawParams(engine, params, region ?? run.region);
    const phash = await hashParams(engine, rawParams);
    const ctx: CallCtx = { runId, stage, order };
    const started = nowMs();
    // a pipeline unit that is retried after a crash must not search (and pay) twice:
    // the call id is deterministic, so a recorded answer is simply handed back
    const recorded = await this.store.searchCallById(`sc_${runId}_${order}`);
    if (recorded !== null) {
      if (recorded.status !== "ok") throw new (recorded.status === "skipped" ? BudgetExceeded : SerpApiError)(recorded.error ?? "The lookup didn't work.");
      return { call: recorded, evidence: await this.store.evidenceForCall(runId, recorded.id), cached: recorded.cached };
    }
    // SerpApi has charged for a search once it answers, whatever happens to the record afterwards
    let paid = false;
    try {
      // 1. per-run budget — always, and before any cost
      if (run.searchesUsed >= run.budget) throw new BudgetExceeded(`This search has used all its lookups (${run.searchesUsed} of ${run.budget}).`);
      if (serpapiMode(this.settings) === "replay") return await this.fromFixture(engine, rawParams, phash, ctx);
      // 2. cache — an identical search inside the TTL is free
      const cached = await this.store.findCachedCall(phash, cacheTtlHours(this.settings) * HOUR_MS);
      if (cached !== null) return await this.replayCached(cached.call, cached.rows, ctx);
      // 3. quota guards apply only to searches that will be billed
      await this.assertQuota();
      const body = await this.callNetwork(engine, rawParams);
      paid = true;
      // the charge is written in the same database batch as the record (addSearchCall), so there is no
      // moment at which a run is charged for a lookup it has no record of. A record written before the
      // call (to survive a crash during it) would need a fourth call status that the cache, the retry
      // path and the browser all learn; the plan limit on SerpApi's side backstops that rare case.
      return await this.persistRaw(ctx, engine, rawParams, phash, body, false, true, started);
    } catch (err) {
      await this.recordFailure(engine, rawParams, phash, ctx, err, started, paid);
      throw err;
    }
  }

  private async assertQuota(): Promise<void> {
    const blocked = await this.store.quotaBlock();
    if (blocked) throw new BudgetExceeded(blocked);
  }

  private async emit(call: SearchCall, ctx: CallCtx, resultCount: number): Promise<void> {
    await this.onEvent?.({
      type: "search_call",
      call: { stage: ctx.stage, engine: call.engine, query: queryOf(call.params), resultCount, cached: call.cached, latencyMs: call.latencyMs, status: call.status },
    });
  }

  /**
   * A failed or skipped search still appears in the research trace; the run continues. A search
   * that timed out may have finished upstream, and one SerpApi answered (`paid`) certainly did,
   * so both are recorded (and charged) as billed: the spend guards never under-count. The record
   * is public, so only a sentence this module wrote goes into it; anything else (a database
   * error, say) becomes a fixed sentence and its details go to the operator's console.
   */
  private async recordFailure(engine: string, params: Params, phash: string, ctx: CallCtx, err: unknown, started: number, paid: boolean): Promise<void> {
    const known = err instanceof SerpApiError || err instanceof BudgetExceeded;
    const billed = paid || (err instanceof SerpApiError && err.maybeBilled);
    const call: SearchCall = {
      id: `sc_${ctx.runId}_${ctx.order}`, runId: ctx.runId, stage: ctx.stage, engine, params: redact(params), paramsHash: phash, cached: false,
      status: err instanceof BudgetExceeded ? "skipped" : "failed", latencyMs: nowMs() - started, resultCount: 0, createdAt: nowMs(), billed,
      error: known ? scrub(err.message, this.settings).slice(0, 300) : "Something went wrong on our side during this lookup.",
    };
    await this.store.addSearchCall(call, null); // charges the run in the same batch when billed
    await this.emit(call, ctx, 0);
  }

  private async recordCall(call: SearchCall, rows: Row[], ctx: CallCtx): Promise<SearchResult> {
    await this.store.addSearchCall(call, rows);
    const evidence = await this.store.addEvidence(ctx.runId, call.id, rows);
    await this.emit(call, ctx, evidence.length);
    return { call, evidence, cached: call.cached };
  }

  private replayCached(cached: SearchCall, rows: Row[], ctx: CallCtx): Promise<SearchResult> {
    const call: SearchCall = { ...cached, id: `sc_${ctx.runId}_${ctx.order}`, runId: ctx.runId, stage: ctx.stage, cached: true, billed: false, latencyMs: 0, createdAt: nowMs() };
    return this.recordCall(call, rows, ctx);
  }

  private async fromFixture(engine: string, params: Params, phash: string, ctx: CallCtx): Promise<SearchResult> {
    const raw = this.fixtures ? await this.fixtures(phash) : null;
    if (raw === null || raw === undefined) {
      throw new SerpApiError(`No recorded answer for this lookup (${phash}, engine=${engine}, params=${JSON.stringify(redact(params))}). Set SERPAPI_MODE=live, or open the example search.`);
    }
    return this.persistRaw(ctx, engine, params, phash, raw, true, false, nowMs());
  }

  /** SEARCH_TIMEOUT_MS per attempt · one retry on 5xx, timeout or network failure · never on 4xx. */
  private async callNetwork(engine: string, params: Params): Promise<unknown> {
    const key = serpapiKey(this.settings);
    if (!key) throw new SerpApiError(`Live lookups need a key (SERPAPI_API_KEY, since SERPAPI_MODE=${serpapiMode(this.settings)}).`);
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && k !== "api_key") query.set(k, fmt(v));
    query.set("engine", engine);
    query.set("api_key", key);
    let last: Error = new Error("The web lookup didn't work.");
    let timedOut = false; // an attempt SerpApi may have completed after this side stopped waiting
    for (let attempt = 0; attempt <= RETRIES_ON_5XX; attempt++) {
      try {
        const res = await this.fetchImpl(`https://serpapi.com/search.json?${query}`, { method: "GET", signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
        if (res.status >= 400) {
          // the body is for the operator's console only, never for the run record
          console.error("serpapi http error", res.status, engine, scrub(await res.text().catch(() => ""), this.settings).slice(0, 200));
          throw new SerpApiHttpError(res.status);
        }
        return await res.json();
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err));
        if (last.name === "TimeoutError") timedOut = true;
        if (err instanceof SerpApiHttpError && err.status < 500) break;
      }
    }
    const why = last instanceof SerpApiHttpError ? last.message : last.name === "TimeoutError" ? "The web lookup took too long" : "We couldn't reach the web lookup service";
    if (!(last instanceof SerpApiHttpError)) console.error("serpapi request failed", engine, scrub(last.message, this.settings));
    throw new SerpApiError(scrub(why, this.settings), timedOut);
  }

  private async persistRaw(ctx: CallCtx, engine: string, params: Params, phash: string, raw: unknown, cached: boolean, billed: boolean, started: number): Promise<SearchResult> {
    const meta = isRecord(raw) && isRecord(raw.search_metadata) ? raw.search_metadata : null;
    const searchId = meta && typeof meta.id === "string" ? meta.id : null;
    let rows: Row[];
    try {
      rows = normalise(engine, isRecord(raw) ? raw : {});
    } catch {
      rows = []; // an "empty results" or odd body is a valid zero-row answer
    }
    const call: SearchCall = {
      id: `sc_${ctx.runId}_${ctx.order}`, runId: ctx.runId, stage: ctx.stage, engine, params: redact(params), paramsHash: phash, cached, status: "ok",
      latencyMs: nowMs() - started, resultCount: rows.length, createdAt: nowMs(), billed,
    };
    if (searchId) call.serpapiSearchId = searchId;
    // searchesUsed counts billed searches only (fixture replays and cache hits are free): the store
    // charges the run in the same batch that records the call
    return this.recordCall(call, rows, ctx);
  }
}
