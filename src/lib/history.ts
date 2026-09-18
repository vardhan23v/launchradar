import type { Run, RunView, StepEvent } from "./types";

/**
 * Finished runs kept in this browser. On a serverless host the server forgets a run as soon
 * as its function is recycled, so the browser is the durable copy.
 */
const INDEX = "lr:runs";
const KEEP = 6;
const key = (id: string) => `lr:run:${id}`;

export interface SavedRun {
  view: RunView;
  events: StepEvent[];
}

function read<T>(k: string): T | null {
  try {
    const raw = window.localStorage.getItem(k);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // private mode, blocked storage or corrupt data: behave as if nothing was saved
  }
}

export function listSavedRuns(): Run[] {
  return read<Run[]>(INDEX) ?? [];
}

export function loadSavedRun(id: string): SavedRun | null {
  return read<SavedRun>(key(id));
}

export function saveRun(view: RunView, events: StepEvent[]): void {
  try {
    const index = [view.run, ...listSavedRuns().filter((r) => r.id !== view.run.id)];
    for (const old of index.slice(KEEP)) window.localStorage.removeItem(key(old.id));
    window.localStorage.setItem(key(view.run.id), JSON.stringify({ view, events }));
    window.localStorage.setItem(INDEX, JSON.stringify(index.slice(0, KEEP)));
  } catch {
    // quota exceeded: drop the oldest saved run and give up quietly; the page still works
    const oldest = listSavedRuns().pop();
    if (oldest) window.localStorage.removeItem(key(oldest.id));
  }
}

const PENDING = "lr:pending";

export interface PendingRun {
  question?: string;
  region?: string;
  demo?: string;
}

/** The home page hands the request to the run page without putting it in the URL. */
export function setPending(p: PendingRun): void {
  try {
    window.sessionStorage.setItem(PENDING, JSON.stringify(p));
  } catch {
    /* handled by the run page finding nothing */
  }
}

export function takePending(): PendingRun | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING);
    window.sessionStorage.removeItem(PENDING);
    return raw ? (JSON.parse(raw) as PendingRun) : null;
  } catch {
    return null;
  }
}
