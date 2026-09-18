"use client";

import type { GapStatus } from "@/lib/schemas";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { Evidence, RunView, StepEvent } from "@/lib/schemas";
import { citeGroups } from "@/lib/evidence";
import { EngineBadge, Bar, ConfidenceChip, GapChip, ScoreRing, BudgetMeter } from "@/components/ui";

// ---------- citation helpers ----------

function Highlighted({ text, quote }: { text: string; quote?: string }) {
  if (!quote) return <>{text}</>;
  const hay = text.toLowerCase();
  const needle = quote.toLowerCase();
  const at = hay.indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded bg-amber-200/70 px-0.5">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

function Across({
  ids,
  onClick,
}: {
  ids: string[];
  onClick: (ids: string[]) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onClick(ids)}
      className="inline-flex items-baseline gap-0.5 font-mono text-[10px] font-semibold text-accent underline decoration-dotted underline-offset-2 hover:no-underline"
      title="Open evidence"
    >
      [{ids.join(",")}]
    </button>
  );
}

function Cited({
  text,
  onCite,
  q,
}: {
  text: string;
  onCite: (ids: string[]) => void;
  q?: string;
}) {
  const groups = useMemo(() => citeGroups(text), [text]);
  if (groups.length === 0) {
    return <Highlighted text={text} quote={q} />;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  groups.forEach((g, i) => {
    if (g.index > cursor) parts.push(<Highlighted key={`t${i}`} text={text.slice(cursor, g.index)} quote={q} />);
    parts.push(<Across key={`c${i}`} ids={g.ids} onClick={onCite} />);
    cursor = g.index + g.length;
  });
  if (cursor < text.length) parts.push(<Highlighted key="tail" text={text.slice(cursor)} quote={q} />);
  return <>{parts}</>;
}

// ---------- trace ----------

function Trace({ events, run }: { events: StepEvent[]; run: RunView["run"] }) {
  const statusColor = run.status === "complete" ? "text-green-600" : run.status === "failed" ? "text-red-600" : "text-amber-600 animate-pulse";
  return (
    <div className="rounded-lg border border-border bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">Research trace</h2>
        <span className={`text-[11px] font-semibold ${statusColor}`}>{run.status}</span>
      </div>
      <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-2 font-mono text-[11px]">
        {events.length === 0 && <div className="p-2 text-muted">Waiting for the pipeline…</div>}
        {events.map((e, i) => <TraceRow key={i} e={e} />)}
      </div>
    </div>
  );
}

function TraceRow({ e }: { e: StepEvent }) {
  switch (e.type) {
    case "stage":
      return (
        <div className={`flex items-center gap-1.5 px-2 py-1 ${e.level === "warn" || e.level === "error" ? "text-amber-700" : e.level === "ok" ? "text-green-700" : "text-zinc-500"}`}>
          <span className="font-bold uppercase">{e.stage}</span>
          <span className="truncate">{e.message}</span>
        </div>
      );
    case "llm":
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 text-zinc-400">
          <span className="text-[10px] text-indigo-400">LLM</span>
          <span className="truncate">{e.description}</span>
        </div>
      );
    case "search_call":
      return (
        <div className="grid grid-cols-[auto_auto_1fr_auto] items-center gap-1.5 px-2 py-1 text-zinc-700">
          <EngineBadge value={e.call.engine} />
          <span className={`px-1 text-[9px] font-bold uppercase ${e.call.cached ? "bg-zinc-100 text-zinc-400" : "bg-green-100 text-green-700"}`}>
            {e.call.cached ? "cached" : "live"}
          </span>
          <span className="truncate text-zinc-600">{String(e.call.query)}</span>
          <span className="shrink-0 text-right text-[10px] text-muted">{e.call.resultCount}r · {e.call.latencyMs}ms</span>
        </div>
      );
    case "status":
      return <div className="px-2 py-1 font-bold text-zinc-500">{e.status}</div>;
    case "done":
      return <div className="px-2 py-1 font-bold text-green-700">done · {e.searchesUsed} searches used</div>;
    default:
      return null;
  }
}

// ---------- clusters ----------

