"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Cluster, Evidence, Gap, Opportunity, RunView, Signal, StepEvent } from "@/lib/types";
import { citeGroups } from "@/lib/evidence";
import { loadSavedRun } from "@/lib/history";
import { ensureLiveRun, subscribeLive } from "@/lib/live";
import { GapText, Lines, Note, ScoreTable, StatusText, Tabs, Wordmark, confidenceWord, engineLabel } from "@/components/ui";

type Cite = (ids: string[], quote?: string) => void;
type Tab = "findings" | "problems" | "competitors";

// ---------- citations ----------

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  if (!quote) return <>{text}</>;
  const at = text.toLowerCase().indexOf(quote.toLowerCase());
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + quote.length)}</mark>
      {text.slice(at + quote.length)}
    </>
  );
}

/** A footnote-style reference: small, raised, and it opens the source. */
function Ref({ ids, quote, onCite }: { ids: string[]; quote?: string; onCite: Cite }) {
  return (
    <sup className="ml-0.5 whitespace-nowrap">
      <button
        type="button"
        onClick={() => onCite(ids, quote)}
        title="Open the source"
        className="font-mono text-[10.5px] text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
      >
        {ids.join(",")}
      </button>
    </sup>
  );
}

/** Turns "[E1,E2]" markers in prose into footnote references. */
function Cited({ text, onCite }: { text: string; onCite: Cite }) {
  const groups = useMemo(() => citeGroups(text), [text]);
  if (groups.length === 0) return <>{text}</>;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  groups.forEach((g, i) => {
    // pull the reference tight against the preceding word, before the full stop's space
    if (g.index > cursor) parts.push(text.slice(cursor, g.index).replace(/\s+$/, ""));
    parts.push(<Ref key={i} ids={g.ids} onCite={onCite} />);
    cursor = g.index + g.length;
  });
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}

// ---------- progress + research log ----------

const PIPELINE: [string, string[]][] = [
  ["Plan", ["planner", "autocomplete-seed"]],
  ["Discover", ["discovery"]],
  ["Extract", ["signals", "extract"]],
  ["Cluster", ["cluster", "trends"]],
  ["Competitors", ["competitors"]],
  ["Verify", ["gaps", "verify"]],
  ["Score", ["score", "opportunity", "skeptic", "done"]],
];

function stageOf(e: StepEvent): string | null {
  if (e.type === "stage" || e.type === "llm") return e.stage;
  if (e.type === "search_call") return e.call.stage;
  return null;
}

/** Where the run is, derived purely from the event log. */
function Progress({ events, status }: { events: StepEvent[]; status: string }) {
  let reached = -1;
  for (const e of events) {
    const st = e ? stageOf(e) : null;
    const i = st ? PIPELINE.findIndex(([, keys]) => keys.includes(st)) : -1;
    if (i > reached) reached = i;
  }
  const done = status === "complete";
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-xs" aria-label="Pipeline progress">
      {PIPELINE.map(([name], i) => {
        const past = done || i < reached;
        const now = !done && i === reached;
        return (
          <li key={name} className={now ? (status === "failed" ? "text-danger" : "text-accent") : past ? "text-ink" : "text-muted/60"}>
            <span className="tabular-nums">{String(i + 1).padStart(2, "0")}</span> {name}
            {now && status === "running" && <span className="blink"> ●</span>}
            {past && <span className="text-muted"> ✓</span>}
          </li>
        );
      })}
    </ol>
  );
}

