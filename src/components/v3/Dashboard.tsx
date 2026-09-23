"use client";

/**
 * /v3: every opportunity LaunchRadar has found, as one ranked, filterable feed.
 *
 * Data comes from the same places as the other two views: finished runs this browser keeps
 * (src/lib/history.ts) plus finished runs the API still holds. The shortlist is the triage
 * board's (lr:v2:shortlist:<runId>), so a star here shows there and the other way round.
 */

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { Run, RunView } from "@/lib/types";
import { listSavedRuns, loadSavedRun, setPending, type PendingRun } from "@/lib/history";
import { setRunPathPrefix } from "@/lib/live";
import { loadIds, saveIds } from "@/lib/v2/adapter";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  applyFilters,
  buildFeed,
  facetCounts,
  sortItems,
  type FeedItem,
  type Filters,
  type SortKey,
  type ViewMode,
} from "@/lib/v3/feed";
import { CardSkeleton, FeaturedCard, GridCard, ListRow } from "./Cards";
import DetailPanel from "./DetailPanel";
import FilterPanel from "./FilterPanel";
import { CloseIcon, FilterIcon, GridIcon, ListIcon, PlusIcon, RadarLogo } from "./icons";
import NewResearchDialog from "./NewResearchDialog";
import { cx } from "./parts";
import TopNav from "./TopNav";

interface HomeData {
  runs: Run[];
  demos: { slug: string; label: string; question: string }[];
  budget?: { run: number; monthUsed: number; monthLimit: number };
  pipeline?: { mode: string; ready: boolean; reason: string | null; quota?: string | null; inline?: boolean };
}

const VIEW_KEY = "lr:v3:view";
const MAX_SERVER_RUNS = 12;

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

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Top rated" },
  { key: "momentum", label: "Trending" },
  { key: "newest", label: "Newest" },
];

