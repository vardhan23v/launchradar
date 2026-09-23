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

/**
 * Keep a copy of a run that finished on a long-lived server (Render, local). That server's disk is
 * temporary (a free Render service forgets everything when it sleeps), so without this a finished
 * run would vanish from history. Saves once per finish: viewing an already-saved run changes nothing.
 */
export function saveFinishedRun(view: RunView, events: StepEvent[]): void {
  if (view.run.status === "running" || view.run.status === "queued") return;
  if (!events.some((e) => e?.type === "done")) return; // the research log is not complete yet
  const saved = loadSavedRun(view.run.id);
  if (saved && saved.view.run.status === view.run.status && saved.view.run.finishedAt === view.run.finishedAt) return;
  saveRun(view, events.filter(Boolean));
}

/** Remove a stored run and its entry from the index (used by the triage view). */
export function deleteSavedRun(id: string): void {
  try {
    window.localStorage.removeItem(key(id));
    window.localStorage.setItem(INDEX, JSON.stringify(listSavedRuns().filter((r) => r.id !== id)));
  } catch {
    /* storage blocked or full: the list simply keeps showing this browser's copy */
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
