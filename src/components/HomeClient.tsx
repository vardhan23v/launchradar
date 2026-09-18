"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { Run } from "@/lib/types";
import { Lines, StatusText, Wordmark } from "@/components/ui";

interface HomeData {
  runs: Run[];
  demos: { slug: string; label: string; question: string; region: string; searches: number }[];
  budget?: { run: number; monthUsed: number; monthLimit: number };
  pipeline?: { mode: string; ready: boolean; reason: string | null; quota?: string | null };
}

const API_DOWN = "The API is not reachable. Start it with: npm run api";

function shortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
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

  async function start(payload: Record<string, string>) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      // a crashed route answers with an empty or HTML body; never let that throw here
      const json = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (json?.id) router.push(`/runs/${json.id}`);
      else setError(json?.error ?? `Could not start the run (HTTP ${res.status}).`);
    } catch {
      setError("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const blocked = data?.pipeline?.ready === false;
  const quota = data?.pipeline?.quota ?? null;
  const canRun = !busy && question.trim().length > 0 && !blocked && !quota;
  const submit = () => {
    if (canRun) void start({ question: question.trim(), region });
  };

  return (
    <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pb-24">
      <header className="flex items-baseline justify-between border-b border-rule py-4">
        <Wordmark />
        {data?.budget && (
          <span className="hidden font-mono text-xs tabular-nums text-muted sm:inline">
            {data.budget.monthUsed}/{data.budget.monthLimit} searches this month
          </span>
        )}
      </header>

      <section className="pt-16 sm:pt-24">
        <label htmlFor="q" className="block max-w-[16ch] font-serif text-[34px] leading-[1.05] tracking-tight min-[420px]:text-[44px] sm:text-[60px]">
          What market are you looking at?
        </label>

        <div className="mt-10 border-b-2 border-rule focus-within:border-accent">
          <textarea
            id="q"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={300}
            placeholder="AI tools for college students in India"
            className="block w-full resize-none bg-transparent pb-3 font-serif text-2xl outline-none placeholder:text-muted/50 sm:text-[28px]"
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            Region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="cursor-pointer border-b border-border bg-transparent py-0.5 pr-1 text-ink outline-none hover:border-ink"
            >
              <option value="in">India</option>
              <option value="us">United States</option>
              <option value="uk">United Kingdom</option>
            </select>
          </label>
          <span className="text-sm text-muted">Uses up to {data?.budget?.run ?? 25} searches</span>
          <button
            onClick={submit}
            disabled={!canRun}
            className="ml-auto bg-ink px-5 py-2.5 text-sm font-semibold text-background hover:bg-accent hover:text-on-accent disabled:cursor-not-allowed disabled:bg-surface-2 disabled:text-muted"
          >
            {busy ? "Starting" : "Research"}
          </button>
        </div>

        {error && <p className="appear mt-6 border-l-2 border-danger pl-4 text-sm text-danger">{error}</p>}
        {quota && !blocked && (
          <p className="appear mt-6 border-l-2 border-warn pl-4 text-sm text-warn">
            {quota} Opening a past run or the recorded example costs nothing.
          </p>
        )}
        {blocked && (
          <p className="appear mt-6 border-l-2 border-warn pl-4 text-sm text-warn">
            New questions are switched off. {data?.pipeline?.reason} The recorded example below works without a key.
          </p>
        )}
      </section>

      <section className="mt-20">
        <h2 className="kicker text-muted">Runs</h2>
        <div className="mt-3 border-t border-rule">
          {!data && !error && <Lines rows={3} />}
          {(data?.demos ?? []).map((d) => (
            <button
              key={d.slug}
              onClick={() => void start({ demo: d.slug })}
              disabled={busy}
              className="group grid w-full grid-cols-[1fr_auto] items-baseline gap-x-6 border-b border-border py-3.5 text-left disabled:opacity-50 sm:grid-cols-[110px_1fr_auto]"
            >
              <span className="kicker hidden text-muted sm:block">Example</span>
              <span className="font-serif text-lg leading-snug group-hover:text-accent">{d.question}</span>
              <span className="font-mono text-xs tabular-nums text-muted">{d.searches} searches</span>
            </button>
          ))}
          {(data?.runs ?? []).slice(0, 8).map((r) => (
            <button
              key={r.id}
              onClick={() => router.push(`/runs/${r.id}`)}
              className="group grid w-full grid-cols-[1fr_auto] items-baseline gap-x-6 border-b border-border py-3.5 text-left sm:grid-cols-[110px_1fr_auto]"
            >
              <span className="hidden sm:block"><StatusText status={r.status} /></span>
              <span className="font-serif text-lg leading-snug group-hover:text-accent">{r.question}</span>
              <span className="font-mono text-xs tabular-nums text-muted">
                {r.searchesUsed} · {shortDate(r.createdAt)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="mt-20 grid gap-x-10 gap-y-3 border-t border-rule pt-5 sm:grid-cols-[110px_1fr]">
        <h2 className="kicker text-muted">Method</h2>
        <p className="max-w-[62ch] font-serif text-[17px] leading-relaxed">
          Search results are the only source of facts. A model plans the searches and organises what comes back, but it
          may not add a company, a number or a claim of its own. Every statement must quote its source word for word, or
          it is thrown out. Each gap is then tested by searching for a product that already fills it, and the score is
          arithmetic on what was counted.
        </p>
      </section>
    </main>
  );
}