export default function Dashboard() {
  const router = useRouter();
  const [views, setViews] = useState<RunView[]>([]);
  const [home, setHome] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slow, setSlow] = useState(false);
  const [apiDown, setApiDown] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("score");
  const [mode, setMode] = useState<ViewMode>("grid");
  const [shortlist, setShortlist] = useState<Set<string>>(() => new Set());
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);

  // everything browser-only happens after mount, so the server render and hydration agree
  useEffect(() => {
    let alive = true;
    const slowTimer = window.setTimeout(() => alive && setSlow(true), 4000);
    const t = window.setTimeout(async () => {
      setNow(Date.now());
      setMode(readViewMode());
      const local = listSavedRuns()
        .map((r) => loadSavedRun(r.id)?.view)
        .filter((v): v is RunView => !!v);
      setViews(local);
      setShortlist(shortlistFor(local));

      const data = await getJson<HomeData>("/api/runs");
      if (!alive) return;
      if (!data) {
        setApiDown(true);
        setLoading(false);
        return;
      }
      setHome(data);
      const have = new Set(local.map((v) => v.run.id));
      const wanted = data.runs.filter((r) => r.status === "complete" && !have.has(r.id)).slice(0, MAX_SERVER_RUNS);
      const fetched = (await Promise.all(wanted.map((r) => getJson<RunView>(`/api/runs/${r.id}`)))).filter((v): v is RunView => !!v);
      if (!alive) return;
      const all = [...local, ...fetched];
      setViews(all);
      setShortlist(shortlistFor(all));
      setLoading(false);
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(t);
      window.clearTimeout(slowTimer);
    };
  }, []);

  const { items, runs } = useMemo(() => buildFeed(views), [views]);
  const counts = useMemo(() => facetCounts(items), [items]);
  const visible = useMemo(
    () => (now === null ? [] : sortItems(applyFilters(items, filters, shortlist, now), sort)),
    [items, filters, shortlist, now, sort],
  );
  const shortlistCount = useMemo(() => items.filter((i) => shortlist.has(i.key)).length, [items, shortlist]);
  const openItem = useMemo(() => items.find((i) => i.key === openKey) ?? null, [items, openKey]);
  const active = activeFilterCount(filters) + (filters.search.trim() ? 1 : 0);

  const toggleShortlist = useCallback((item: FeedItem) => {
    setShortlist((prev) => {
      const next = new Set(prev);
      if (next.has(item.key)) next.delete(item.key);
      else next.add(item.key);
      const prefix = `${item.runId}:`;
      saveIds(
        item.runId,
        "shortlist",
        [...next].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
      );
      return next;
    });
  }, []);

  const changeMode = (next: ViewMode) => {
    setMode(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* the choice just will not survive a reload */
    }
  };

  const start = useCallback(
    async (payload: PendingRun) => {
      setStartError(null);
      setBusy(true);
      if (home?.pipeline?.inline) {
        // serverless fallback: the run page performs the run inside one streaming request
        setRunPathPrefix("/runs/");
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
        if (json?.id) router.push(`/runs/${json.id}`);
        else setStartError(json?.error ?? `Could not start the run (HTTP ${res.status}).`);
      } catch {
        setStartError("Could not reach the research API.");
      } finally {
        setBusy(false);
      }
    },
    [home, router],
  );

  const example = home?.demos[0];
  const blockedReason = apiDown
    ? "The research API is not reachable right now, so a new run cannot start."
    : !home
      ? "Connecting to the research API…"
      : home.pipeline?.ready === false
        ? (home.pipeline.reason ?? "New questions are switched off on this server.")
        : (home.pipeline?.quota ?? null);

  const showCategories = () => {
    if (window.matchMedia("(min-width: 1024px)").matches) {
      const el = document.getElementById("lr3-categories");
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      el?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
    } else {
      setSheet(true);
    }
  };

  const closeDetail = useCallback(() => setOpenKey(null), []);
  const closeSheet = useCallback(() => setSheet(false), []);
  const closeDialog = useCallback(() => {
    setDialog(false);
    setStartError(null);
  }, []);

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
    onOpen: () => setOpenKey(item.key),
  });

  return (
    <div className="lr3 relative min-h-screen overflow-x-clip bg-zinc-950 text-zinc-100 antialiased">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_20%_0%,rgba(99,102,241,0.16),transparent_70%),radial-gradient(40%_50%_at_90%_10%,rgba(16,185,129,0.08),transparent_70%)]" />
      <div aria-hidden="true" className="lr3-grid pointer-events-none absolute inset-x-0 top-0 h-[520px]" />

      <TopNav
        search={filters.search}
        onSearch={(search) => setFilters((f) => ({ ...f, search }))}
        sort={sort}
        onSort={setSort}
        onCategories={showCategories}
        onNew={() => setDialog(true)}
        budget={home?.budget ? { monthUsed: home.budget.monthUsed, monthLimit: home.budget.monthLimit } : null}
        apiNote={home ? (home.pipeline?.ready ? "New questions are on." : "New questions are off on this server.") : null}
      />

      <main className="relative mx-auto grid max-w-7xl gap-8 px-4 pb-24 pt-8 sm:px-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto pb-6 pr-2 [scrollbar-width:thin]">
            <FilterPanel filters={filters} onChange={setFilters} counts={counts} shortlistCount={shortlistCount} />
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="bg-linear-to-br from-white via-zinc-100 to-zinc-400 bg-clip-text text-2xl font-semibold tracking-tight text-transparent sm:text-3xl">
                On the radar
              </h1>
              <p className="mt-1 text-sm text-zinc-400" aria-live="polite">
                {loading
                  ? slow
                    ? "Waking the research server. The free host sleeps when idle, so this can take up to a minute."
                    : "Loading findings…"
                  : items.length === 0
                    ? "No findings yet."
                    : `${visible.length} of ${items.length} ${items.length === 1 ? "opportunity" : "opportunities"} from ${runs.length} research ${runs.length === 1 ? "run" : "runs"}. Every claim is quoted from a search result.`}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setSheet(true)}
                className="relative inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm text-zinc-200 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.06] lg:hidden"
              >
                <FilterIcon size={15} />
                Filters
                {activeFilterCount(filters) > 0 && (
                  <span className="grid size-5 place-items-center rounded-full bg-indigo-500 font-mono text-[10px] font-semibold text-white">{activeFilterCount(filters)}</span>
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

              <div role="radiogroup" aria-label="Layout" className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
                {(
                  [
                    ["grid", GridIcon, "Grid view"],
                    ["list", ListIcon, "Compact list"],
                  ] as const
                ).map(([key, Icon, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={mode === key}
                    aria-label={label}
                    title={label}
                    onClick={() => changeMode(key)}
                    className={cx(
                      "grid size-8 place-items-center rounded-md transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                      mode === key ? "bg-white/10 text-white" : "text-zinc-500 hover:text-zinc-200",
                    )}
                  >
                    <Icon size={16} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {apiDown && (
            <p role="status" className="rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-4 py-3 text-sm text-amber-100">
              The research API is not reachable, so only runs saved in this browser are shown.
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
              <p className="mt-1 text-sm text-zinc-400">{active} {active === 1 ? "filter is" : "filters are"} narrowing {items.length} opportunities down to none.</p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="mt-5 inline-flex h-9 items-center rounded-lg border border-white/10 px-3.5 text-sm font-medium text-zinc-100 hover:bg-white/[0.06]"
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
                  <ul className="divide-y divide-white/[0.05] overflow-hidden rounded-2xl border border-white/[0.07] bg-zinc-900/30">
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
          <FilterPanel filters={filters} onChange={setFilters} counts={counts} shortlistCount={shortlistCount} />
        </FilterSheet>
      )}

      {openItem && (
        <DetailPanel item={openItem} shortlisted={shortlist.has(openItem.key)} onToggleShortlist={() => toggleShortlist(openItem)} onClose={closeDetail} />
      )}

      {dialog && (
        <NewResearchDialog
          onClose={closeDialog}
          onStart={(question, region) => void start({ question, region })}
          onExample={() => example && void start({ demo: example.slug })}
          busy={busy}
          error={startError}
          blockedReason={blockedReason}
          runBudget={home?.budget?.run ?? 25}
          budget={home?.budget ? { monthUsed: home.budget.monthUsed, monthLimit: home.budget.monthLimit } : null}
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
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          Each research run adds the opportunities it finds here, ranked and filterable. Start with a market you know, or open the
          recorded example to see what a finished run looks like.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            type="button"
            onClick={onNew}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(99,102,241,0.8)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400"
          >
            <PlusIcon size={16} />
            New research
          </button>
          {onExample && (
            <button
              type="button"
              onClick={onExample}
              disabled={busy}
              className="inline-flex h-10 items-center rounded-xl border border-white/10 px-4 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] disabled:opacity-50"
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
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" aria-label="Filters" className="lr3-slide-left absolute inset-y-0 left-0 flex w-[88%] max-w-sm flex-col border-r border-white/10 bg-zinc-950/95 backdrop-blur-xl">
        <div className="flex items-center justify-end px-4 pt-3">
          <button type="button" onClick={onClose} aria-label="Close filters" className="grid size-9 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
            <CloseIcon size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        <div className="border-t border-white/[0.06] p-4">
          <button type="button" onClick={onClose} className="h-10 w-full rounded-xl bg-white text-sm font-semibold text-zinc-900 hover:bg-indigo-50">
            Show {count} {count === 1 ? "result" : "results"}
          </button>
        </div>
      </div>
    </div>
  );
}
