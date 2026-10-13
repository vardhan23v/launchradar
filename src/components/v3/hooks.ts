"use client";

/** Server status and run starting, shared by the dashboard and the run page. */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { Run, RunStatus, StepEvent } from "@/lib/types";
import type { PendingRun } from "@/lib/history";
import { parseStepEvent } from "@/lib/v3/run";

export interface HomeData {
  runs: Run[];
  demos: { slug: string; label: string; question: string }[];
  budget?: { run: number; monthUsed: number; monthLimit: number };
  /** `quota` says why a new run cannot start right now: the search budget, a run in progress, or the runs-per-hour limit */
  pipeline?: { mode: string; ready: boolean; reason: string | null; quota?: string | null };
}

/** What the server said when it could not start or answer: the bare 500 gets a sentence a visitor can act on. */
export const INTERNAL_ERROR = "Something went wrong on our side. Try again in a minute.";
export const START_INTERNAL_ERROR = "Something went wrong on our side. Nothing was started; try again in a minute.";
export const UNREACHABLE = "We can't reach the server.";

export function serverMessage(status: number, error: string | undefined, fallback: string, starting = false): string {
  if (status >= 500 && (!error || /^internal error$/i.test(error.trim()))) return starting ? START_INTERNAL_ERROR : INTERNAL_ERROR;
  return error || fallback;
}

/** A GET whose failure modes stay apart: the page shows "not found" and "cannot reach" differently. */
export type Fetched<T> = { kind: "ok"; data: T } | { kind: "not-found" } | { kind: "unreachable" } | { kind: "error"; status: number; message: string };

export async function fetchJson<T>(url: string): Promise<Fetched<T>> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return { kind: "unreachable" };
  }
  if (res.status === 404) return { kind: "not-found" };
  const body = (await res.json().catch(() => null)) as unknown;
  // a gateway answer with no JSON in it is the proxy saying the research server is not there
  if ((res.status === 502 || res.status === 503 || res.status === 504) && body === null) return { kind: "unreachable" };
  if (!res.ok) {
    const error = body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string" ? (body as { error: string }).error : undefined;
    return { kind: "error", status: res.status, message: serverMessage(res.status, error, `The server answered with an error (HTTP ${res.status}).`) };
  }
  if (body === null || typeof body !== "object") return { kind: "error", status: res.status, message: "The server sent an answer this page can't read." };
  return { kind: "ok", data: body as T };
}

export async function getJson<T>(url: string): Promise<T | null> {
  const r = await fetchJson<T>(url);
  return r.kind === "ok" ? r.data : null;
}

/** GET /api/runs once after mount (and again on `reload`). `down` is true when the API did not answer. */
export function useHome(): { home: HomeData | null; down: boolean; loaded: boolean; reload: () => void } {
  const [home, setHome] = useState<HomeData | null>(null);
  const [down, setDown] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void getJson<HomeData>("/api/runs").then((data) => {
      if (!alive) return;
      if (data) {
        setHome(data);
        setDown(false);
      } else setDown(true);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [tick]);
  return { home, down, loaded, reload: useCallback(() => setTick((t) => t + 1), []) };
}

/** Why a new search cannot start right now, or null when it can. */
export function blockedReasonFor(home: HomeData | null, down: boolean): string | null {
  if (down) return "We can't reach the server right now, so a new search can't start.";
  if (!home) return "Connecting to the server…";
  if (home.pipeline?.ready === false) return home.pipeline.reason ?? "New searches are switched off on this server.";
  return home.pipeline?.quota ?? null;
}

/**
 * Starts a search (a run) and opens its page. The API starts the research in the background and
 * the run page follows it. `busy` stays true once navigation begins, so a second click cannot
 * start (and pay for) a second run.
 */
export function useStartRun() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (payload: PendingRun) => {
      setError(null);
      setBusy(true);
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
        if (json?.id) {
          router.push(`/runs/${json.id}`);
          return; // stay busy until the next page takes over
        }
        setError(serverMessage(res.status, json?.error, `The search couldn't be started (HTTP ${res.status}).`, true));
      } catch {
        setError(`${UNREACHABLE} Check your connection and try again.`);
      }
      setBusy(false);
    },
    [router],
  );

  return { start, busy, error, clearError: useCallback(() => setError(null), []) };
}

/**
 * The tab's title follows the search: "Searching… · question" while it runs, then "Done · question"
 * or "Stopped · question". The title from before comes back when the page goes away.
 */
