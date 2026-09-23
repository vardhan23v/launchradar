"use client";

/**
 * The home page: every opportunity LaunchRadar has found, as one ranked, filterable feed.
 *
 * Data comes from finished runs this browser keeps (src/lib/history.ts) plus finished runs the API
 * still holds. The shortlist uses the triage board's storage (lr:v2:shortlist:<runId>), so a star
 * here shows there and the other way round.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RunView } from "@/lib/types";
import { listSavedRuns, loadSavedRun, saveFinishedRun } from "@/lib/history";
import { loadIds, saveIds } from "@/lib/v2/adapter";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  buildFeed,
  facetCounts,
  runKey,
  sortItems,
  type FeedItem,
  type Filters,
  type SortKey,
  type ViewMode,
} from "@/lib/v3/feed";
import { CardSkeleton, FeaturedCard, GridCard, ListRow } from "./Cards";
import DetailPanel from "./DetailPanel";
import FilterPanel from "./FilterPanel";
import { blockedReasonFor, fetchRunEvents, getJson, useHome, useStartRun } from "./hooks";
import { CloseIcon, FilterIcon, GridIcon, ListIcon, PlusIcon, RadarLogo } from "./icons";
import NewResearchDialog from "./NewResearchDialog";
import { FOCUS_FALLBACK_ID, Segmented, useModal } from "./parts";
import TopNav from "./TopNav";

const VIEW_KEY = "lr:v3:view";
const MAX_SERVER_RUNS = 12;
const LG = "(min-width: 1024px)";

function readViewMode(): ViewMode {
  try {
    return window.localStorage.getItem(VIEW_KEY) === "list" ? "list" : "grid";
  } catch {
    return "grid";
  }
}

function shortlistFor(views: RunView[]): Set<string> {
  const out = new Set<string>();
  for (const v of views) for (const id of loadIds(v.run.id, "shortlist")) out.add(`${v.run.id}:${id}`);
  return out;
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Top rated" },
  { key: "momentum", label: "Trending" },
  { key: "newest", label: "Newest" },
];

export default function Dashboard() {
  const { home, down, loaded } = useHome();
  const { start, busy, error: startError, clearError } = useStartRun(home);
  const [views, setViews] = useState<RunView[]>([]);
  const [serverDone, setServerDone] = useState(false);
  const [capped, setCapped] = useState(0);
  const [slow, setSlow] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("score");
  const [mode, setMode] = useState<ViewMode>("grid");
  const [shortlist, setShortlist] = useState<Set<string>>(() => new Set());
  const [openItem, setOpenItem] = useState<FeedItem | null>(null);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [announce, setAnnounce] = useState("");
  const focusAfter = useRef<string | null>(null);

  // this browser's own runs, read after mount so the server render and hydration agree
  useEffect(() => {
    const slowTimer = window.setTimeout(() => setSlow(true), 4000);
    const t = window.setTimeout(() => {
      setNow(Date.now());
      setMode(readViewMode());
      const local = listSavedRuns()
        .map((r) => loadSavedRun(r.id)?.view)
        .filter((v): v is RunView => !!v);
      setViews(local);
      setShortlist(shortlistFor(local));
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(slowTimer);
    };
  }, []);

  // then the finished runs the server still holds: newest run per question first, so repeats
  // (every replay of the example, every re-run) never use up the cap
  useEffect(() => {
    if (!loaded) return;
    let alive = true;
    void (async () => {
      if (!home) {
        if (alive) setServerDone(true);
        return;
      }
      const localRuns = listSavedRuns();
      const newestLocal = new Map<string, number>();
      for (const r of localRuns) newestLocal.set(runKey(r), Math.max(newestLocal.get(runKey(r)) ?? 0, r.createdAt));
      const have = new Set(localRuns.map((r) => r.id));
      const seen = new Set<string>();
      const wanted = [...home.runs]
        .filter((r) => r.status === "complete" && !have.has(r.id))
        .sort((a, b) => b.createdAt - a.createdAt)
        .filter((r) => {
          const k = runKey(r);
          if (seen.has(k) || (newestLocal.get(k) ?? 0) >= r.createdAt) return false;
          seen.add(k);
          return true;
        });
      const fetched = (await Promise.all(wanted.slice(0, MAX_SERVER_RUNS).map((r) => getJson<RunView>(`/api/runs/${r.id}`)))).filter((v): v is RunView => !!v);
      if (!alive) return;
      setCapped(Math.max(0, wanted.length - MAX_SERVER_RUNS));
      setViews((prev) => [...prev, ...fetched.filter((f) => !prev.some((p) => p.run.id === f.run.id))]);
      const fromServer = shortlistFor(fetched);
      setShortlist((prev) => new Set([...prev, ...fromServer]));
      setServerDone(true);
    })();
    return () => {
      alive = false;
    };
  }, [loaded, home]);

  const loading = !serverDone;
  const { items, runs } = useMemo(() => buildFeed(views, shortlist), [views, shortlist]);
  const counts = useMemo(() => facetCounts(items), [items]);
  const visible = useMemo(() => (now === null ? [] : sortItems(applyFilters(items, filters, shortlist, now), sort)), [items, filters, shortlist, now, sort]);
  const shortlistCount = useMemo(() => items.filter((i) => shortlist.has(i.key)).length, [items, shortlist]);
  const active = activeFilterCount(filters) + (filters.search.trim() ? 1 : 0);

  // one short announcement once the results settle, not one per keystroke
  useEffect(() => {
    if (loading) return;
    const t = window.setTimeout(() => setAnnounce(`${visible.length} ${visible.length === 1 ? "result" : "results"}`), 600);
    return () => window.clearTimeout(t);
  }, [visible.length, loading]);

  // after un-starring in shortlist view, focus moves to the next card instead of the page top
  useEffect(() => {
    const k = focusAfter.current;
    if (k === null) return;
    focusAfter.current = null;
    const target = k ? document.querySelector<HTMLElement>(`[data-feed-key="${CSS.escape(k)}"] [data-open]`) : document.getElementById("lr3-clear-filters");
    (target ?? document.getElementById(FOCUS_FALLBACK_ID))?.focus();
  }, [visible]);

  const toggleShortlist = useCallback(
    (item: FeedItem) => {
      // read storage now, so a star made in another tab or on the triage board is never overwritten
      const ids = loadIds(item.runId, "shortlist");
      const oppId = item.opportunity.id;
      const on = !ids.includes(oppId);
      const next = on ? [...ids, oppId] : ids.filter((x) => x !== oppId);
      saveIds(item.runId, "shortlist", next);
      if (!on && filters.shortlistedOnly) {
        const i = visible.findIndex((v) => v.key === item.key);
        focusAfter.current = visible[i + 1]?.key ?? visible[i - 1]?.key ?? "";
      }
      setShortlist((prev) => {
        const s = new Set([...prev].filter((k) => !k.startsWith(`${item.runId}:`)));
        for (const id of next) s.add(`${item.runId}:${id}`);
        return s;
      });
      // a star is a reason to keep the run: copy one that only the (forgetful) server holds
      const view = views.find((v) => v.run.id === item.runId);
      if (on && view && !view.run.demo && !loadSavedRun(item.runId)) {
        void fetchRunEvents(item.runId).then((events) => events && saveFinishedRun(view, events));
      }
    },
    [filters.shortlistedOnly, visible, views],
  );

  const changeMode = (next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* the choice just will not survive a reload */
    }
  };

  const example = home?.demos[0];
  const blockedReason = blockedReasonFor(home, down);
  const apiNote = home || down ? (blockedReason ?? "New questions can be researched.") : null;

  const showCategories = () => {
    if (!window.matchMedia(LG).matches) {
      setSheet(true);
      return;
    }
    const el = document.getElementById("side-categories");
    const box = el?.closest<HTMLElement>("[data-scroll-box]");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (el && box) box.scrollTo({ top: el.offsetTop - box.offsetTop, behavior: reduce ? "auto" : "smooth" });
    el?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  };

  const closeDetail = useCallback(() => setOpenItem(null), []);
  const closeSheet = useCallback(() => setSheet(false), []);
  const closeDialog = useCallback(() => {
    setDialog(false);
    clearError();
  }, [clearError]);

  const featured = visible[0];
  const rest = visible.slice(1);
  const scopeLabel = sort === "momentum" ? "#1 trending" : sort === "newest" ? "Latest find" : "#1 by score";
  const dateSuffix = filters.date === "today" ? " today" : filters.date === "week" ? " this week" : "";

  const cardProps = (item: FeedItem, rank: number) => ({
    item,
    rank,
    now: now ?? 0,
    shortlisted: shortlist.has(item.key),
    onToggleShortlist: () => toggleShortlist(item),
    onOpen: () => setOpenItem(item),
  });

  return (
    <div className="lr3 relative min-h-screen overflow-x-clip bg-zinc-950 text-zinc-100 antialiased">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_20%_0%,rgba(99,102,241,0.16),transparent_70%),radial-gradient(40%_50%_at_90%_10%,rgba(16,185,129,0.08),transparent_70%)]" />
      <div aria-hidden="true" className="lr3-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      <TopNav
        search={{ value: filters.search, onChange: (search) => setFilters((f) => ({ ...f, search })) }}
        sort={sort}
        onSort={setSort}
        onCategories={showCategories}
        onNew={() => setDialog(true)}
        budget={home?.budget ? { monthUsed: home.budget.monthUsed, monthLimit: home.budget.monthLimit } : null}
        apiNote={apiNote}
        shortcutsEnabled={!dialog && !sheet && !openItem}
      />

      <main className="relative mx-auto grid max-w-7xl gap-8 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div data-scroll-box="" className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6 pr-2 [scrollbar-width:thin]">
            <FilterPanel filters={filters} onChange={setFilters} counts={counts} shortlistCount={shortlistCount} idPrefix="side" />
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 id={FOCUS_FALLBACK_ID} tabIndex={-1} className="bg-linear-to-br from-white via-zinc-100 to-zinc-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent focus:outline-none sm:text-3xl">
                On the radar
              </h1>
              <p className="mt-1 max-w-2xl text-sm text-zinc-300">
                {loading && items.length === 0
                  ? slow
                    ? "Waking the research server. The free host sleeps when idle, so this can take up to a minute."
                    : "Loading findings…"
                  : items.length === 0
                    ? "No findings yet."
                    : `${visible.length} of ${items.length} ${items.length === 1 ? "opportunity" : "opportunities"} from ${runs.length} research ${runs.length === 1 ? "run" : "runs"}. Each case links the search results it cites.`}
              </p>
              <p className="sr-only" aria-live="polite" aria-atomic="true">
                {announce}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSheet(true)}
                aria-haspopup="dialog"
                aria-expanded={sheet}
                className="relative inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-200 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 lg:hidden"
              >
                <FilterIcon size={15} />
                Filters
                {activeFilterCount(filters) > 0 && (
                  <span className="grid size-5 place-items-center rounded-full bg-indigo-500 font-mono text-[10px] font-semibold text-white">
                    <span className="sr-only">, active: </span>
                    {activeFilterCount(filters)}
                  </span>
                )}
              </button>

              <label className="sr-only" htmlFor="lr3-sort">
                Sort by
              </label>
              <select
                id="lr3-sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="h-9 rounded-lg border border-white/10 bg-zinc-900 px-2.5 text-sm text-zinc-200 focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
              >
                {SORTS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>

              <Segmented
                name="lr3-layout"
                label="Layout"
                value={mode}
                onChange={changeMode}
                className="p-0.5"
                options={[
                  { value: "grid", title: "Grid view", label: <><GridIcon size={16} /><span className="sr-only">Grid view</span></> },
                  { value: "list", title: "Compact list", label: <><ListIcon size={16} /><span className="sr-only">Compact list</span></> },
                ]}
              />
            </div>
          </div>

          {down && (
            <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
              The research server is not reachable, so only runs saved in this browser are shown.
            </p>
          )}
          {capped > 0 && (
            <p role="status" className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-300">
              Showing the {MAX_SERVER_RUNS} most recent questions from the server; {capped} older {capped === 1 ? "one is" : "ones are"} not loaded.
            </p>
          )}

          {loading && items.length === 0 ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : items.length === 0 ? (
            <EmptyRadar onNew={() => setDialog(true)} onExample={example ? () => void start({ demo: example.slug }) : null} busy={busy} />
          ) : visible.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-6 py-16 text-center">
              <p className="text-base font-medium text-zinc-100">Nothing matches these filters.</p>
              <p className="mt-1 text-sm text-zinc-300">
                {active} {active === 1 ? "filter is" : "filters are"} narrowing {items.length} opportunities down to none.
              </p>
              <button
                id="lr3-clear-filters"
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="mt-5 inline-flex h-9 items-center rounded-lg border border-white/10 px-3.5 text-sm font-medium text-zinc-100 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
              >
                Clear search and filters
              </button>
            </div>
          ) : (
            <>
              {featured && <FeaturedCard {...cardProps(featured, 1)} scopeLabel={`${scopeLabel}${dateSuffix}`} />}

              {rest.length > 0 &&
                (mode === "grid" ? (
                  <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    {rest.map((item, i) => (
                      <li key={item.key} style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }} className="lr3-appear min-w-0">
                        <GridCard {...cardProps(item, i + 2)} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <ul className="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.07] bg-zinc-900/30">
                    {rest.map((item, i) => (
                      <ListRow key={item.key} {...cardProps(item, i + 2)} />
                    ))}
                  </ul>
                ))}
            </>
          )}
        </div>
      </main>

      {sheet && (
        <FilterSheet onClose={closeSheet} count={visible.length}>
          <FilterPanel filters={filters} onChange={setFilters} counts={counts} shortlistCount={shortlistCount} idPrefix="sheet" />
        </FilterSheet>
      )}

      {openItem && <DetailPanel item={openItem} shortlisted={shortlist.has(openItem.key)} onToggleShortlist={() => toggleShortlist(openItem)} onClose={closeDetail} />}

      {dialog && (
        <NewResearchDialog
          onClose={closeDialog}
          onStart={(question, region) => void start({ question, region })}
          onExample={() => example && void start({ demo: example.slug })}
          busy={busy}
          error={startError}
          blockedReason={blockedReason}
          runBudget={home?.budget?.run ?? 25}
          hasExample={!!example}
        />
      )}
    </div>
  );
}

