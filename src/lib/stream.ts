import { CONFIG } from "./config";
import type { StepEvent } from "./schemas";
import type { Store } from "./store";
import { sleep } from "./utils";

/**
 * Replay a run's persisted step events as an event stream.
 * First play replays them with realistic pacing so the research trace animates;
 * after the run completes, the stored events replay instantly (refresh-safe).
 */
export async function* replayRunEvents(
  store: Store,
  runId: string,
): AsyncGenerator<StepEvent> {
  const run = store.getRun(runId);
  if (!run) return;

  const events = store.eventsFor(runId);
  const instant = run.status === "complete" || run.status === "failed";

  for (const event of events) {
    yield event;
    if (!instant) await sleep(delayFor(event));
  }

  // final status transition
  const now = store.getRun(runId);
  if (now && now.status === "running") {
    store.updateRun(runId, { status: "complete", finishedAt: Date.now() });
    yield { type: "status", status: "complete" };
    yield {
      type: "done",
      runId,
      searchesUsed: now.searchesUsed,
    };
    if (!instant) await sleep(CONFIG.demoDelayBaseMs);
  } else if (now && now.status === "failed" && events.length === 0) {
    yield { type: "status", status: "failed" };
    yield { type: "done", runId, searchesUsed: now.searchesUsed ?? 0 };
  }
}

function delayFor(event: StepEvent): number {
  switch (event.type) {
    case "search_call":
      return CONFIG.demoDelayMs + (event.call.latencyMs % 180);
    case "llm":
      return Math.round(CONFIG.demoDelayMs * 0.6);
    default:
      return CONFIG.demoDelayBaseMs;
  }
}

export function encodeEvent(event: StepEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}