export function useRunTitle(status: RunStatus | null, question: string | null) {
  const before = useRef<string | null>(null);
  const ours = useRef<string | null>(null);
  useEffect(() => {
    if (before.current === null) before.current = document.title;
    return () => {
      // only undo a title this page set: the page we moved on to may have set its own already
      if (before.current !== null && ours.current !== null && document.title === ours.current) document.title = before.current;
    };
  }, []);
  useEffect(() => {
    if (!status || !question) return;
    const word = status === "complete" ? "Done" : status === "failed" ? "Stopped" : "Searching…";
    const wanted = `${word} · ${question}`;
    ours.current = wanted;
    // The tab shows the first <title> in <head>. The page's own title (the link preview) is streamed
    // in later and can land in <body>, so this writes a <head> title of its own and keeps it current.
    const apply = () => {
      let el = document.head.querySelector("title");
      if (!el) {
        el = document.createElement("title");
        document.head.prepend(el);
      }
      if (el.textContent !== wanted) el.textContent = wanted;
    };
    apply();
    const watcher = new MutationObserver(apply);
    watcher.observe(document.head, { childList: true, subtree: true, characterData: true });
    return () => watcher.disconnect();
  }, [status, question]);
}

const notifyKey = (runId: string) => `lr:v3:notify:${runId}`;

function rememberNotify(runId: string, on: boolean): void {
  try {
    if (on) window.sessionStorage.setItem(notifyKey(runId), "1");
    else window.sessionStorage.removeItem(notifyKey(runId));
  } catch {
    /* storage blocked: the choice holds for this page only */
  }
}

/** Asks for permission; older browsers answer through a callback instead of a promise, and a browser that throws has said no. */
function askNotifyPermission(): Promise<NotificationPermission> {
  return new Promise((resolve) => {
    try {
      const r: unknown = Notification.requestPermission((p) => resolve(p));
      if (r && typeof (r as Promise<NotificationPermission>).then === "function") (r as Promise<NotificationPermission>).then(resolve, () => resolve("denied"));
    } catch {
      resolve("denied");
    }
  });
}

/**
 * "Tell me when it's done": a browser notification when the search finishes while this tab is in
 * the background. Permission is only ever asked for on a click, and the choice is kept per search
 * for this tab (sessionStorage). `available` is false when the browser has no notifications or
 * has refused them, so the button can stay hidden.
 */
export function useDoneNotice(runId: string, status: RunStatus | null, question: string | null) {
  const [available, setAvailable] = useState(false);
  const [wanted, setWanted] = useState(false);

  // read after mount: the server render has no window, and permission may change between visits
  useEffect(() => {
    const t = window.setTimeout(() => {
      try {
        const has = typeof window !== "undefined" && "Notification" in window && typeof Notification !== "undefined";
        setAvailable(has && Notification.permission !== "denied");
        setWanted(has && Notification.permission === "granted" && window.sessionStorage.getItem(notifyKey(runId)) === "1");
      } catch {
        setAvailable(false);
        setWanted(false);
      }
    }, 0);
    return () => window.clearTimeout(t);
  }, [runId]);

  const toggle = useCallback(async () => {
    if (wanted) {
      rememberNotify(runId, false);
      setWanted(false);
      return;
    }
    const permission = await askNotifyPermission();
    if (permission === "granted") {
      rememberNotify(runId, true);
      setWanted(true);
    } else if (permission === "denied") {
      setAvailable(false);
    }
  }, [runId, wanted]);

  // one notification, when the search finishes during this visit and the reader is looking elsewhere
  const previous = useRef<RunStatus | null>(status);
  useEffect(() => {
    const was = previous.current;
    previous.current = status;
    const finished = status === "complete" || status === "failed";
    const wasRunning = was === "running" || was === "queued";
    if (!finished || !wasRunning || !wanted || !question) return;
    try {
      if (!document.hidden || Notification.permission !== "granted") return;
      const n = new Notification("LaunchRadar", { body: `${status === "complete" ? "Done" : "Stopped"}: ${question}`, tag: `lr-run-${runId}` });
      n.onclick = () => {
        try {
          window.focus();
          n.close();
        } catch {
          /* nothing to focus */
        }
      };
    } catch {
      /* the browser has the API but will not show one here */
    }
  }, [status, wanted, question, runId]);

  return { available, wanted, toggle };
}

/**
 * The research log of a finished run, read from its stream (a finished run replays its whole log
 * and the response ends). Used to keep a full copy of a run in this browser.
 */
export async function fetchRunEvents(runId: string): Promise<StepEvent[] | null> {
  try {
    const res = await fetch(`/api/runs/${runId}/stream`);
    if (!res.ok) return null;
    const text = await res.text();
    const events: StepEvent[] = [];
    for (const block of text.split("\n\n")) {
      const id = /^id: (\d+)$/m.exec(block);
      const data = /^data: (.*)$/m.exec(block);
      if (!data) continue;
      const e = parseStepEvent(data[1]);
      if (!e) continue; // a truncated or foreign frame: skip it rather than keep a broken log
      const index = id ? Number(id[1]) : NaN;
      if (Number.isSafeInteger(index) && index >= 0 && index < 10_000) events[index] = e;
      else events.push(e);
    }
    return events;
  } catch {
    return null;
  }
}
