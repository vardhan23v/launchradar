"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/schemas";

interface HomeData {
  runs: Run[];
  demos: { slug: string; label: string; question: string; region: string }[];
}

export default function HomeClient() {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [region, setRegion] = useState("in");
  const [data, setData] = useState<HomeData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/runs")
      .then((res) => (res.ok ? (res.json() as Promise<HomeData>) : null))
      .then((json) => {
        if (!cancelled && json) setData(json);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function startDemo(slug: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ demo: slug }),
      });
      const json = (await res.json()) as { id: string; error?: string };
      if (json.error) setError(json.error);
      else router.push(`/runs/${json.id}`);
    } finally {
      setBusy(false);
    }
  }

  async function startLive() {
    if (!question.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: question.trim(), region }),
      });
      const json = (await res.json()) as { id: string; mode?: string; error?: string };
      if (json.error) setError(json.error);
      else router.push(`/runs/${json.id}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">
      <header className="mb-8">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-accent" />
          <h1 className="text-xl font-bold tracking-tight">LaunchRadar</h1>
        </div>
        <p className="mt-1 text-sm text-muted">
          A market question, evidence-backed product opportunities. SerpApi is the only source of facts.
        </p>
      </header>

      <section className="rounded-xl border border-border bg-white p-5 shadow-sm">
        <label className="mb-1.5 block text-sm font-semibold" htmlFor="q">
          Market question
        </label>
        <textarea
          id="q"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={2}
          placeholder="e.g. AI tools for college students in India"
          className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">
            Region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="rounded-md border border-border bg-white px-2 py-1 text-xs outline-none focus:border-accent"
            >
              <option value="in">India (gl=in)</option>
              <option value="us">United States</option>
              <option value="uk">United Kingdom</option>
            </select>
          </label>
          <button
            onClick={() => void startLive()}
            disabled={busy || !question.trim()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Starting…" : "Run research"}
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
        <p className="mt-3 text-[11px] text-muted">
          A run spends up to 25 SerpApi searches across engines (discovery 12 · competitors 6 · gap verification 5 · trends 2).
        </p>
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-muted">Pre-recorded demo runs</h2>
        <div className="grid gap-2">
          {(data?.demos ?? []).map((d) => (
            <button
              key={d.slug}
              onClick={() => void startDemo(d.slug)}
              disabled={busy}
              className="group flex items-center justify-between rounded-lg border border-border bg-white px-4 py-3 text-left shadow-sm transition-colors hover:border-accent"
            >
              <div>
                <div className="text-sm font-semibold">{d.label}</div>
                <div className="text-xs text-muted">Recorded run · 8 searches · replay the live research trace</div>
              </div>
              <span className="text-xs font-semibold text-accent group-hover:underline">Load demo →</span>
            </button>
          ))}
          {(data?.demos?.length ?? 0) === 0 && (
            <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">
              No demo runs recorded yet.
            </div>
          )}
        </div>
      </section>

      {(data?.runs?.length ?? 0) > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-semibold text-muted">Recent runs</h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-white">
            {data!.runs.slice(0, 6).map((r) => (
              <button
                key={r.id}
                onClick={() => router.push(`/runs/${r.id}`)}
                className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-accent-soft"
              >
                <span className="truncate text-sm font-medium">{r.question}</span>
                <span className="flex shrink-0 items-center gap-2 text-[11px] text-muted">
                  <span
                    className={
                      r.status === "complete"
                        ? "text-green-600"
                        : r.status === "failed"
                          ? "text-red-600"
                          : "text-amber-600"
                    }
                  >
                    {r.status}
                  </span>
                  <span>{r.searchesUsed}/{r.budget}</span>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}