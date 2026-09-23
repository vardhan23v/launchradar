import { saveRun, takePending, type PendingRun } from "./history";
import type { LiveFrame, RunView, StepEvent } from "./types";

/**
 * A run that executes inside ONE streaming request (serverless hosts).
 *
 * The session lives at module level, not in a component: React runs effects twice in
 * development and remounts on navigation, and a second POST would start a second run and
 * spend the search budget twice. Components only subscribe.
 */
export interface LiveState {
  view: RunView | null;
  events: StepEvent[];
  error: string | null;
  done: boolean;
}

let state: LiveState | null = null;
const listeners = new Set<(s: LiveState) => void>();

/**
 * Kept for callers that still set it. The finished run's address is now derived from the live
 * page's own path (/runs/live -> /runs/<id>, /report/runs/live -> /report/runs/<id>, ...).
 */
export function setRunPathPrefix(prefix: string): void {
  void prefix;
}

function publish(patch: Partial<LiveState>): void {
  if (!state) return;
  state = { ...state, ...patch };
  listeners.forEach((fn) => fn(state as LiveState));
}

export function subscribeLive(fn: (s: LiveState) => void): () => void {
  listeners.add(fn);
  if (state) fn(state);
  return () => {
    listeners.delete(fn);
  };
}

/** Starts the pending run once. Returns false when there is nothing to start or follow. */
export function ensureLiveRun(): boolean {
  if (state && !state.done) return true;
  const pending = takePending();
  if (!pending) return state !== null;
  state = { view: null, events: [], error: null, done: false };
  void run(pending);
  return true;
}

async function run(pending: PendingRun): Promise<void> {
  try {
    const res = await fetch("/api/runs/live", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(pending),
    });
    if (!res.ok || !res.body) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      publish({ error: json?.error ?? `The run could not start (HTTP ${res.status}).`, done: true });
      return;
    }

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let cut: number;
      while ((cut = buffer.indexOf("\n\n")) >= 0) {
        const block = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        const data = block.split("\n").find((l) => l.startsWith("data:"));
        if (data) handle(JSON.parse(data.slice(5)) as LiveFrame);
      }
    }

    if (state && !state.done) {
      // the stream ended without `done`: the host cut the request off (its time limit)
      const view = state.view;
      if (view && view.run.status === "running") {
        view.run = { ...view.run, status: "failed", error: "The host ended this run before it finished. What was found so far is shown below." };
      }
      finish(view);
    }
  } catch {
    publish({ error: "The connection to the server was lost.", done: true });
  }
}

function handle(frame: LiveFrame): void {
  if (!state) return;
  if (frame.type === "view") {
    publish({ view: frame.view });
    return;
  }
  publish({ events: [...state.events, frame] });
  if (frame.type === "done") finish(state.view);
}

function finish(view: RunView | null): void {
  if (!state) return;
  if (view) {
    saveRun(view, state.events);
    // give the run its own address without reloading: a refresh now restores it from this browser.
    // Only while the live page is still showing, and under whichever view is showing it; if the
    // reader has moved on, rewriting the address would relabel an unrelated page.
    const path = window.location.pathname;
    if (path.endsWith("/runs/live")) window.history.replaceState(null, "", `${path.slice(0, -"live".length)}${view.run.id}`);
  }
  publish({ view, done: true });
}
