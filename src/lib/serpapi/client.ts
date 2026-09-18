import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Engine } from "../config";
import { CONFIG } from "../config";
import type { Evidence, SearchCall, StepEvent } from "../schemas";
import type { Store } from "../store";
import { redact, type ParamsFor } from "./engines";
import { toRawParams, hashParams } from "./engines";
import { normalise, toEvidence, type RawResult } from "./normalise";

export class BudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BudgetExceeded";
  }
}

export interface SearchCtx {
  runId: string;
  stage: string;
  /** monotonically increasing order within the run for stable display */
  order: number;
}

export interface SearchOutcome {
  call: SearchCall;
  evidence: Evidence[];
  cached: boolean;
}

type Emitter = (e: StepEvent) => void;

export class SerpApiService {
  constructor(
    private store: Store,
    private onEvent?: Emitter,
    private fixtureDir: string = join(process.cwd(), "fixtures", "serpapi"),
  ) {}

  /** The one function everything else calls. Budget guard throws BEFORE any cost. */
  async search<E extends Engine>(
    engine: E,
    params: ParamsFor<E>,
    ctx: SearchCtx,
  ): Promise<SearchOutcome> {
    const mode = CONFIG.serpapiMode;
    this.assertBudget(ctx.runId);

    const rawParams = toRawParams(engine, params, "in");
    const hash = hashParams(engine, rawParams);

    // 2. cache lookup — avoid paying for an identical live search we already stored
    if (mode === "live") {
      const cachedCall = this.store.findCachedCall(hash);
      if (cachedCall) return this.replayCached(cachedCall, ctx);
    }

    if (mode === "replay") return this.fromFixture(engine, rawParams, hash, ctx);
    return this.fromNetwork(engine, rawParams, hash, ctx);
  }

  private assertBudget(runId: string): void {
    const run = this.store.getRun(runId);
    if (!run) throw new BudgetError("Run not found, cannot charge searches.");
    if (run.searchesUsed >= run.budget) {
      throw new BudgetError(`Run budget exceeded (${run.searchesUsed}/${run.budget}).`);
    }
    if (CONFIG.monthlySearchBudget > 0) {
      const calls = this.store.searchCallsFor(runId).length;
      if (calls >= CONFIG.monthlySearchBudget) {
        throw new BudgetError(
          `Monthly budget (${CONFIG.monthlySearchBudget}) reached — no live searches left.`,
        );
      }
    }
  }

  private recordCall(
    call: SearchCall,
    rows: RawResult[],
    ctx: SearchCtx,
    cached: boolean,
  ): SearchOutcome {
    this.store.addSearchCalls([call]);
    const base = this.store.evidenceFor(ctx.runId).length;
    const evidence = toEvidence(ctx.runId, call.id, call.engine, rows, base);
    this.store.addEvidence(evidence);

    this.onEvent?.({
      type: "search_call",
      call: {
        stage: ctx.stage,
        engine: call.engine,
        query: String(call.params.q ?? ""),
        resultCount: evidence.length,
        cached,
        latencyMs: call.latencyMs,
        status: call.status,
      },
    });
    return { call, evidence, cached };
  }

  private replayCached(cachedCall: SearchCall, ctx: SearchCtx): SearchOutcome {
    const rowsJson = (cachedCall.params as { __rows?: RawResult[] }).__rows;
    if (!rowsJson) {
      throw new Error("cached call has no stored rows");
    }
    const rows = rowsJson;
    const call: SearchCall = {
      ...cachedCall,
      id: `sc_${ctx.runId}_${ctx.order}`,
      runId: ctx.runId,
      cached: true,
    };
    void ctx;
    return this.recordCall(call, rows, ctx, true);
  }

  private fromFixture(
    engine: Engine,
    params: Record<string, string | number | boolean | undefined>,
    hash: string,
    ctx: SearchCtx,
  ): SearchOutcome {
    const file = join(this.fixtureDir, `${hash}.json`);
    if (!existsSync(file)) {
      throw new Error(
        `[replay] missing fixture ${hash} for engine=${engine} params=${JSON.stringify(
          redact(params),
        )}. Record it once with SERPAPI_MODE=record, or run in demo mode.`,
      );
    }
    const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    const started = Date.now();
    return this.persistFromRaw(ctx, engine, params, hash, raw, true, started);
  }

  private async fromNetwork(
    engine: Engine,
    params: Record<string, string | number | boolean | undefined>,
    hash: string,
    ctx: SearchCtx,
  ): Promise<SearchOutcome> {
    void hash;
    const started = Date.now();
    const body = await this.callNetwork(engine, params);
    if (CONFIG.serpapiMode === "record" && body) {
      const file = join(this.fixtureDir, `${hashParams(engine, params)}.json`);
      mkdirSync(this.fixtureDir, { recursive: true });
      writeFileSync(file, JSON.stringify(body, null, 2), "utf8");
    }
    return this.persistFromRaw(ctx, engine, params, hash, body, false, started);
  }

  private async callNetwork(
    engine: Engine,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<Record<string, unknown>> {
    if (!CONFIG.serpapiKey) {
      throw new Error("SERPAPI_API_KEY is required for live mode.");
    }
    const url = new URL("https://serpapi.com/search");
    url.searchParams.set("engine", engine);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && k !== "api_key") url.searchParams.set(k, String(v));
    }
    url.searchParams.set("api_key", CONFIG.serpapiKey);

    let lastErr: Error | undefined;
    for (let attempt = 0; attempt <= CONFIG.retriesOn5xx; attempt++) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(CONFIG.searchTimeoutMs),
          cache: "no-store",
        });
        if (res.status >= 400) {
          const detail = await res.text().catch(() => "");
          throw new Error(`SerpApi ${res.status}: ${detail.slice(0, 200)}`);
        }
        return (await res.json()) as Record<string, unknown>;
      } catch (err) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const isRetryable =
          err instanceof Error && err.name === "TimeoutError";
        if (!isRetryable && !("status" in (err as object))) throw lastErr;
      }
    }
    throw lastErr ?? new Error("SerpApi call failed");
  }

  private persistFromRaw(
    ctx: SearchCtx,
    engine: Engine,
    params: Record<string, string | number | boolean | undefined>,
    hash: string,
    raw: Record<string, unknown>,
    cached: boolean,
    started: number,
  ): SearchOutcome {
    const latencyMs = Date.now() - started;
    const meta = raw.search_metadata;
    const serpapiSearchId =
      typeof meta === "object" && meta !== null && typeof (meta as { id?: unknown }).id === "string"
        ? (meta as { id: string }).id
        : undefined;
    const rows: RawResult[] = (() => {
      try {
        return normalise(engine, raw);
      } catch {
        return [];
      }
    })();
    const callId = `sc_${ctx.runId}_${ctx.order}`;
    const call: SearchCall = {
      id: callId,
      runId: ctx.runId,
      stage: ctx.stage,
      engine,
      params: { ...redact(params), __rows: rows },
      paramsHash: hash,
      cached,
      status: "ok",
      latencyMs,
      resultCount: rows.length,
      serpapiSearchId,
    };
    const run = this.store.getRun(ctx.runId);
    if (run) {
      this.store.updateRun(ctx.runId, {
        searchesUsed: run.searchesUsed + 1,
      });
    }
    return this.recordCall(call, rows, ctx, cached);
  }
}

export function makeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}