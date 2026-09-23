"use client";

/** Server status and run starting, shared by the dashboard and the run page. */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { Run, StepEvent } from "@/lib/types";
import { setPending, type PendingRun } from "@/lib/history";

export interface HomeData {
  runs: Run[];
  demos: { slug: string; label: string; question: string }[];
  budget?: { run: number; monthUsed: number; monthLimit: number };
  pipeline?: { mode: string; ready: boolean; reason: string | null; quota?: string | null; inline?: boolean };
}

export async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

/** GET /api/runs once after mount. `down` is true when the API did not answer. */
export function useHome(): { home: HomeData | null; down: boolean; loaded: boolean } {
  const [home, setHome] = useState<HomeData | null>(null);
  const [down, setDown] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    void getJson<HomeData>("/api/runs").then((data) => {
      if (!alive) return;
      if (data) setHome(data);
      else setDown(true);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  return { home, down, loaded };
}

/** Why a new question cannot be researched right now, or null when it can. */
export function blockedReasonFor(home: HomeData | null, down: boolean): string | null {
  if (down) return "The research server is not reachable right now, so a new run cannot start.";
  if (!home) return "Connecting to the research server… The free server sleeps when idle, so this can take up to a minute.";
  if (home.pipeline?.ready === false) return home.pipeline.reason ?? "New questions are switched off on this server.";
  return home.pipeline?.quota ?? null;
}

/**
 * Starts a run and opens its page. On a serverless host the run page performs the run inside one
 * streaming request (the request is handed over through sessionStorage); elsewhere the API starts
 * it in the background. `busy` stays true once navigation begins, so a second click cannot start
 * (and pay for) a second run.
 */
export function useStartRun(home: HomeData | null) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async (payload: PendingRun) => {
      setError(null);
      setBusy(true);
      if (home?.pipeline?.inline) {
        setPending(payload);
        router.push("/runs/live");
        return;
      }
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
        setError(json?.error ?? `Could not start the run (HTTP ${res.status}).`);
      } catch {
        setError("Could not reach the research server.");
      }
      setBusy(false);
    },
    [home, router],
  );

  return { start, busy, error, clearError: useCallback(() => setError(null), []) };
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
      const e = JSON.parse(data[1]) as StepEvent;
      if (id) events[Number(id[1])] = e;
      else events.push(e);
    }
    return events;
  } catch {
    return null;
  }
}
