/**
 * The only module allowed to reach SerpApi. Every search passes through:
 * budget guard → cache lookup → call → normalise → persist → emit step event.
 */
import { cacheTtlHours, RETRIES_ON_5XX, SEARCH_TIMEOUT_MS, serpapiKey, serpapiMode, type Settings } from "./config";
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

export class SerpApiHttpError extends Error {
  constructor(public readonly status: number, detail: string) {
    super(`SerpApi ${status}: ${detail}`);
  }
}

/** Secrets never reach logs, the store or the browser — even inside error text. */
export function scrub(text: string, settings: Settings): string {
  const key = serpapiKey(settings);
  if (key) text = text.split(key).join("[redacted]");
  return text.replace(/api_key=[^&\s"]+/gi, "api_key=[redacted]");
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
    if (run === null) throw new BudgetExceeded("Run not found, cannot charge searches.");
    const rawParams = toRawParams(engine, params, region ?? run.region);
    const phash = await hashParams(engine, rawParams);
    const ctx: CallCtx = { runId, stage, order };
    // a pipeline unit that is retried after a crash must not search (and pay) twice:
    // the call id is deterministic, so a recorded answer is simply handed back
    const recorded = await this.store.searchCallById(`sc_${runId}_${order}`);
    if (recorded !== null) {
      if (recorded.status !== "ok") throw new (recorded.status === "skipped" ? BudgetExceeded : Error)(recorded.error ?? "search failed");
      return { call: recorded, evidence: await this.store.evidenceForCall(runId, recorded.id), cached: recorded.cached };
    }
    try {
      // 1. per-run budget — always, and before any cost
      if (run.searchesUsed >= run.budget) throw new BudgetExceeded(`Run budget exceeded (${run.searchesUsed}/${run.budget}).`);
      if (serpapiMode(this.settings) === "replay") return await this.fromFixture(engine, rawParams, phash, ctx);
      // 2. cache — an identical search inside the TTL is free
      const cached = await this.store.findCachedCall(phash, cacheTtlHours(this.settings) * HOUR_MS);
      if (cached !== null) return await this.replayCached(cached.call, cached.rows, ctx);
      // 3. quota guards apply only to searches that will be billed
      await this.assertQuota();
      const started = nowMs();
      const body = await this.callNetwork(engine, rawParams);
      return await this.persistRaw(ctx, engine, rawParams, phash, body, false, true, started);
    } catch (err) {
      await this.recordFailure(engine, rawParams, phash, ctx, err);
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

  /** A failed or skipped search still appears in the research trace; the run continues. */
  private async recordFailure(engine: string, params: Params, phash: string, ctx: CallCtx, err: unknown): Promise<void> {
    const message = err instanceof Error ? err.message : String(err);
    const call: SearchCall = {
      id: `sc_${ctx.runId}_${ctx.order}`, runId: ctx.runId, stage: ctx.stage, engine, params: redact(params), paramsHash: phash, cached: false,
      status: err instanceof BudgetExceeded ? "skipped" : "failed", latencyMs: 0, resultCount: 0, createdAt: nowMs(), billed: false,
      error: scrub(message, this.settings).slice(0, 300),
    };
    await this.store.addSearchCall(call, null);
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
      throw new Error(`[replay] missing fixture ${phash} for engine=${engine} params=${JSON.stringify(redact(params))}. Set SERPAPI_MODE=live, or load a demo run.`);
    }
    return this.persistRaw(ctx, engine, params, phash, raw, true, false, nowMs());
  }

  /** 20 s timeout · one retry on 5xx, timeout or network failure · never on 4xx. */
  private async callNetwork(engine: string, params: Params): Promise<unknown> {
    const key = serpapiKey(this.settings);
    if (!key) throw new Error(`SERPAPI_API_KEY is required for SERPAPI_MODE=${serpapiMode(this.settings)}.`);
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && k !== "api_key") query.set(k, fmt(v));
    query.set("engine", engine);
    query.set("api_key", key);
    let last: Error = new Error("SerpApi call failed");
    for (let attempt = 0; attempt <= RETRIES_ON_5XX; attempt++) {
      try {
        const res = await this.fetchImpl(`https://serpapi.com/search.json?${query}`, { method: "GET", signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
        if (res.status >= 400) throw new SerpApiHttpError(res.status, scrub(await res.text(), this.settings).slice(0, 200));
        return await res.json();
      } catch (err) {
        last = err instanceof Error ? err : new Error(String(err));
        if (err instanceof SerpApiHttpError && err.status < 500) break;
      }
    }
    throw new Error(scrub(last.message, this.settings));
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
    await this.store.chargeSearch(ctx.runId);
    return this.recordCall(call, rows, ctx);
  }
}
