"use client";

/**
 * Host for the redesigned run screen, mounted at /v2/runs/[id].
 *
 * It reproduces the report view's three ways of loading a run — the single streaming request for
 * live runs, saved-first restoration from this browser, and the server view with its event stream
 * and polling — and feeds the results to the pure RunScreen as props.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { RunView, StepEvent } from "@/lib/types";
import { deleteSavedRun, listSavedRuns, loadSavedRun, setPending } from "@/lib/history";
import { ensureLiveRun, setRunPathPrefix, subscribeLive } from "@/lib/live";
import {
  loadDensity,
  loadIds,
  loadTheme,
  logFromEvents,
  saveDensity,
  saveIds,
  saveTheme,
  viewToRunVM,
} from "@/lib/v2/adapter";
import { diffRuns, fileExports, type DensityVM, type RunVM, type ThemeVM } from "@/lib/v2/viewModel";
import { Banner, Btn, Empty, Skeleton, saveTextFile } from "./primitives";
import ResearchLog from "./ResearchLog";
import RunScreen from "./RunScreen";

interface PipelineInfo {
  ready: boolean;
  inline?: boolean;
}

export default function RunV2({ runId }: { runId: string }) {
  const router = useRouter();
  const [view, setView] = useState<RunView | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeVM>("system");
  const [density, setDensity] = useState<DensityVM>("comfortable");
  const [shortlisted, setShortlisted] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<PipelineInfo | null>(null);

  const isLive = runId === "live";
  // the live session renames the address to the real run id once it finishes
  const currentId = view?.run.id ?? runId;

  // preferences are this browser's own; read them after mount so SSR and hydration agree
  useEffect(() => {
    const id = window.setTimeout(() => {
      setTheme(loadTheme());
      setDensity(loadDensity());
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  // triage choices are keyed by the run's address; a live run starts at "live" and the finished
  // run takes its real id, so carry any choices made during the stream across that rename
  useEffect(() => {
    const id = window.setTimeout(() => {
      const finishedId = view?.run.id;
      if (isLive && finishedId && finishedId !== "live") {
        for (const kind of ["shortlist", "dismissed"] as const) {
          const made = loadIds("live", kind);
          if (made.length > 0) {
            saveIds(finishedId, kind, made);
            try {
              window.localStorage.removeItem(`lr:v2:${kind}:live`);
            } catch {
              /* storage blocked: the choices simply will not persist */
            }
          }
        }
      }
      setShortlisted(loadIds(currentId, "shortlist"));
      setDismissed(loadIds(currentId, "dismissed"));
    }, 0);
    return () => window.clearTimeout(id);
  }, [currentId, isLive, view?.run.id]);

  // (1) a run streamed over a single request — the serverless path. The session is module-level:
  // subscribing twice never starts a second run or spends the search budget twice.
  useEffect(() => {
    if (!isLive) return;
    setRunPathPrefix("/v2/runs/");
    if (!ensureLiveRun()) {
      router.replace("/v2");
      return;
    }
    const unsubscribe = subscribeLive((s) => {
      if (s.view) setView(s.view);
      setEvents(s.events);
      if (s.error) setStartError(s.error);
    });
    return () => {
      unsubscribe();
      // the report view owns /runs/ addresses; never leave the v2 prefix behind
      setRunPathPrefix("/runs/");
    };
  }, [isLive, router]);

  const fetchView = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return null;
    const v = (await res.json()) as RunView;
    setView(v);
    return v;
  }, [runId]);

  // (2) a run the server knows, or (3) one saved in this browser — the report view's same logic,
  // with addresses and redirects pointed at /v2
  useEffect(() => {
    if (isLive) return;
    let alive = true;
    let es: EventSource | null = null;
    let poll: number | undefined;
    const stop = () => {
      es?.close();
      es = null;
      if (poll !== undefined) window.clearInterval(poll);
      poll = undefined;
    };

    void (async () => {
      // A finished run never changes, and this browser's copy is complete (results + log).
      // Prefer it: on a serverless host a second request may reach an instance that never saw the run.
      const saved = loadSavedRun(runId);
      if (saved && saved.view.run.status !== "running") {
        await Promise.resolve(); // keep state updates out of the effect's synchronous body
        if (!alive) return;
        setView(saved.view);
        setEvents(saved.events);
        return;
      }
      const v = await fetchView();
      if (!alive) return;
      if (!v) {
        setNotFound(true);
        return;
      }
      // Always attach: a finished run replays its persisted log instantly. Events are stored by
      // server index, so reconnects and double-invoked effects never duplicate.
      es = new EventSource(`/api/runs/${runId}/stream`);
      es.onmessage = (msg) => {
        const index = Number.parseInt(msg.lastEventId, 10);
        const e = JSON.parse(msg.data as string) as StepEvent;
        setEvents((prev) => {
          if (!Number.isFinite(index)) return [...prev, e];
          if (prev[index] !== undefined) return prev;
          const next = [...prev];
          next[index] = e;
          return next;
        });
        if (e.type === "status" || e.type === "done") void fetchView();
        if (e.type === "done") stop();
      };
      es.onerror = () => {
        // the run vanished from the server mid-stream (function recycled): stop retrying
        if (es?.readyState === EventSource.CLOSED) stop();
      };
      if (v.run.status === "running") {
        poll = window.setInterval(() => {
          void fetchView().then((nv) => {
            if (nv && nv.run.status !== "running" && poll !== undefined) {
              window.clearInterval(poll);
              poll = undefined;
            }
          });
        }, 2000);
      }
    })();

    return () => {
      alive = false;
      stop();
    };
  }, [isLive, runId, fetchView]);

  // pipeline readiness decides how a re-run is started (inline streaming vs a server-side run)
  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs")
      .then((res) => (res.ok ? (res.json() as Promise<{ pipeline?: PipelineInfo }>) : null))
      .then((json) => {
        if (!cancelled && json) setPipeline(json.pipeline ?? { ready: true });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // the previous run of the same question kept in this browser, for the change view
  const currentRunId = view?.run.id;
  const previous = useMemo<RunVM | undefined>(() => {
    if (!currentRunId || !view || view.run.demo) return undefined;
    const entry = listSavedRuns().find((r) => r.question === view.run.question && r.id !== currentRunId);
    if (!entry) return undefined;
    const saved = loadSavedRun(entry.id);
    return saved ? viewToRunVM(saved.view, { events: saved.events }) : undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRunId]);

  /** The current frame as the board sees it, annotated with change markers when a previous exists. */
  const run = useMemo<RunVM | null>(() => {
    if (!view) return null;
    const current = viewToRunVM(view, { events });
    return previous ? diffRuns(previous, current) : current;
  }, [view, events, previous]);

  const onToggleShortlist = useCallback(
    (id: string) => {
      setShortlisted((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        saveIds(currentId, "shortlist", next);
        return next;
      });
    },
    [currentId],
  );

  const onToggleDismiss = useCallback(
    (id: string) => {
      setDismissed((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        saveIds(currentId, "dismissed", next);
        return next;
      });
    },
    [currentId],
  );

  const onExport = useCallback(
    (format: "markdown" | "json" | "csv", shortlistOnly: boolean) => {
      if (!run) return;
      const file = fileExports(run, { shortlistOnly, shortlisted }, "launchradar").find(
        (f) => f.id === format,
      );
      if (file) saveTextFile(file.filename, file.mime, file.text);
    },
    [run, shortlisted],
  );

  const onRerun = useCallback(() => {
    if (!view || view.run.demo) {
      // recorded examples are fixed fixtures; there is nothing to re-run
      router.push("/v2");
      return;
    }
    const { question, region } = view.run;
    if (pipeline?.inline) {
      setRunPathPrefix("/v2/runs/");
      setPending({ question, region });
      router.push("/v2/runs/live");
      return;
    }
    void (async () => {
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question, region }),
        });
        const json = (await res.json().catch(() => null)) as { id?: string } | null;
        if (json?.id) router.push(`/v2/runs/${json.id}`);
        else router.push("/v2");
      } catch {
        router.push("/v2");
      }
    })();
  }, [view, pipeline, router]);

  const onDelete = useCallback(() => {
    if (view) deleteSavedRun(view.run.id);
    router.push("/v2");
  }, [view, router]);

  /** Offered when the finished run left a stage out, so the user can fill the hole deliberately. */
  const onRetryMissing = useMemo(() => {
    if (!run || run.demo || run.status !== "done" || pipeline?.ready === false) return undefined;
    return run.stages.some((s) => s.status === "skipped" || s.status === "failed") ? onRerun : undefined;
  }, [run, pipeline, onRerun]);

  if (notFound) {
    return (
      <div className="lr-root" data-lr-theme={theme === "light" ? "light" : "dark"} data-lr-density={density}>
        <main className="lr-main">
          <Empty
            title="There is no run at this address."
            text="It may have been deleted from this browser, or the server no longer holds it."
            action={<Btn variant="primary" onClick={() => router.push("/v2")}>Back to LaunchRadar</Btn>}
          />
        </main>
      </div>
    );
  }

  if (!view || !run) {
    return (
      <div className="lr-root" data-lr-theme={theme === "light" ? "light" : "dark"} data-lr-density={density}>
        <main className="lr-main">
          {startError ? (
            <Banner tone="bad" title="This run could not start">
              {startError}
            </Banner>
          ) : (
            <Skeleton lines={7} variant="card" />
          )}
        </main>
      </div>
    );
  }

  const live = view.run.status === "running";

  return (
    <RunScreen
      run={run}
      previous={previous}
      streaming={live}
      shortlisted={shortlisted}
      dismissed={dismissed}
      theme={theme}
      density={density}
      onTheme={(next) => {
        setTheme(next);
        saveTheme(next);
      }}
      onDensity={(next) => {
        setDensity(next);
        saveDensity(next);
      }}
      onBack={() => router.push("/v2")}
      onRerun={onRerun}
      onDelete={onDelete}
      onToggleShortlist={onToggleShortlist}
      onToggleDismiss={onToggleDismiss}
      onExport={onExport}
      onRetryMissing={onRetryMissing}
      asideExtra={<ResearchLog entries={logFromEvents(events)} live={live} />}
    />
  );
}
