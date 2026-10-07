/**
 * One Durable Object per run drives the pipeline: every alarm performs exactly one unit of work
 * (one search, one LLM call or one bookkeeping step), persists the state and schedules the next
 * alarm. Each alarm is its own invocation, so a unit never shares the free plan's CPU, subrequest
 * or D1-query budget with the units before it, and a browser that disconnects cannot stop a run.
 */
import { DurableObject } from "cloudflare:workers";

import type { Env } from "./env";
import { initialState, makeCtx, runUnit, type PipelineState } from "./pipeline";
import { ensureSchema, Store } from "./store";

const STATE = "state";
const UNITS = "units"; // alarms run so far

export class ResearchRunner extends DurableObject<Env> {
  /** Starts the pipeline for a run that already exists in the store. Idempotent. */
  async start(runId: string, question: string, region: string): Promise<void> {
    if (await this.ctx.storage.get<PipelineState>(STATE)) return;
    await this.ctx.storage.put(STATE, initialState(runId, question, region));
    await this.ctx.storage.setAlarm(Date.now());
  }

  override async alarm(): Promise<void> {
    const state = await this.ctx.storage.get<PipelineState>(STATE);
    if (!state || state.phase === "done") return;
    await ensureSchema(this.env.DB);
    const store = new Store(this.env.DB, this.env);
    const next = await runUnit(makeCtx(store, this.env, state.runId), state);
    const units = ((await this.ctx.storage.get<number>(UNITS)) ?? 0) + 1;
    await this.ctx.storage.put({ [STATE]: next, [UNITS]: units });
    if (next.phase !== "done") await this.ctx.storage.setAlarm(Date.now());
  }

  /** The pipeline's position, for tests and diagnostics. Never includes evidence text or keys. */
  async phase(): Promise<{ phase: string; i: number; status: string | null; units: number } | null> {
    const state = await this.ctx.storage.get<PipelineState>(STATE);
    const units = (await this.ctx.storage.get<number>(UNITS)) ?? 0;
    return state ? { phase: state.phase, i: state.i, status: state.status, units } : null;
  }
}
