"use client";

/**
 * Host for the redesigned home screen, mounted at /v2.
 *
 * The screen itself (HomeScreen.tsx) is pure: it never fetches, reads storage or navigates. This
 * component owns the router, the API, browser history and preferences, and translates them into
 * props — the same division the report view draws between HomeClient's data effects and its markup.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Run, RunView } from "@/lib/types";
import { deleteSavedRun, listSavedRuns, loadSavedRun, setPending } from "@/lib/history";
import { setRunPathPrefix } from "@/lib/live";
import { codeForLabel, loadDensity, loadTheme, runListVM, saveDensity, saveTheme, storageWorks, viewToRunVM } from "@/lib/v2/adapter";
import { fileExports, type DensityVM, type RunVM, type ThemeVM } from "@/lib/v2/viewModel";
import { saveTextFile } from "./primitives";
import HomeScreen from "./HomeScreen";

interface HomeData {
  runs: Run[];
  demos: { slug: string; label: string; question: string }[];
  budget?: { run: number; monthUsed: number; monthLimit: number };
  pipeline?: { mode: string; ready: boolean; reason: string | null; quota?: string | null; inline?: boolean };
}

const API_DOWN = "The API is not reachable. Start it with: npm run api";

/** The full view when this browser keeps one, otherwise just the list entry. */
function vmForSavedRun(entry: Run): RunVM {
  const saved = loadSavedRun(entry.id);
  if (saved) return viewToRunVM(saved.view, { events: saved.events });
  return runListVM(entry);
}

export default function HomeV2() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [region, setRegion] = useState<string>("India");
  const [data, setData] = useState<HomeData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [runs, setRuns] = useState<RunVM[]>([]);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [theme, setTheme] = useState<ThemeVM>("system");
  const [density, setDensity] = useState<DensityVM>("comfortable");

  // this browser's copy, read after mount so SSR and hydration agree
  useEffect(() => {
    const id = window.setTimeout(() => {
      setTheme(loadTheme());
      setDensity(loadDensity());
      if (!storageWorks()) {
        setHistoryWarning(
          "This browser blocks local storage, so past runs and your choices will not survive a reload.",
        );
      }
      setRuns(listSavedRuns().map(vmForSavedRun));
    }, 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs")
      .then((res) => (res.ok ? (res.json() as Promise<HomeData>) : null))
      .then((json) => {
        if (cancelled) return;
        if (json) setData(json);
        else setError(API_DOWN); // the Next.js proxy answers 500 when the Python API is down
      })
      .catch(() => {
        if (!cancelled) setError(API_DOWN);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Server rows this browser does not already hold, newest first, after the local copies. */
  const allRuns = useMemo(() => {
    if (!data) return runs;
    const local = new Set(runs.map((r) => r.id));
    const server = data.runs.filter((r) => !local.has(r.id)).map((r) => runListVM(r));
    return [...runs, ...server];
  }, [data, runs]);

  const liveAvailable = !!data && data.pipeline?.ready !== false && !data.pipeline?.quota && !error;

  const start = useCallback(
    async (payload: { question?: string; region?: string; demo?: string }) => {
      setError(null);
      setBusy(true);
      if (data?.pipeline?.inline) {
        // serverless host: the run page performs the run inside one streaming request.
        // setPending hands the request over; ensureLiveRun starts it exactly once.
        setRunPathPrefix("/v2/runs/");
        setPending(payload);
        router.push("/v2/runs/live");
        return;
      }
      try {
        const res = await fetch("/api/runs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        // a crashed route answers with an empty or HTML body; never let that throw here
        const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
        if (json?.id) router.push(`/v2/runs/${json.id}`);
        else setError(json?.error ?? `Could not start the run (HTTP ${res.status}).`);
      } catch {
        setError("Could not reach the server.");
      } finally {
        setBusy(false);
      }
    },
    [data, router],
  );

  const rerun = useCallback(
    (id: string) => {
      // the region field on a stored run is already the backend's short code
      const saved = loadSavedRun(id);
      if (saved) {
        void start({ question: saved.view.run.question, region: saved.view.run.region });
        return;
      }
      const entry = [...listSavedRuns(), ...(data?.runs ?? [])].find((r) => r.id === id);
      if (entry) void start({ question: entry.question, region: entry.region });
    },
    [data, start],
  );

  const remove = useCallback((id: string) => {
    deleteSavedRun(id);
    setRuns((prev) => prev.filter((r) => r.id !== id));
  }, []);

  /** Local export from the browser's own copy; the server's copy fills in when local is gone. */
  const exportRun = useCallback((id: string, format: "markdown" | "json" | "csv") => {
    const write = (view: RunView) => {
      const saved = loadSavedRun(id);
      const vm = viewToRunVM(view, { events: saved?.events ?? [] });
      const file = fileExports(vm, {}, "launchradar").find((f) => f.id === format);
      if (file) saveTextFile(file.filename, file.mime, file.text);
    };
    const saved = loadSavedRun(id);
    if (saved) {
      write(saved.view);
      return;
    }
    void fetch(`/api/runs/${id}`)
      .then((res) => (res.ok ? (res.json() as Promise<RunView>) : null))
      .then((view) => {
        if (view) write(view);
      })
      .catch(() => undefined);
  }, []);

  return (
    <HomeScreen
      runs={allRuns}
      question={question}
      region={region}
      busy={busy}
      error={error}
      liveAvailable={liveAvailable}
      historyWarning={historyWarning}
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
      onChangeQuestion={setQuestion}
      onChangeRegion={setRegion}
      onStart={() => {
        if (question.trim().length > 0)
          void start({ question: question.trim(), region: codeForLabel(region) });
      }}
      onOpenRun={(id) => router.push(`/v2/runs/${id}`)}
      onRerun={rerun}
      onDeleteRun={remove}
      onExportRun={exportRun}
      demos={(data?.demos ?? []).map((d) => ({ slug: d.slug, label: d.label, question: d.question }))}
      onStartDemo={(slug) => void start({ demo: slug })}
    />
  );
}