function ClustersCol({ view, onCite }: { view: RunView; onCite: (ids: string[]) => void }) {
  return (
    <div className="space-y-2">
      {view.clusters.map((c) => {
        const sigs = view.signals.filter((s) => c.signalIds.includes(s.id));
        const domains = new Set(sigs.flatMap((s) => s.domains).filter(Boolean));
        return (
          <ClusterCard key={c.id} name={c.name} jtbd={c.jobToBeDone} weak={c.weak} sigsCount={sigs.length} domains={domains.size} signalPreview={sigs.slice(0, 2)} onCite={onCite} />
        );
      })}
      {view.clusters.length === 0 && <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">No clusters yet.</div>}
      {view.competitors.length > 0 && (
        <div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm">
          <div className="border-b border-border px-3 py-2 text-xs font-bold uppercase tracking-wider text-muted">Competitors (from evidence)</div>
          <table className="w-full text-left text-xs">
            <tbody className="divide-y divide-border">
              {view.competitors.map((c) => (
                <tr key={c.id} className="hover:bg-accent-soft">
                  <td className="px-3 py-1.5 font-medium">
                    {c.name}
                    <span className="ml-1 text-[10px] text-muted">({c.category})</span>
                  </td>
                  <td className="px-2 py-1.5 text-[11px] text-muted">{c.pricing ?? "—"}</td>
                  <td className="px-2 py-1.5 text-[11px] tabular-nums">{c.rating !== null ? `${c.rating}★` : ""}</td>
                  <td className="px-2 py-1.5">
                    {c.complaints.length > 0 && (
                      <button onClick={() => onCite(c.complaints.map((x) => x.evidenceId))} className="text-[10px] font-semibold text-amber-700 underline decoration-dotted">
                        {c.complaints.length} complaint{c.complaints.length > 1 ? "s" : ""}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ClusterCard({ name, jtbd, weak, sigsCount, domains, signalPreview, onCite }: { name: string; jtbd: string; weak: boolean; sigsCount: number; domains: number; signalPreview: Array<{ id: string; statement: string; intensity: number; quote: string; evidenceIds: string[] }>; onCite: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border bg-white shadow-sm">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">{name}</span>
            {weak && <span className="rounded bg-amber-100 px-1 text-[9px] font-bold uppercase text-amber-700">weak</span>}
          </div>
          <p className="mt-0.5 text-[11px] text-muted">{jtbd}</p>
        </div>
        <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[10px] text-muted">
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5">{sigsCount} signals</span>
          <span className="rounded-full bg-zinc-100 px-1.5 py-0.5">{domains} domains</span>
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3 py-2 space-y-1.5">
          {signalPreview.map((s) => (
            <div key={s.id} className="text-[11px] text-zinc-700">
              <Cited text={s.statement} onCite={onCite} q={s.quote} />
              <span className="ml-1 text-[10px] text-muted">intensity {s.intensity} · <button className="text-accent underline decoration-dotted" onClick={() => onCite(s.evidenceIds)}>{s.evidenceIds.join(",")}</button></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------- opportunities ----------

function OpportunitiesCol({ view, onCite }: { view: RunView; onCite: (ids: string[]) => void }) {
  const opps = [...view.opportunities].sort((a, b) => b.score - a.score);
  return (
    <div className="space-y-3">
      {opps.map((o) => {
        const gap = view.gaps.find((g) => g.id === o.gapId);
        return (
          <OpportunityCard key={o.id} title={o.title} score={o.score} confidence={o.confidence} gapStatus={gap?.status ?? "open"} gap={gap} sub={o.subScores} problem={o.problem} existing={o.existingSolutions} gapText={o.gap} pitch={o.pitch} mvp={o.mvpScope} step={o.firstValidationStep} skeptic={o.skeptic.map((s) => ({ objection: s.objection, basis: s.basis, ids: s.evidenceIds, wouldChangeMind: s.wouldChangeMind }))} target={o.target} onCite={onCite} />
        );
      })}
      {opps.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted">
          Every candidate gap is already served — no opportunity cards. Run the research trace above to see why.
        </div>
      )}
    </div>
  );
}

function OpportunityCard({ title, score, confidence, gapStatus, gap, sub, problem, existing, gapText, pitch, mvp, step, skeptic, target, onCite }: {
  title: string;
  score: number;
  confidence: string;
  gapStatus: GapStatus;
  gap?: { foundProducts: Array<{ name: string; evidenceId: string; match: string }>; remainingWedge: string | null };
  sub: { pain: number; momentum: number; commercial: number; whitespace: number; weakRivals: number };
  problem: string;
  existing: string;
  gapText: string;
  pitch: string;
  mvp: string[];
  step: string;
  skeptic: Array<{ objection: string; basis: string; ids: string[]; wouldChangeMind: string }>;
  target: string;
  onCite: (ids: string[]) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold leading-tight">{title}</h3>
          <p className="mt-0.5 text-[11px] text-muted">{target}</p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <ConfidenceChip value={confidence} />
            <GapChip status={gapStatus} />
          </div>
        </div>
        <ScoreRing score={score} />
      </div>

      <div className="mt-3 grid gap-1.5 rounded-lg border border-border bg-zinc-50 p-2.5">
        <Bar label="Pain" value={sub.pain} max={30} />
        <Bar label="Momentum" value={sub.momentum} max={20} />
        <Bar label="Commercial" value={sub.commercial} max={20} />
        <Bar label="Whitespace" value={sub.whitespace} max={20} />
        <Bar label="Weak rivals" value={sub.weakRivals} max={10} />
      </div>

      <dl className="mt-3 space-y-2 text-xs">
        <div><dt className="font-semibold text-muted">Problem</dt><dd className="text-zinc-700"><Cited text={problem} onCite={onCite} /></dd></div>
        <div><dt className="font-semibold text-muted">Existing solutions</dt><dd className="text-zinc-700"><Cited text={existing} onCite={onCite} /></dd></div>
        <div><dt className="font-semibold text-muted">Gap</dt><dd className="text-zinc-700"><Cited text={gapText} onCite={onCite} /></dd></div>
      </dl>

      <div className="mt-2 rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 text-xs">
        <span className="font-semibold text-indigo-800">Pitch · </span>
        <span className="text-indigo-900">{pitch}</span>
      </div>

      {mvp.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="font-semibold text-muted">MVP scope</span>
          <ul className="mt-1 list-inside list-disc space-y-0.5 text-zinc-700">
            {mvp.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}

      {gap && gap.foundProducts.length > 0 && (
        <div className="mt-2 text-xs">
          <span className="font-semibold text-muted">Kill-query findings</span>
          <ul className="mt-1 space-y-0.5">
            {gap.foundProducts.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-zinc-700">
                <span>{p.match}</span>
                <button onClick={() => onCite([p.evidenceId])} className="shrink-0 font-mono text-[10px] text-accent underline decoration-dotted">{p.evidenceId}</button>
              </li>
            ))}
          </ul>
          {gap.remainingWedge && <p className="mt-1 text-[11px] text-amber-800">Wedge: {gap.remainingWedge}</p>}
        </div>
      )}

      <div className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 p-2.5 text-xs">
        <span className="font-semibold text-muted">First validation step · </span>
        <span className="text-zinc-700">{step}</span>
      </div>

      {skeptic.length > 0 && (
        <div className="mt-2">
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">Skeptic review</span>
          <ol className="mt-1 space-y-1.5">
            {skeptic.map((s, i) => (
              <li key={i} className="rounded-md border border-zinc-200 p-2 text-[11px]">
                <div className="font-semibold text-zinc-800">{(i + 1)}. {s.objection}</div>
                <div className="mt-0.5 text-muted">{s.basis}</div>
                {s.ids.length > 0 && (
                  <button onClick={() => onCite(s.ids)} className="mt-0.5 font-mono text-[10px] text-accent underline decoration-dotted">{s.ids.join(",")}</button>
                )}
                <div className="mt-1 text-zinc-500"><span className="font-semibold">Would change mind:</span> {s.wouldChangeMind}</div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------- evidence drawer ----------

function EvidenceDrawer({ ids, quote, evidence, onClose }: { ids: string[]; quote?: string; evidence: Evidence[]; onClose: () => void }) {
  const rows = evidence.filter((e) => ids.includes(e.id));
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside className="h-full w-full max-w-md overflow-y-auto border-l border-border bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold">Evidence {ids.join(", ")}</h3>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-zinc-100">✕</button>
        </div>
        {quote && <p className="mt-2 rounded-md bg-amber-50 p-2 text-[11px] text-amber-900">Quote: “{quote}”</p>}
        <div className="mt-3 space-y-3">
          {rows.map((e) => (
            <div key={e.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] font-bold text-accent">{e.id}</span>
                <span className="text-[10px] text-muted">{e.blockType} · {e.domain}</span>
              </div>
              <div className="mt-1 text-sm font-medium leading-snug">{e.title || "(no title)"}</div>
              {e.date && <div className="text-[10px] text-muted">{e.date}</div>}
              <div className="mt-1 text-xs text-zinc-700"><Highlighted text={e.snippet || e.text || ""} quote={quote} /></div>
              {e.url && (
                <a href={e.url} target="_blank" rel="noreferrer" className="mt-2 inline-block text-[11px] font-medium text-accent underline">
                  Open source ↗
                </a>
              )}
            </div>
          ))}
          {rows.length === 0 && <div className="text-xs text-muted">No stored evidence matches these ids.</div>}
        </div>
      </aside>
    </div>
  );
}

// ---------- page ----------

export default function RunClient({ runId }: { runId: string }) {
  const router = useRouter();
  const [view, setView] = useState<RunView | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [notFound, setNotFound] = useState(false);
  const [drawer, setDrawer] = useState<{ ids: string[]; quote?: string } | null>(null);

  const fetchView = useCallback(async () => {
    const res = await fetch(`/api/runs/${runId}`);
    if (!res.ok) {
      setNotFound(true);
      return null;
    }
    const v = (await res.json()) as RunView;
    setView(v);
    return v;
  }, [runId]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const v = await fetchView();
      if (!alive || !v) return;
      if (v.run.status === "running") {
        const es = new EventSource(`/api/runs/${runId}/stream`);
        es.onmessage = (msg) => {
          const e = JSON.parse(msg.data as string) as StepEvent;
          setEvents((prev) => [...prev, e]);
          if (e.type === "done") es.close();
          if (e.type === "status") void fetchView();
        };
        es.onerror = () => es.close();
        const poll = window.setInterval(() => {
          fetchView().then((nv) => {
            if (nv && nv.run.status !== "running") window.clearInterval(poll);
          });
        }, 2000);
        return () => {
          es.close();
          window.clearInterval(poll);
        };
      }
    })();
    return () => {
      alive = false;
    };
  }, [runId, fetchView]);

  const [monthUsed, setMonthUsed] = useState(0);

  useEffect(() => {
    void fetch("/api/runs")
      .then((r) => r.json())
      .then((data: { runs: Array<{ searchesUsed: number }> }) =>
        setMonthUsed(data.runs.reduce((a, r) => a + r.searchesUsed, 0)),
      )
      .catch(() => undefined);
  }, []);

  if (notFound) {
    return (
      <main className="mx-auto max-w-xl px-6 py-16 text-center">
        <p className="text-sm text-muted">Run not found.</p>
        <button onClick={() => router.push("/")} className="mt-3 text-sm font-semibold text-accent">Back home</button>
      </main>
    );
  }
  if (!view) return <main className="mx-auto max-w-2xl px-6 py-16 text-sm text-muted">Loading run…</main>;

  return (
    <main className="min-h-screen pb-10">
      <header className="sticky top-0 z-40 border-b border-border bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-screen-2xl flex-wrap items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <button onClick={() => router.push("/")} className="flex shrink-0 items-center gap-1.5 font-bold text-accent hover:underline">
              <span className="inline-block h-2 w-2 rounded-full bg-accent" /> LaunchRadar
            </button>
            <span className="shrink-0 text-zinc-300">/</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{view.run.question}</div>
              <div className="text-[11px] text-muted">{view.run.region.toUpperCase()} · {view.run.demo ? `demo run · ${view.run.demoLabel ?? ""}` : "live run"} · budget {view.run.budget}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <BudgetMeter used={view.run.searchesUsed} limit={view.run.budget} month={view.run.searchesUsed + Math.max(0, monthUsed)} monthLimit={250} />
            <a href={`/api/runs/${runId}/export`} className="rounded-md border border-border bg-white px-3 py-1.5 text-xs font-semibold hover:border-accent">Export MD</a>
          </div>
        </div>
      </header>

      {view.run.status === "failed" && view.run.error && (
        <div className="mx-auto max-w-screen-2xl px-4 pt-3">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">{view.run.error}</div>
        </div>
      )}

      <div className="mx-auto mt-4 grid max-w-screen-2xl grid-cols-1 gap-4 px-4 lg:grid-cols-[minmax(280px,360px)_1fr_minmax(380px,480px)]">
        <div className="lg:sticky lg:top-14 lg:self-start"><Trace events={events} run={view.run} /></div>
        <div><ClustersCol view={view} onCite={(ids) => setDrawer({ ids })} /></div>
        <div><OpportunitiesCol view={view} onCite={(ids) => setDrawer({ ids })} /></div>
      </div>

      {drawer && (
        <EvidenceDrawer ids={drawer.ids} quote={drawer.quote} evidence={view.evidence} onClose={() => setDrawer(null)} />
      )}
    </main>
  );
}