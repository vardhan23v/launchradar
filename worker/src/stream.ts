/**
 * Server-sent events for a run: persisted events first, then new ones as the pipeline writes
 * them. `fromIndex` (Last-Event-ID + 1) resumes without duplicates, so a refresh mid-run is safe.
 *
 * Demo runs have their whole trace recorded up front: they are paced so the trace animates, and
 * the stream itself completes them. Live runs are completed only by the pipeline — never by a
 * viewer. A live run's stream closes after a short window (the browser's EventSource reconnects
 * with Last-Event-ID), so one invocation never accumulates CPU or D1 queries for ten minutes.
 */
import { demoDelayBaseMs, demoDelayMs, type Settings } from "./config";
import type { Store } from "./store";
import type { StepEvent } from "./types";
import { nowMs, sleep } from "./utils";

export const POLL_MS = 2000;
/** how long one stream request follows a live run before handing over to the next reconnect */
export const FOLLOW_WINDOW_MS = 24_000;
/** Proxies in front of the API (Vercel's rewrite) may close a response that stays silent too long. */
export const HEARTBEAT_MS = 10_000;
export const RETRY_MS = 2000;

export const PING = Symbol("ping");
export type StreamItem = [number, StepEvent] | typeof PING;

function delayMs(event: StepEvent, settings: Settings): number {
  if (event.type === "search_call") return demoDelayMs(settings) + (event.call.latencyMs % 180);
  if (event.type === "llm") return demoDelayMs(settings) * 0.6;
  return demoDelayBaseMs(settings);
}

export interface FollowOptions {
  isCancelled?: () => boolean;
  windowMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
}

export async function* followRunEvents(store: Store, runId: string, fromIndex: number, settings: Settings, opts: FollowOptions = {}): AsyncGenerator<StreamItem> {
  const isCancelled = opts.isCancelled ?? (() => false);
  const windowMs = opts.windowMs ?? FOLLOW_WINDOW_MS;
  const heartbeatMs = opts.heartbeatMs ?? HEARTBEAT_MS;
  const pollMs = opts.pollMs ?? POLL_MS;
  const first = await store.getRun(runId);
  if (!first) return;
  let cursor = Math.max(0, fromIndex);
  const paced = first.demo && first.status === "running";
  const deadline = nowMs() + windowMs;
  let lastSent = nowMs();

  while (!isCancelled()) {
    const events = await store.eventsFor(runId, cursor);
    for (const [index, event] of events) {
      yield [index, event];
      cursor = index + 1;
      lastSent = nowMs();
      if (paced) await sleep(delayMs(event, settings));
      if (isCancelled() || nowMs() > deadline) return; // the client resumes from the last id it saw
    }

    const run = await store.getRun(runId);
    if (!run) return;
    if (run.demo && run.status === "running") {
      // two viewers can reach the end together; only the one that makes the transition writes the ending
      if (await store.finishIfRunning(runId, { status: "complete", finishedAt: nowMs() })) {
        await store.appendEvents(runId, [{ type: "status", status: "complete" }, { type: "done", runId, searchesUsed: run.searchesUsed }]);
      }
      continue; // loop once more to deliver the two events just written
    }
    if (run.status === "complete" || run.status === "failed") {
      const tail = await store.eventsFor(runId, cursor);
      if (tail.length) continue; // events landed between the two reads
      // runs persisted before terminal events existed still close cleanly
      const all = cursor === 0 ? [] : await store.eventsFor(runId, cursor - 1);
      if (!all.length || all[all.length - 1][1].type !== "done") {
        yield [cursor, { type: "status", status: run.status }];
        yield [cursor + 1, { type: "done", runId, searchesUsed: run.searchesUsed }];
      }
      return;
    }
    if (nowMs() > deadline) return;
    if (nowMs() - lastSent >= heartbeatMs) {
      yield PING;
      lastSent = nowMs();
    }
    await sleep(pollMs);
  }
}

export function encodeEvent(item: StreamItem): string {
  if (item === PING) return ": ping\n\n"; // an SSE comment: browsers ignore it, proxies see traffic
  return `id: ${item[0]}\ndata: ${JSON.stringify(item[1])}\n\n`;
}

/** Streams a generator of SSE chunks; closes when it ends or the client goes away. */
export function sseResponse(chunks: AsyncGenerator<string>, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await chunks.next();
        if (done || signal.aborted) {
          controller.close();
          return;
        }
        controller.enqueue(encoder.encode(value));
      } catch (err) {
        controller.error(err);
      }
    },
    cancel() {
      void chunks.return(undefined);
    },
  });
  return new Response(body, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" },
  });
}
