"use client";

/**
 * One research run: live progress while it runs, then its opportunities, problems, competitors,
 * research log and sources.
 *
 * Where the data comes from:
 *   (1) a run the server holds: its view, plus a resumable event stream (Last-Event-ID)
 *   (2) a finished run this browser keeps: preferred, because a server may have forgotten it
 * While a run is in progress the page also polls the view every two seconds; the stream and the
 * poll back each other up, and when both go quiet the page says so instead of pretending.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Cluster, Evidence, RunView, Signal, StepEvent } from "@/lib/types";
import { loadSavedRun, saveFinishedRun } from "@/lib/history";
import { GAP_LABEL, itemsForView, regionLabel, sortItems, stripCites, type FeedItem, type Source } from "@/lib/v3/feed";
import { PIPELINE, engineLabel, outcomeOf, parseStepEvent, searchStats, stageMostlyFailed, stageOf, type SearchStats } from "@/lib/v3/run";
import { loadIds, saveIds } from "@/lib/v3/storage";
import { CardSkeleton, FeaturedCard, GridCard } from "./Cards";
import DetailPanel from "./DetailPanel";
import { UNREACHABLE, blockedReasonFor, fetchJson, useHome, useStartRun } from "./hooks";
import { ArrowRightIcon, ExternalIcon, RadarLogo } from "./icons";
import NewResearchDialog from "./NewResearchDialog";
import { Badge, FOCUS_FALLBACK_ID, ScoreExplainer, Segmented, SourceLine, cx } from "./parts";
import TopNav from "./TopNav";

type Section = "opportunities" | "problems" | "competitors" | "log" | "sources";

/** How the first load went. Once a view exists, later failures become a connection state instead. */
type Load = { kind: "loading" } | { kind: "ready" } | { kind: "not-found" } | { kind: "unreachable" } | { kind: "error"; message: string };

const POLL_MS = 2000;
/** EventSource reconnects on its own (retry: 2 s); only a reconnect that takes this long counts as lost */
const STREAM_GRACE_MS = 8000;
const FAILED_POLLS_BEFORE_LOST = 3;

function plural(n: number, w: string): string {
  return `${n} ${w}${n === 1 ? "" : /(s|ch|sh|x)$/.test(w) ? "es" : "s"}`;
}