function ResearchLog({ events, status }: { events: StepEvent[]; status: string }) {
  const box = useRef<HTMLDivElement>(null);
  const count = events.length;
  useEffect(() => {
    if (status === "running" && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count, status]);

  // search number per event index, computed up front so rendering stays pure
  const numbers = useMemo(() => {
    const out: number[] = [];
    let seen = 0;
    events.forEach((e, i) => {
      if (e?.type === "search_call") out[i] = ++seen;
    });
    return out;
  }, [events]);

  return (
    <section aria-label="Research log">
      <h2 className="kicker border-b border-rule pb-2 text-muted">Research log</h2>
      <div ref={box} className="max-h-72 overflow-y-auto lg:max-h-[calc(100vh-150px)]" aria-live="polite">
        {count === 0 && <p className="py-4 text-sm text-muted">Waiting for the first step.</p>}
        {events.map((e, i) => {
          if (!e) return null;
          if (e.type === "search_call") {
            const n = numbers[i];
            const bad = e.call.status !== "ok";
            return (
              <div key={i} className="appear grid grid-cols-[22px_1fr] gap-x-2 border-b border-border py-2">
                <span className="pt-px font-mono text-[11px] tabular-nums text-muted">{n}</span>
                <div className="min-w-0">
                  <div className={`break-words text-[13px] leading-snug ${bad ? "text-muted line-through" : ""}`}>{e.call.query}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-muted">
                    {engineLabel(e.call.engine)}
                    {bad ? (
                      <span className="text-danger"> · {e.call.status}</span>
                    ) : (
                      <>
                        {" · "}{e.call.resultCount} results · {e.call.cached ? "cached" : `${(e.call.latencyMs / 1000).toFixed(1)}s`}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          }
          if (e.type === "stage" && e.level !== "info") {
            const tone = e.level === "error" ? "text-danger" : e.level === "warn" ? "text-warn" : "text-ok";
            return <div key={i} className={`appear break-words border-b border-border py-2 pl-[30px] text-xs ${tone}`}>{e.message}</div>;
          }
          if (e.type === "stage") {
            return <div key={i} className="appear kicker pb-1 pt-4 text-ink">{e.stage}</div>;
          }
          return null; // model calls are implementation detail; the stage lines already tell the story
        })}
      </div>
    </section>
  );
}

// ---------- findings ----------

function Finding({ o, rank, gap, onCite }: { o: Opportunity; rank: number; gap?: Gap; onCite: Cite }) {
  const [open, setOpen] = useState(rank === 1);
  return (
    <article className="appear border-b border-rule py-8 first:pt-6">
      <div className="grid grid-cols-[1fr_auto] gap-x-4 sm:gap-x-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="font-mono text-xs tabular-nums text-muted">{String(rank).padStart(2, "0")}</span>
            <GapText status={gap?.status ?? "open"} />
            <span className="kicker text-muted">{confidenceWord(o.confidence)} confidence</span>
          </div>
          <h3 className="mt-2 font-serif text-[23px] leading-[1.15] tracking-tight sm:text-[28px]">{o.title}</h3>
          <p className="mt-1 text-sm text-muted">For {o.target}</p>
        </div>
        <div className="text-right" role="img" aria-label={`Score ${o.score} out of 100`}>
          <div className="font-serif text-[40px] leading-none tracking-tight text-accent tabular-nums sm:text-[52px]">{o.score}</div>
          <div className="kicker mt-1 text-muted">of 100</div>
        </div>
      </div>

      <p className="mt-5 max-w-[60ch] font-serif text-[19px] leading-relaxed">{o.pitch}</p>

      <div className="mt-6 max-w-xl border-b border-border">
        <ScoreTable sub={o.subScores} />
      </div>

      <button onClick={() => setOpen(!open)} aria-expanded={open} className="mt-5 text-sm font-semibold underline decoration-border underline-offset-4 hover:decoration-accent hover:text-accent">
        {open ? "Hide the evidence" : "Read the evidence"}
      </button>

      {open && (
        <div className="appear mt-6 grid gap-x-10 gap-y-6 sm:grid-cols-[110px_1fr]">
          <Row title="Problem"><Cited text={o.problem} onCite={onCite} /></Row>
          <Row title="Existing"><Cited text={o.existingSolutions} onCite={onCite} /></Row>
          <Row title="The gap"><Cited text={o.gap} onCite={onCite} /></Row>

          {gap && gap.foundProducts.length > 0 && (
            <Row title="We looked for it">
              <ul className="space-y-1.5">
                {gap.foundProducts.map((p, i) => (
                  <li key={i}>
                    <span className="font-semibold">{p.name}</span>, {p.match}
                    <Ref ids={[p.evidenceId]} onCite={onCite} />
                  </li>
                ))}
              </ul>
              {gap.remainingWedge && <p className="mt-3 italic text-muted">What remains: {gap.remainingWedge}</p>}
            </Row>
          )}

          {o.mvpScope.length > 0 && (
            <Row title="Smallest test">
              <ol className="list-inside list-decimal space-y-1 marker:font-mono marker:text-xs marker:text-muted">
                {o.mvpScope.map((b, i) => <li key={i}>{b}</li>)}
              </ol>
            </Row>
          )}
          <Row title="This week">{o.firstValidationStep}</Row>

          {o.skeptic.length > 0 && (
            <Row title="The case against">
              <ol className="space-y-4">
                {o.skeptic.map((s, i) => (
                  <li key={i}>
                    <p className="font-semibold">{s.objection}</p>
                    <p className="mt-0.5 text-muted">
                      {s.basis}
                      {s.evidenceIds.length > 0 && <Ref ids={s.evidenceIds} onCite={onCite} />}
                    </p>
                    <p className="mt-1 text-[14px] italic text-muted">Would change with: {s.wouldChangeMind}</p>
                  </li>
                ))}
              </ol>
            </Row>
          )}
        </div>
      )}
    </article>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <>
      <h4 className="kicker pt-1 text-muted">{title}</h4>
      <div className="max-w-[62ch] font-serif text-[17px] leading-relaxed">{children}</div>
    </>
  );
}

function FindingsTab({ view, onCite }: { view: RunView; onCite: Cite }) {
  const opps = [...view.opportunities].sort((a, b) => b.score - a.score);
  const crowded = view.gaps.filter((g) => g.status === "served");
  return (
    <div>
      {opps.map((o, i) => (
        <Finding key={o.id} o={o} rank={i + 1} gap={view.gaps.find((g) => g.id === o.gapId)} onCite={onCite} />
      ))}
      {opps.length === 0 &&
        (view.run.status === "running" ? (
          <div className="py-6"><Lines rows={5} /></div>
        ) : (
          <div className="py-8">
            <Note>
              {view.gaps.length > 0
                ? "Every gap we tested already has a product filling it, so there is nothing to recommend."
                : "This run did not get far enough to produce findings."}
            </Note>
          </div>
        ))}
      {crowded.length > 0 && (
        <section className="py-8">
          <h3 className="kicker text-muted">Tested and ruled out</h3>
          <p className="mt-1 max-w-[60ch] text-sm text-muted">These looked like gaps until we searched for a product that fills them, and found one.</p>
          <ul className="mt-4 border-t border-border">
            {crowded.map((g) => (
              <li key={g.id} className="border-b border-border py-4">
                <p className="font-serif text-lg leading-snug line-through decoration-muted/50">{g.unmetNeed}</p>
                <ul className="mt-2 space-y-1 text-sm text-muted">
                  {g.foundProducts.map((p, i) => (
                    <li key={i}>
                      <span className="font-semibold text-ink">{p.name}</span>, {p.match}
                      <Ref ids={[p.evidenceId]} onCite={onCite} />
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// ---------- problems + competitors ----------

function Problem({ c, signals, index, onCite }: { c: Cluster; signals: Signal[]; index: number; onCite: Cite }) {
  const [open, setOpen] = useState(index === 0);
  const sources = new Set(signals.flatMap((s) => s.domains)).size;
  return (
    <section className="appear border-b border-border">
      <button onClick={() => setOpen(!open)} aria-expanded={open} className="group grid w-full grid-cols-[1fr_auto] gap-x-6 py-5 text-left">
        <div className="min-w-0">
          <h3 className="font-serif text-[22px] leading-snug tracking-tight group-hover:text-accent">{c.name}</h3>
          <p className="mt-1 max-w-[62ch] text-sm text-muted">{c.jobToBeDone}</p>
        </div>
        <div className="pt-1.5 text-right font-mono text-xs tabular-nums text-muted">
          {signals.length} signals
          <br />
          {sources} sources
          {c.weak && <div className="kicker mt-1 text-warn" title="Fewer than 2 signals or 2 distinct sources">Thin</div>}
        </div>
      </button>
      {open && (
        <ol className="appear mb-5 border-t border-border">
          {signals.map((s) => (
            <li key={s.id} className="grid grid-cols-[28px_1fr] gap-x-2 border-b border-border py-3 last:border-b-0">
              <span className="pt-0.5 font-mono text-[11px] text-muted" title={`Intensity ${s.intensity} of 5`}>{s.intensity}/5</span>
              <div>
                <p className="text-[15px]">{s.statement}</p>
                <button onClick={() => onCite(s.evidenceIds, s.quote)} className="mt-1 text-left font-serif text-[15px] italic text-muted hover:text-accent">
                  “{s.quote}”
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function CompetitorsTab({ view, onCite }: { view: RunView; onCite: Cite }) {
  if (view.competitors.length === 0) return <div className="py-8"><Note>No competitors have turned up in the evidence yet.</Note></div>;
  return (
    <div className="overflow-x-auto">
      <table className="mt-2 w-full min-w-[520px] text-left text-sm">
        <thead>
          <tr className="border-b border-rule">
            {["Product", "Pricing", "Rating", "What users complain about"].map((h) => (
              <th key={h} className="kicker py-2.5 pr-4 font-semibold text-muted">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {view.competitors.map((c) => (
            <tr key={c.id} className="border-b border-border align-baseline">
              <td className="py-3 pr-4">
                <span className="font-serif text-[17px]">{c.name}</span>
                <span className="ml-2 text-xs text-muted">{c.category.replace("-", " ")}</span>
              </td>
              <td className="py-3 pr-4 text-muted">{c.pricing ?? "n/a"}</td>
              <td className="py-3 pr-4 font-mono tabular-nums">{c.rating !== null ? c.rating.toFixed(1) : <span className="font-sans text-muted">n/a</span>}</td>
              <td className="py-3">
                {c.complaints.length > 0 ? (
                  <>
                    {c.complaints[0].text}
                    <Ref ids={c.complaints.map((x) => x.evidenceId)} quote={c.complaints[0].quote} onCite={onCite} />
                  </>
                ) : (
                  <span className="text-muted">none found</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------- sources panel ----------

function Sources({ ids, quote, evidence, onClose }: { ids: string[]; quote?: string; evidence: Evidence[]; onClose: () => void }) {
  const rows = evidence.filter((e) => ids.includes(e.id));
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => ev.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="appear fixed inset-0 z-50 flex justify-end bg-ink/25" onClick={onClose} role="dialog" aria-modal="true" aria-label="Sources">
      <aside className="drawer flex h-full w-full max-w-[440px] flex-col border-l border-rule bg-background" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between border-b border-rule px-6 py-4">
          <h3 className="kicker text-muted">{rows.length === 1 ? "Source" : `${rows.length} sources`}</h3>
          <button onClick={onClose} className="text-sm text-muted underline decoration-border underline-offset-4 hover:text-ink">Close</button>
        </div>
        <div className="flex-1 overflow-y-auto px-6">
          {rows.map((e) => (
            <div key={e.id} className="border-b border-border py-5">
              <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] text-muted">
                <span className="text-accent">{e.id}</span>
                <span className="truncate">{[e.blockType.replace(/_/g, " "), e.domain, e.date?.slice(0, 10)].filter(Boolean).join(" · ")}</span>
              </div>
              <p className="mt-2 font-serif text-lg leading-snug">{e.title || "Untitled result"}</p>
              <p className="mt-2 text-sm leading-relaxed text-muted"><Highlighted text={e.snippet || e.text || ""} quote={quote} /></p>
              {e.url && (
                <a href={e.url} target="_blank" rel="noreferrer" className="mt-3 inline-block break-all text-sm text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent">
                  {e.domain || "Open the page"}
                </a>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="py-8"><Note>These references are not in this run&apos;s stored evidence.</Note></div>}
        </div>
      </aside>
    </div>
  );
}

// ---------- page ----------

function summary(view: RunView): string {
  const { run, evidence, signals, competitors, gaps } = view;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : /(s|ch|sh|x)$/.test(w) ? "es" : "s"}`;
  const parts = [`${plural(run.searchesUsed, "search")} returned ${plural(evidence.length, "result")}.`];
  if (signals.length > 0 || run.rejectedSignals > 0) {
    parts.push(
      `${plural(signals.length, "signal")} passed the word-for-word quote check${
        run.rejectedSignals > 0 ? ` and ${run.rejectedSignals} ${run.rejectedSignals === 1 ? "was" : "were"} thrown out` : ""
      }.`,
    );
  }
  if (competitors.length > 0 || gaps.length > 0) parts.push(`We found ${plural(competitors.length, "competitor")} and tested ${plural(gaps.length, "gap")}.`);
  return parts.join(" ");
}

export default function RunClient({ runId }: { runId: string }) {
  const router = useRouter();
  const [view, setView] = useState<RunView | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [tab, setTab] = useState<Tab>("findings");
  const [drawer, setDrawer] = useState<{ ids: string[]; quote?: string } | null>(null);
  const [budget, setBudget] = useState<{ monthUsed: number; monthLimit: number } | null>(null);

  const [startError, setStartError] = useState<string | null>(null);
  const isLive = runId === "live";

  const fetchView = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) return null;
    const v = (await res.json()) as RunView;
    setView(v);
    return v;
  }, [runId]);

  // (1) a run streamed over a single request — the serverless path
  useEffect(() => {
    if (!isLive) return;
    if (!ensureLiveRun()) {
      router.replace("/");
      return;
    }
    return subscribeLive((s) => {
      if (s.view) setView(s.view);
      setEvents(s.events);
      if (s.error) setStartError(s.error);
    });
  }, [isLive, router]);

  // (2) a run the server knows, or (3) one saved in this browser
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
      // Always attach: a finished run replays its persisted log instantly. Events are
      // stored by server index, so reconnects and double-invoked effects never duplicate.
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
  }, [runId, isLive, fetchView]);

  const status = view?.run.status;
  useEffect(() => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((d: { budget?: { monthUsed: number; monthLimit: number } }) => d.budget && setBudget(d.budget))
      .catch(() => undefined);
  }, [status]);

  // The browser sends the run it holds, so export works even when the server has forgotten it.
  const exportMarkdown = useCallback(async () => {
    if (!view) return;
    const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(view) });
    if (!res.ok) return;
    const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/markdown" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `launchradar-${view.run.id}.md`;
    link.click();
    URL.revokeObjectURL(url);
  }, [view]);

  const closeDrawer = useCallback(() => setDrawer(null), []);
  const onCite: Cite = useCallback((ids, quote) => setDrawer({ ids, quote }), []);

  if (notFound) {
    return (
      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pt-24">
        <p className="font-serif text-3xl">There is no run at this address.</p>
        <button onClick={() => router.push("/")} className="mt-4 text-sm font-semibold underline decoration-border underline-offset-4 hover:text-accent">Back to the start</button>
      </main>
    );
  }
  if (startError && !view) {
    return (
      <main className="mx-auto w-full max-w-[880px] flex-1 px-6 pt-24">
        <p className="font-serif text-3xl">This run could not start.</p>
        <p className="mt-4 max-w-[62ch] border-l-2 border-danger pl-4 text-sm text-danger">{startError}</p>
        <button onClick={() => router.push("/")} className="mt-6 text-sm font-semibold underline decoration-border underline-offset-4 hover:text-accent">Back to the start</button>
      </main>
    );
  }
  if (!view) {
    return <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pt-24"><Lines rows={7} /></main>;
  }

  const { run } = view;
  const live = run.status === "running";
  const date = new Date(run.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-24">
      <header className="flex items-baseline justify-between gap-4 border-b border-rule py-4">
        <button onClick={() => router.push("/")} className="hover:text-accent" aria-label="Back to LaunchRadar home"><Wordmark live={live} /></button>
        <div className="flex items-baseline gap-5 font-mono text-xs tabular-nums text-muted">
          <span className="hidden sm:inline" title="Searches spent by this run, and billed searches this month">
            {run.searchesUsed}/{run.budget} this run{budget ? ` · ${budget.monthUsed}/${budget.monthLimit} this month` : ""}
          </span>
          <button onClick={() => void exportMarkdown()} className="font-sans text-sm text-ink underline decoration-border underline-offset-4 hover:text-accent hover:decoration-accent">
            Export<span className="hidden sm:inline"> as Markdown</span>
          </button>
        </div>
      </header>

      <section className="pt-10 sm:pt-14">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <StatusText status={run.status} />
          <span className="kicker text-muted">{run.region.toUpperCase()} · {date}{run.demo ? " · recorded example" : ""}</span>
        </div>
        <h1 className="mt-3 max-w-[22ch] font-serif text-[30px] leading-[1.1] tracking-tight min-[420px]:text-[40px] sm:text-[54px]">{run.question}</h1>
        <p className="mt-5 max-w-[62ch] font-serif text-[19px] leading-relaxed text-muted">{summary(view)}</p>
        {run.status === "failed" && run.error && <p className="appear mt-5 max-w-[70ch] border-l-2 border-danger pl-4 text-sm text-danger">{run.error}</p>}
        <div className="mt-6"><Progress events={events} status={run.status} /></div>
      </section>

      <div className="mt-10 grid items-start gap-x-14 gap-y-12 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            items={[
              { id: "findings", label: "Findings", count: view.opportunities.length },
              { id: "problems", label: "Problems people have", count: view.clusters.length },
              { id: "competitors", label: "Competitors", count: view.competitors.length },
            ]}
          />
          {tab === "findings" && <FindingsTab view={view} onCite={onCite} />}
          {tab === "problems" && (
            <div>
              {view.clusters.map((c, i) => (
                <Problem key={c.id} c={c} index={i} signals={view.signals.filter((s) => c.signalIds.includes(s.id))} onCite={onCite} />
              ))}
              {view.clusters.length === 0 && <div className="py-8">{live ? <Lines rows={4} /> : <Note>No recurring problems were found.</Note>}</div>}
            </div>
          )}
          {tab === "competitors" && <CompetitorsTab view={view} onCite={onCite} />}
        </div>
        <div className="lg:sticky lg:top-6"><ResearchLog events={events} status={run.status} /></div>
      </div>

      {drawer && <Sources ids={drawer.ids} quote={drawer.quote} evidence={view.evidence} onClose={closeDrawer} />}
    </main>
  );
}