function EmptyRadar({ onNew, onExample, busy }: { onNew: () => void; onExample: (() => void) | null; busy: boolean }) {
  return (
    <section className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/40 px-6 py-16 text-center">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(99,102,241,0.18),transparent_60%)]" />
      <div className="relative mx-auto flex max-w-md flex-col items-center">
        <RadarLogo size={56} />
        <h2 className="mt-5 text-xl font-semibold tracking-tight text-white">Nothing on the radar yet</h2>
        <p className="mt-2 text-sm leading-relaxed text-zinc-300">
          Each research run adds the opportunities it finds here, ranked and filterable. Start with a market you know, or open the recorded example to see
          what a finished run looks like.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onNew}
            aria-haspopup="dialog"
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(99,102,241,0.8)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
          >
            <PlusIcon size={16} />
            New research
          </button>
          {onExample && (
            <button
              type="button"
              onClick={onExample}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:opacity-50"
            >
              Open the recorded example
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

function FilterSheet({ onClose, count, children }: { onClose: () => void; count: number; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useModal(ref, onClose, closeRef);
  // the sheet only exists below 1024px: if the screen grows past that (a tablet rotating), close it,
  // or the page would stay scroll-locked behind a sheet nobody can see
  useEffect(() => {
    const mq = window.matchMedia(LG);
    const onChange = () => mq.matches && onClose();
    const t = window.setTimeout(onChange, 0);
    mq.addEventListener("change", onChange);
    return () => {
      window.clearTimeout(t);
      mq.removeEventListener("change", onChange);
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Filters" className="lr3-slide-left absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col border-r border-white/10 bg-zinc-950/95 backdrop-blur-xl">
        <div className="flex items-center justify-end px-4 pt-3">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close filters"
            className="grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        <div className="border-t border-white/[0.06] p-4">
          <button type="button" onClick={onClose} className="h-10 w-full rounded-xl bg-white text-sm font-semibold text-zinc-900 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">
            Show {count} {count === 1 ? "result" : "results"}
          </button>
        </div>
      </div>
    </div>
  );
}