function summary(view: RunView, stats: SearchStats): string {
  const { run, evidence, signals, competitors, gaps } = view;
  const parts: string[] = [];
  if (stats.failed > 0) {
    const ok = Math.max(0, stats.total - stats.failed);
    parts.push(`${plural(stats.total, "search")} ran and ${stats.failed} failed; the other ${ok} returned ${plural(evidence.length, "result")}.`);
  } else {
    parts.push(`${plural(stats.total, "search")} returned ${plural(evidence.length, "result")}.`);
  }
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

function evidenceSource(e: Evidence): Source {
  return { id: e.id, title: e.title || e.snippet?.slice(0, 120) || "", url: e.url, domain: e.domain, kind: e.blockType.replace(/_/g, " ") };
}

/* ------------------------------------------------------------------ progress */

function Stepper({ events, status, stats }: { events: StepEvent[]; status: string; stats: SearchStats }) {
  let reached = -1;
  for (const e of events) {
    const st = e ? stageOf(e) : null;
    const i = st ? PIPELINE.findIndex((p) => p.keys.includes(st)) : -1;
    if (i > reached) reached = i;
  }
  const done = status === "complete";
  const failed = status === "failed";
  const pct = done ? 100 : Math.max(4, ((reached + (status === "running" ? 0.5 : 1)) / PIPELINE.length) * 100);
  return (
    <div>
      <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
        <div
          className={cx("h-full rounded-full transition-[width] duration-700", failed ? "bg-rose-400" : "bg-linear-to-r from-indigo-400 to-emerald-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <ol className="mt-3 grid grid-cols-3 gap-x-2 gap-y-2 sm:grid-cols-4 md:grid-cols-7" aria-label="Research stages">
        {PIPELINE.map((p, i) => {
          const past = done || i < reached;
          const now = !done && i === reached;
          // a stage that lost most of its searches is not a success, whatever came after it
          const warn = past && stageMostlyFailed(stats.byStage[i]);
          return (
            <li key={p.id} className={cx("flex min-w-0 items-center gap-1.5 text-xs", now ? (failed ? "text-rose-300" : "text-indigo-200") : warn ? "text-amber-200" : past ? "text-zinc-200" : "text-zinc-400")}>
              <span
                aria-hidden="true"
                className={cx(
                  "grid size-4 shrink-0 place-items-center rounded-full text-[9px] font-semibold",
                  warn ? "bg-amber-400/20 text-amber-200" : past ? "bg-emerald-400/20 text-emerald-300" : now ? (failed ? "bg-rose-400/20" : "bg-indigo-400/25") : "bg-white/[0.06]",
                )}
              >
                {warn ? "!" : past ? "✓" : now && status === "running" ? <span className="size-1.5 rounded-full bg-indigo-300 motion-safe:animate-pulse" /> : i + 1}
              </span>
              <span className="truncate">{p.label}</span>
              <span className="sr-only">
                {warn
                  ? `, done, but ${stats.byStage[i].failed} of its ${stats.byStage[i].total} searches failed`
                  : past
                    ? ", done"
                    : now
                      ? failed
                        ? ", stopped here"
                        : ", in progress"
                      : ", not started"}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ research log */

function ResearchLog({ events, status }: { events: StepEvent[]; status: string }) {
  const box = useRef<HTMLOListElement>(null);
  const count = events.length;
  useEffect(() => {
    if (status === "running" && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [count, status]);
  const numbers = useMemo(() => {
    const out: number[] = [];
    let n = 0;
    events.forEach((e, i) => {
      if (e?.type === "search_call") out[i] = ++n;
    });
    return out;
  }, [events]);

  if (count === 0) return <p className="rounded-2xl border border-white/[0.07] bg-zinc-900/30 px-5 py-8 text-sm text-zinc-300">Waiting for the first step.</p>;
  return (
    <ol ref={box} className="max-h-[70vh] overflow-y-auto rounded-2xl border border-white/[0.07] bg-zinc-900/30 p-2 [scrollbar-width:thin]" aria-label="Research log">
      {events.map((e, i) => {
        if (!e) return null;
        if (e.type === "search_call") {
          const bad = e.call.status !== "ok";
          return (
            <li key={i} className="lr3-appear grid grid-cols-[2rem_1fr] gap-x-2 rounded-lg px-2 py-2 hover:bg-white/[0.03]">
              <span className="pt-0.5 text-right font-mono text-[11px] tabular-nums text-zinc-400">{numbers[i]}</span>
              <div className="min-w-0">
                <p className={cx("text-sm [overflow-wrap:anywhere]", bad ? "text-zinc-400 line-through" : "text-zinc-100")}>{e.call.query}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[11px] text-zinc-400">
                  <span className="text-indigo-300">{engineLabel(e.call.engine)}</span>
                  {bad ? (
                    <span className="text-rose-300">{e.call.status}</span>
                  ) : (
                    <>
                      <span>{e.call.resultCount} results</span>
                      <span>{e.call.cached ? "cached" : `${(e.call.latencyMs / 1000).toFixed(1)}s`}</span>
                    </>
                  )}
                </p>
              </div>
            </li>
          );
        }
        if (e.type === "stage" && e.level !== "info") {
          const tone = e.level === "error" ? "text-rose-300" : e.level === "warn" ? "text-amber-200" : "text-emerald-300";
          return (
            <li key={i} className={cx("lr3-appear px-2 py-1.5 pl-12 text-xs [overflow-wrap:anywhere]", tone)}>
              {e.message}
            </li>
          );
        }
        if (e.type === "stage") {
          return (
            <li key={i} className="lr3-appear px-2 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-zinc-300">
              {PIPELINE.find((p) => p.keys.includes(e.stage))?.label ?? e.stage}
              <span className="ml-2 font-normal normal-case tracking-normal text-zinc-400">{e.message}</span>
            </li>
          );
        }
        return null; // model calls are implementation detail; the stage lines tell the story
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------ problems + competitors */

function Quote({ quote, source }: { quote: string; source?: Source }) {
  return (
    <figure className="mt-2 rounded-xl border-l-2 border-indigo-400/50 bg-white/[0.02] py-2 pl-3 pr-2">
      <blockquote className="text-sm italic leading-relaxed text-zinc-200">&ldquo;{quote}&rdquo;</blockquote>
      {source && (
        <figcaption className="-mx-2 mt-1">
          <SourceLine s={source} />
        </figcaption>
      )}
    </figure>
  );
}

function ProblemCard({ c, signals, byId, open, onToggle }: { c: Cluster; signals: Signal[]; byId: Map<string, Evidence>; open: boolean; onToggle: () => void }) {
  const domains = new Set(signals.flatMap((s) => s.domains)).size;
  return (
    <li className="rounded-2xl border border-white/[0.07] bg-zinc-900/40 transition-colors hover:border-white/15">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-start gap-4 rounded-2xl p-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-zinc-50">{c.name}</h3>
          <p className="mt-1 text-sm text-zinc-300">{c.jobToBeDone}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge tone="indigo">{plural(signals.length, "signal")}</Badge>
            <Badge>{plural(domains, "site")}</Badge>
            {c.weak && <Badge tone="amber">Thin evidence</Badge>}
          </div>
        </div>
        <span aria-hidden="true" className={cx("mt-1 text-zinc-400 transition-transform duration-200", open && "rotate-90")}>
          <ArrowRightIcon size={16} />
        </span>
      </button>
      {open && (
        <ol className="lr3-appear space-y-4 border-t border-white/[0.06] p-5">
          {signals.map((s) => (
            <li key={s.id}>
              <div className="flex items-start gap-3">
                <span className="mt-0.5 shrink-0 rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-zinc-300" title="How strongly it was felt, 1 to 5">
                  {s.intensity}/5
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-zinc-100">{s.statement}</p>
                  <Quote quote={s.quote} source={byId.get(s.evidenceIds[0]) ? evidenceSource(byId.get(s.evidenceIds[0]) as Evidence) : undefined} />
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ notices */

const retryButton = "inline-flex h-9 items-center rounded-lg border border-current/30 bg-white/[0.04] px-3 text-sm font-medium transition-colors hover:bg-white/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70";

/** What a finished run with little or no evidence should tell the reader, and what to do next. */
function OutcomeNotice({ outcome, stats, onRerun, canRerun }: { outcome: "limited" | "empty"; stats: SearchStats; onRerun: () => void; canRerun: boolean }) {
  const heading = outcome === "empty" ? "This run finished without finding an opportunity." : "This run finished with limited evidence.";
  const what =
    stats.failed > 0
      ? `${stats.failed} of its ${plural(stats.total, "search")} failed, so the findings below rest on less evidence than a full run would collect.`
      : "Its searches ran, but the results did not hold a problem with a gap that passed the checks.";
  return (
    <div role="status" aria-live="polite" className="max-w-3xl rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-50">
      <p>
        <span className="font-semibold">{heading}</span> {what}
      </p>
      {stats.reasons.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-amber-100/90 marker:text-amber-300/60">
          {stats.reasons.slice(0, 4).map((r) => (
            <li key={r} className="[overflow-wrap:anywhere]">
              {r}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-amber-100/90">{stats.failed > 0 ? "Next step: run it again later, when the search service answers." : "Next step: run it again with a narrower market, or a different phrasing."}</span>
        {canRerun && (
          <button type="button" onClick={onRerun} className={cx(retryButton, "text-amber-50")}>
            Run it again
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export default function RunPage({ runId }: { runId: string }) {
  const router = useRouter();
  const { home, down } = useHome();
  const { start, busy, error: startErr, clearError } = useStartRun();
  const [view, setView] = useState<RunView | null>(null);
  const [events, setEvents] = useState<StepEvent[]>([]);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [connection, setConnection] = useState<"ok" | "lost">("ok");
  const [attempt, setAttempt] = useState(0);
  const [section, setSection] = useState<Section>("opportunities");
  const [openItem, setOpenItem] = useState<FeedItem | null>(null);
  const [openProblem, setOpenProblem] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [shortlist, setShortlist] = useState<string[]>([]);
  const [exportState, setExportState] = useState<"idle" | "busy" | "failed">("idle");
  // the data effect below reads the current view without depending on it (a new view must not reconnect the stream)
  const viewRef = useRef<RunView | null>(null);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  // (1) a run the server knows, or (2) one saved in this browser; `attempt` re-runs it on manual retry
  useEffect(() => {
    let alive = true;
    let es: EventSource | null = null;
    let poll: number | undefined;
    let grace: number | undefined;
    let failedPolls = 0;
    const stop = () => {
      es?.close();
      es = null;
      if (poll !== undefined) window.clearInterval(poll);
      poll = undefined;
      if (grace !== undefined) window.clearTimeout(grace);
      grace = undefined;
    };
    const connected = () => {
      if (!alive) return;
      failedPolls = 0;
      if (grace !== undefined) window.clearTimeout(grace);
      grace = undefined;
      setConnection("ok");
    };
    const fetchView = async (): Promise<RunView | null> => {
      const r = await fetchJson<RunView>(`/api/runs/${runId}`);
      if (!alive) return null;
      if (r.kind === "ok") {
        setView(r.data);
        return r.data;
      }
      return null;
    };
    void (async () => {
      const saved = loadSavedRun(runId);
      if (saved && saved.view.run.status !== "running") {
        await Promise.resolve(); // keep state updates out of the effect's synchronous body
        if (!alive) return;
        setView(saved.view);
        setEvents(saved.events);
        setLoad({ kind: "ready" });
        return;
      }
      const r = await fetchJson<RunView>(`/api/runs/${runId}`);
      if (!alive) return;
      let v: RunView | null;
      if (r.kind === "ok") {
        v = r.data;
        setView(v);
        setLoad({ kind: "ready" });
        connected();
      } else if (viewRef.current) {
        // a retry that failed: keep what the page has and say the connection is gone
        v = viewRef.current;
        setConnection("lost");
      } else {
        setLoad(r.kind === "error" ? { kind: "error", message: r.message } : { kind: r.kind });
        return;
      }
      // a finished run replays its log instantly; events are stored by index, so reconnects never duplicate
      es = new EventSource(`/api/runs/${runId}/stream`);
      es.onopen = connected;
      es.onmessage = (msg) => {
        const e = parseStepEvent(msg.data);
        if (!e) return; // a frame this page cannot read is dropped, never rendered
        connected();
        const index = Number.parseInt(msg.lastEventId, 10);
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
        if (!alive) return;
        if (es?.readyState === EventSource.CLOSED) {
          es.close();
          es = null;
          if (viewRef.current?.run.status === "running") setConnection("lost");
          return;
        }
        // the browser is reconnecting (the API closes a live stream every 24 s by design): only a
        // reconnect that does not come back counts as a lost connection
        if (grace === undefined) grace = window.setTimeout(() => setConnection("lost"), STREAM_GRACE_MS);
      };
      if (v.run.status === "running" || v.run.status === "queued") {
        poll = window.setInterval(() => {
          void fetchJson<RunView>(`/api/runs/${runId}`).then((pr) => {
            if (!alive) return;
            if (pr.kind !== "ok") {
              failedPolls += 1;
              if (failedPolls >= FAILED_POLLS_BEFORE_LOST) setConnection("lost");
              return;
            }
            connected();
            setView(pr.data);
            if (pr.data.run.status !== "running" && pr.data.run.status !== "queued" && poll !== undefined) {
              window.clearInterval(poll);
              poll = undefined;
            }
          });
        }, POLL_MS);
      }
    })();
    return () => {
      alive = false;
      stop();
    };
  }, [runId, attempt]);

  // keep a copy of a real run that finished here, so history survives whatever happens to the server's copy
  useEffect(() => {
    if (!view || view.run.id !== runId) return;
    saveFinishedRun(view, events);
  }, [runId, view, events]);

  const realId = view?.run.id;
  useEffect(() => {
    if (!realId) return;
    const t = window.setTimeout(() => setShortlist(loadIds(realId, "shortlist")), 0);
    return () => window.clearTimeout(t);
  }, [realId]);

  const toggleShortlist = useCallback((item: FeedItem) => {
    const ids = loadIds(item.runId, "shortlist");
    const next = ids.includes(item.opportunity.id) ? ids.filter((x) => x !== item.opportunity.id) : [...ids, item.opportunity.id];
    saveIds(item.runId, "shortlist", next);
    setShortlist(next);
  }, []);

  const exportMarkdown = useCallback(async () => {
    if (!view) return;
    setExportState("busy");
    try {
      const res = await fetch("/api/export", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(view) });
      if (!res.ok) throw new Error(String(res.status));
      const url = URL.createObjectURL(new Blob([await res.text()], { type: "text/markdown" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `launchradar-${view.run.id}.md`;
      link.click();
      URL.revokeObjectURL(url);
      setExportState("idle");
    } catch {
      setExportState("failed");
    }
  }, [view]);

  const items = useMemo(() => (view ? sortItems(itemsForView(view), "score") : []), [view]);
  const byId = useMemo(() => new Map((view?.evidence ?? []).map((e) => [e.id, e])), [view]);
  const stats = useMemo(() => searchStats(events, view?.run), [events, view]);
  const outcome = useMemo(() => (view ? outcomeOf(view, stats) : null), [view, stats]);
  const closeDetail = useCallback(() => setOpenItem(null), []);
  const closeDialog = useCallback(() => {
    setDialog(false);
    clearError();
  }, [clearError]);

  const shell = (children: React.ReactNode, crumb?: React.ReactNode, actions?: React.ReactNode) => (
    <div className="lr3 relative min-h-screen overflow-x-clip bg-zinc-950 text-zinc-100 antialiased">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_20%_0%,rgba(99,102,241,0.16),transparent_70%),radial-gradient(40%_50%_at_90%_10%,rgba(16,185,129,0.08),transparent_70%)]" />
      <div aria-hidden="true" className="lr3-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <TopNav
        onNew={() => setDialog(true)}
        budget={home?.budget ? { monthUsed: home.budget.monthUsed, monthLimit: home.budget.monthLimit } : null}
        apiNote={home || down ? (blockedReasonFor(home, down) ?? "New questions can be researched.") : null}
        crumb={crumb}
        actions={actions}
      />
      <main className="relative mx-auto max-w-7xl px-4 pb-24 pt-8 sm:px-6">{children}</main>
      {dialog && (
        <NewResearchDialog
          onClose={closeDialog}
          onStart={(question, region) => void start({ question, region })}
          onExample={() => home?.demos[0] && void start({ demo: home.demos[0].slug })}
          busy={busy}
          error={startErr}
          blockedReason={blockedReasonFor(home, down)}
          runBudget={home?.budget?.run ?? 25}
          hasExample={!!home?.demos[0]}
          initialQuestion={view && !view.run.demo ? view.run.question : ""}
          initialRegion={view?.run.region ?? "in"}
        />
      )}
      {openItem && <DetailPanel item={openItem} shortlisted={shortlist.includes(openItem.opportunity.id)} onToggleShortlist={() => toggleShortlist(openItem)} onClose={closeDetail} showRunLink={false} />}
    </div>
  );

  if (!view && load.kind !== "loading" && load.kind !== "ready") {
    const notFound = load.kind === "not-found";
    const title = notFound ? "There is no run at this address" : load.kind === "unreachable" ? UNREACHABLE : "The research server could not answer";
    const body = notFound
      ? "The research server has no run with this id, and this browser has no copy of it."
      : load.kind === "unreachable"
        ? "The run may still be there. Check your connection, then try again."
        : load.message;
    return shell(
      <section className="mx-auto max-w-xl rounded-2xl border border-white/[0.07] bg-zinc-900/40 px-6 py-14 text-center" aria-live="polite">
        <RadarLogo size={48} />
        <h1 id={FOCUS_FALLBACK_ID} tabIndex={-1} className="mt-5 text-xl font-semibold tracking-tight text-white focus:outline-none">
          {title}
        </h1>
        <p className="mt-2 text-sm text-zinc-300">{body}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {!notFound && (
            <button
              type="button"
              onClick={retry}
              className="inline-flex h-10 items-center rounded-xl bg-white px-4 text-sm font-semibold text-zinc-900 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={() => router.push("/")}
            className={cx(
              "inline-flex h-10 items-center rounded-xl px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2",
              notFound ? "bg-white text-zinc-900 hover:bg-indigo-50 focus-visible:ring-indigo-300" : "border border-white/10 text-zinc-200 hover:bg-white/[0.06] focus-visible:ring-indigo-400/70",
            )}
          >
            Back to all findings
          </button>
        </div>
      </section>,
    );
  }

  if (!view) {
    return shell(
      <div className="space-y-6" aria-busy="true">
        <div className="lr3-shimmer h-8 w-2/3 rounded-lg" />
        <div className="lr3-shimmer h-4 w-1/2 rounded" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
        <p className="sr-only" role="status">
          Loading the run
        </p>
      </div>,
    );
  }

  const { run } = view;
  const running = run.status === "running" || run.status === "queued";
  const failed = run.status === "failed";
  const disconnected = running && connection === "lost";
  const date = new Date(run.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
  const replayed = new Date(run.createdAt).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
  const crowded = view.gaps.filter((g) => g.status === "served");
  const searchCount = events.filter((e) => e?.type === "search_call").length;

  const statusBadge = disconnected ? (
    <Badge tone="amber">Connection lost</Badge>
  ) : running ? (
    <Badge tone="indigo" dot>
      Researching
    </Badge>
  ) : failed ? (
    <Badge tone="rose">Stopped</Badge>
  ) : outcome === "limited" ? (
    <Badge tone="amber">Complete · limited evidence</Badge>
  ) : outcome === "empty" ? (
    <Badge tone="amber">Complete · no opportunities</Badge>
  ) : (
    <Badge tone="emerald">Complete</Badge>
  );

  const sections: { value: Section; label: string }[] = [
    { value: "opportunities", label: `Opportunities ${view.opportunities.length}` },
    { value: "problems", label: `Problems ${view.clusters.length}` },
    { value: "competitors", label: `Competitors ${view.competitors.length}` },
    { value: "log", label: `Research log ${searchCount}` },
    { value: "sources", label: `Sources ${view.evidence.length}` },
  ];

  return shell(
    <div className="space-y-8">
      <header className="space-y-5">
        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-300">
          {statusBadge}
          {run.demo && <Badge tone="amber">Recorded example</Badge>}
          <span>{regionLabel(run.region)}</span>
          <span aria-hidden="true" className="text-zinc-500">
            ·
          </span>
          {/* the example's timestamp is when it was replayed, not when the research happened */}
          <span>{run.demo ? `Recorded example, replayed ${replayed}` : date}</span>
          <span aria-hidden="true" className="text-zinc-500">
            ·
          </span>
          <span className="font-mono tabular-nums">
            {run.searchesUsed}/{run.budget} searches
          </span>
        </div>
        <h1 id={FOCUS_FALLBACK_ID} tabIndex={-1} className="max-w-4xl text-balance bg-linear-to-br from-white via-zinc-100 to-zinc-400 bg-clip-text text-3xl font-semibold tracking-tight text-transparent [overflow-wrap:anywhere] focus:outline-none sm:text-4xl">
          {run.question}
        </h1>
        <p className="max-w-3xl text-[15px] leading-relaxed text-zinc-300" aria-live="polite">
          {running && stats.total === 0 ? "Planning the searches…" : summary(view, stats)}
        </p>
        {disconnected && (
          <div role="status" aria-live="polite" className="flex max-w-3xl flex-wrap items-center gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] px-4 py-3 text-sm text-amber-50">
            <span>Connection lost, retrying… The research keeps running on the server; this page will catch up when it can reach it again.</span>
            <button type="button" onClick={retry} className={cx(retryButton, "text-amber-50")}>
              Retry now
            </button>
          </div>
        )}
        {run.error && (
          <p role="alert" className="max-w-3xl rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-4 py-3 text-sm text-rose-100">
            {run.error}
          </p>
        )}
        {(outcome === "limited" || outcome === "empty") && <OutcomeNotice outcome={outcome} stats={stats} onRerun={() => setDialog(true)} canRerun={!run.demo} />}
        <div className="rounded-2xl border border-white/[0.07] bg-zinc-900/40 p-4 sm:p-5">
          <Stepper events={events} status={run.status} stats={stats} />
        </div>
      </header>

      <Segmented name="lr3-section" label="Section" value={section} onChange={setSection} options={sections} className="max-w-full overflow-x-auto [&>label]:flex-none sm:[&>label]:flex-1" />

      {section === "opportunities" && (
        <section aria-label="Opportunities" className="space-y-6">
          {items.length === 0 ? (
            running ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 3 }, (_, i) => (
                  <CardSkeleton key={i} />
                ))}
              </div>
            ) : (
              <p className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-zinc-300">
                {view.gaps.length > 0
                  ? "Every gap this run tested already has a product filling it, so there is nothing to recommend."
                  : stats.failed > 0
                    ? "This run did not get far enough to produce opportunities: too many of its searches failed."
                    : "This run did not get far enough to produce opportunities."}
              </p>
            )
          ) : (
            <>
              <FeaturedCard
                item={items[0]}
                scopeLabel="#1 in this run"
                shortlisted={shortlist.includes(items[0].opportunity.id)}
                onToggleShortlist={() => toggleShortlist(items[0])}
                onOpen={() => setOpenItem(items[0])}
                hideOrigin
              />
              {items.length > 1 && (
                <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {items.slice(1).map((item, i) => (
                    <li key={item.key} className="lr3-appear min-w-0" style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}>
                      <GridCard
                        item={item}
                        rank={i + 2}
                        now={0}
                        shortlisted={shortlist.includes(item.opportunity.id)}
                        onToggleShortlist={() => toggleShortlist(item)}
                        onOpen={() => setOpenItem(item)}
                        hideOrigin
                      />
                    </li>
                  ))}
                </ul>
              )}
              <ScoreExplainer />
            </>
          )}

          {crowded.length > 0 && (
            <div className="rounded-2xl border border-white/[0.07] bg-zinc-900/30 p-5">
              <h2 className="text-sm font-semibold text-zinc-100">Tested and ruled out</h2>
              <p className="mt-1 text-sm text-zinc-300">These looked like gaps until a search found a product that already fills them.</p>
              <ul className="mt-4 space-y-4">
                {crowded.map((g) => (
                  <li key={g.id} className="border-t border-white/[0.06] pt-4">
                    <p className="flex flex-wrap items-center gap-2 text-sm text-zinc-200">
                      <Badge tone="rose">{GAP_LABEL[g.status]}</Badge>
                      {stripCites(g.unmetNeed)}
                    </p>
                    <ul className="mt-2 space-y-1">
                      {g.foundProducts.map((p, i) => {
                        const e = byId.get(p.evidenceId);
                        return (
                          <li key={i} className="text-sm text-zinc-300">
                            <span className="font-medium text-zinc-100">{p.name}</span>: {p.match}
                            {e && (
                              <div className="-mx-2">
                                <SourceLine s={evidenceSource(e)} />
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {section === "problems" && (
        <section aria-label="Problems people have">
          {view.clusters.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-zinc-300">{running ? "Problems appear here once the evidence is grouped." : "No problems were grouped in this run."}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {view.clusters.map((c, i) => (
                <ProblemCard
                  key={c.id}
                  c={c}
                  signals={view.signals.filter((s) => c.signalIds.includes(s.id))}
                  byId={byId}
                  open={openProblem === c.id || (openProblem === null && i === 0)}
                  onToggle={() => setOpenProblem((cur) => (cur === c.id || (cur === null && i === 0) ? "" : c.id))}
                />
              ))}
            </ul>
          )}
        </section>
      )}

      {section === "competitors" && (
        <section aria-label="Competitors">
          {view.competitors.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-zinc-300">{running ? "Competitors appear here as the run finds them." : "No competitors turned up in the evidence."}</p>
          ) : (
            <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {view.competitors.map((c) => (
                <li key={c.id} className="flex flex-col gap-3 rounded-2xl border border-white/[0.07] bg-zinc-900/40 p-5">
                  <div>
                    <h3 className="text-base font-semibold text-zinc-50 [overflow-wrap:anywhere]">{c.name}</h3>
                    <p className="text-xs capitalize text-zinc-400">{c.category.replace(/-/g, " ")}</p>
                  </div>
                  {/* "Not verified": the searches did not turn up a figure that passed the evidence check; it may still exist */}
                  <dl className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                      <dt className="text-[11px] uppercase tracking-wider text-zinc-400">Pricing</dt>
                      <dd className={cx("mt-0.5", c.pricing ? "text-zinc-100" : "text-zinc-400")}>{c.pricing ?? "Not verified"}</dd>
                    </div>
                    <div className="rounded-lg bg-white/[0.03] px-3 py-2">
                      <dt className="text-[11px] uppercase tracking-wider text-zinc-400">Rating</dt>
                      <dd className={cx("mt-0.5 tabular-nums", c.rating !== null ? "font-mono text-zinc-100" : "text-zinc-400")}>{c.rating !== null ? c.rating.toFixed(1) : "Not verified"}</dd>
                    </div>
                  </dl>
                  {c.complaints.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">What users complain about</p>
                      {c.complaints.slice(0, 2).map((x, i) => {
                        const e = byId.get(x.evidenceId);
                        return (
                          <div key={i} className="mt-2">
                            <p className="text-sm text-zinc-200">{x.text}</p>
                            <Quote quote={x.quote} source={e ? evidenceSource(e) : undefined} />
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-sm text-zinc-400">No complaints found in the evidence.</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {section === "log" && (
        <section aria-label="Research log">
          <ResearchLog events={events} status={run.status} />
        </section>
      )}

      {section === "sources" && (
        <section aria-label="Sources">
          {view.evidence.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center text-sm text-zinc-300">No search results yet.</p>
          ) : (
            <ol className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {view.evidence.map((e) => (
                <li key={e.id} className="rounded-xl border border-white/[0.07] bg-zinc-900/40 p-2">
                  <SourceLine s={evidenceSource(e)} />
                  {(e.snippet || e.text) && <p className="line-clamp-3 px-2 pb-1 text-xs leading-relaxed text-zinc-400">{e.snippet || e.text}</p>}
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>,
    <>
      <span aria-hidden="true" className="text-zinc-600">
        /
      </span>
      <span className="truncate text-zinc-300">Research run</span>
    </>,
    <>
      <button
        type="button"
        onClick={() => void exportMarkdown()}
        disabled={exportState === "busy"}
        title="Download this run as Markdown"
        className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-sm text-zinc-200 transition-all duration-200 hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:opacity-60"
      >
        <ExternalIcon size={15} />
        <span className="sr-only sm:not-sr-only">{exportState === "busy" ? "Exporting…" : exportState === "failed" ? "Export failed, retry" : "Export"}</span>
      </button>
    </>,
  );
}
