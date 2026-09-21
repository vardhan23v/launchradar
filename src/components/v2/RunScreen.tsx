"use client";

/**
 * LaunchRadar — redesigned Run workspace.
 * Drop-in replacement for `src/components/RunClient.tsx` (see redesign/INTEGRATION.md).
 *
 * Pure by design: no fetch, no storage, no router. Streaming frames come in as a new `run` prop.
 */

import { useMemo, useState, type ReactNode } from "react";

import {
  Banner,
  Btn,
  BudgetRing,
  Card,
  Chip,
  CommandPalette,
  Drawer,
  Empty,
  EvidenceCard,
  Kbd,
  Meter,
  MetricBars,
  ScoreRing,
  Segmented,
  Skeleton,
  StageRail,
  Stat,
  Tabs,
  ThemeControls,
  Toasts,
  Topbar,
  copyText,
  useCommandK,
  useGlobalKeys,
  useNow,
  useToasts,
  type PaletteItem,
} from "./primitives";

import {
  EMPTY_FILTER,
  filterOpportunities,
  formatDuration,
  relativeTime,
  sortOpportunities,
  statusLabel,
  summarizeChanges,
  type BoardFilter,
  type ChangeVM,
  type DensityVM,
  type OpportunityVM,
  type RunVM,
  type SortKey,
  type ThemeVM,
} from "@/lib/v2/viewModel";

export type RunTab = "opportunities" | "saved" | "changes";

export interface RunClientProps {
  run: RunVM;
  /** The previous run of the same question, used by the change view (F8). */
  previous?: RunVM;
  /** A streaming frame arrived recently; animate updates. */
  streaming?: boolean;
  /** Seconds elapsed, when the host owns the clock. Otherwise derived from the run. */
  elapsedSeconds?: number;
  shortlisted: string[];
  dismissed: string[];
  theme: ThemeVM;
  density: DensityVM;
  onTheme: (next: ThemeVM) => void;
  onDensity: (next: DensityVM) => void;
  onBack: () => void;
  onRerun: () => void;
  onDelete: () => void;
  onToggleShortlist: (id: string) => void;
  onToggleDismiss: (id: string) => void;
  onExport: (format: "markdown" | "json" | "csv", shortlistOnly: boolean) => void;
  /** Offered when a stage was skipped or the run stopped early (F10). */
  onRetryMissing?: () => void;
  /** Host-supplied panel appended to the status rail (used for the live research log). */
  asideExtra?: ReactNode;
  topbarExtra?: ReactNode;
}

const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: "score", label: "Highest score" },
  { value: "competition", label: "Least competition" },
  { value: "evidence", label: "Most sources" },
  { value: "name", label: "Name" },
];

function changeTone(change: ChangeVM | undefined): "ok" | "warn" | "bad" | "info" | "neutral" {
  if (change === "new") return "info";
  if (change === "up") return "ok";
  if (change === "down") return "warn";
  if (change === "dropped") return "bad";
  return "neutral";
}

function changeLabel(change: ChangeVM | undefined, delta: number | undefined): string {
  if (change === "new") return "New since last run";
  if (change === "up") return `Up ${delta !== undefined ? `+${Math.round(delta)}` : ""}`.trim();
  if (change === "down") return `Down ${delta !== undefined ? Math.round(delta) : ""}`.trim();
  if (change === "dropped") return "Dropped";
  return "Unchanged";
}

/* ---------------------------------------------------------------- opportunity card */

function OpportunityCard({
  o, index, selected, saved, dismissed, flash,
  onSelect, onOpenEvidence, onToggleShortlist, onToggleDismiss,
}: {
  o: OpportunityVM;
  index: number;
  selected: boolean;
  saved: boolean;
  dismissed: boolean;
  flash: boolean;
  onSelect: () => void;
  onOpenEvidence: () => void;
  onToggleShortlist: () => void;
  onToggleDismiss: () => void;
}) {
  const gapsFilled = o.gaps.filter((g) => g.filled).length;
  return (
    <article
      className={`lr-op${selected ? " lr-op--on" : ""}${dismissed ? " lr-op--dim" : ""}${flash ? " lr-flash" : ""}`}
      aria-label={`${o.name}, score ${Math.round(o.score)}`}
      onMouseEnter={onSelect}
    >
      <header className="lr-op__head">
        <span className="lr-op__idx lr-num">{String(index + 1).padStart(2, "0")}</span>
        <div style={{ minWidth: 0 }}>
          <div className="lr-op__name">{o.name}</div>
          {o.oneLiner ? <div className="lr-op__one">{o.oneLiner}</div> : null}
        </div>
        <div className="lr-spacer" />
        <ScoreRing score={o.score} />
      </header>

      {o.change && o.change !== "same" ? (
        <div className="lr-row lr-row--wrap">
          <Chip tone={changeTone(o.change)} dot>
            {changeLabel(o.change, o.delta)}
          </Chip>
        </div>
      ) : null}

      {o.metrics.length > 0 ? <MetricBars metrics={o.metrics} /> : null}

      <footer className="lr-op__foot">
        {o.competitorCount !== undefined ? (
          <Chip title="Products already filling this space">{`${o.competitorCount} competitors`}</Chip>
        ) : null}
        {o.gaps.length > 0 ? (
          <Chip tone={gapsFilled === o.gaps.length ? "ok" : "warn"} title="Gaps tested versus gaps already filled">
            {`${gapsFilled}/${o.gaps.length} gaps filled`}
          </Chip>
        ) : null}
        <Chip tone={o.evidence.length > 0 ? "info" : "bad"}>{`${o.evidence.length} sources`}</Chip>
        <div className="lr-spacer" />
        <Btn size="sm" variant="ghost" onClick={onOpenEvidence} disabled={o.evidence.length === 0}>
          Sources
        </Btn>
        <Btn
          size="sm"
          variant={saved ? "primary" : "quiet"}
          active={saved}
          onClick={onToggleShortlist}
          ariaLabel={saved ? `Remove ${o.name} from shortlist` : `Save ${o.name} to shortlist`}
          title="Shortlist (S)"
        >
          {saved ? "Saved" : "Save"}
        </Btn>
        <Btn
          size="sm"
          variant="quiet"
          onClick={onToggleDismiss}
          ariaLabel={dismissed ? `Restore ${o.name}` : `Dismiss ${o.name}`}
          title="Dismiss (X)"
        >
          {dismissed ? "Restore" : "Dismiss"}
        </Btn>
      </footer>
    </article>
  );
}
/* ---------------------------------------------------------------- table view */

function OpportunityTable({
  rows, selectedId, onSelect, onOpenEvidence, sort, onSort,
}: {
  rows: OpportunityVM[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onOpenEvidence: (id: string) => void;
  sort: SortKey;
  onSort: (next: SortKey) => void;
}) {
  const header = (key: SortKey, label: string) => (
    <th scope="col">
      <button type="button" onClick={() => onSort(key)} title={`Sort by ${label}`}>
        {label}
        {sort === key ? <span aria-hidden="true"> ↓</span> : null}
      </button>
    </th>
  );
  return (
    <div className="lr-card" style={{ overflowX: "auto" }}>
      <table className="lr-table">
        <caption className="lr-sr">Opportunities in this run</caption>
        <thead>
          <tr>
            {header("name", "Opportunity")}
            {header("score", "Score")}
            {header("competition", "Competitors")}
            <th scope="col">Gaps filled</th>
            {header("evidence", "Sources")}
            <th scope="col">Change</th>
            <th scope="col">
              <span className="lr-sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id} className={selectedId === o.id ? "is-on" : undefined} onClick={() => onSelect(o.id)}>
              <td>
                <div className="lr-op__name" style={{ fontSize: 13 }}>{o.name}</div>
                {o.oneLiner ? <div className="lr-op__one">{o.oneLiner}</div> : null}
              </td>
              <td className="lr-num">{Math.round(o.score)}</td>
              <td className="lr-num">{o.competitorCount ?? "—"}</td>
              <td className="lr-num">{`${o.gaps.filter((g) => g.filled).length}/${o.gaps.length}`}</td>
              <td className="lr-num">{o.evidence.length}</td>
              <td>
                {o.change && o.change !== "same" ? (
                  <Chip tone={changeTone(o.change)}>{changeLabel(o.change, o.delta)}</Chip>
                ) : (
                  <span className="lr-muted">—</span>
                )}
              </td>
              <td>
                <Btn
                  size="sm"
                  variant="quiet"
                  onClick={() => onOpenEvidence(o.id)}
                  disabled={o.evidence.length === 0}
                  ariaLabel={`Open sources for ${o.name}`}
                >
                  Sources
                </Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
/* ---------------------------------------------------------------- run screen */

export default function RunClient(props: RunClientProps) {
  const {
    run, previous, streaming = false, elapsedSeconds, shortlisted, dismissed,
    theme, density, onTheme, onDensity, onBack, onRerun, onDelete,
    onToggleShortlist, onToggleDismiss, onExport, onRetryMissing, asideExtra, topbarExtra,
  } = props;

  const [tab, setTab] = useState<RunTab>("opportunities");
  const [filter, setFilter] = useState<BoardFilter>(EMPTY_FILTER);
  const [sort, setSort] = useState<SortKey>("score");
  const [view, setView] = useState<"cards" | "table">("cards");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);

  const now = useNow(1000);
  const { toasts, push, dismiss } = useToasts();

  const changes = useMemo(() => summarizeChanges(run), [run]);
  const savedOrders = useMemo(() => new Set(shortlisted), [shortlisted]);
  const dismissedSet = useMemo(() => new Set(dismissed), [dismissed]);

  const tabRows = useMemo<OpportunityVM[]>(() => {
    if (tab === "saved") return run.opportunities.filter((o) => savedOrders.has(o.id));
    if (tab === "changes") {
      return run.opportunities.filter((o) => o.change !== undefined && o.change !== "same");
    }
    return run.opportunities;
  }, [tab, run.opportunities, savedOrders]);

  const rows = useMemo(
    () => sortOpportunities(filterOpportunities(tabRows, filter, shortlisted), sort),
    [tabRows, filter, shortlisted, sort],
  );

  const selected = useMemo(
    () => run.opportunities.find((o) => o.id === selectedId) ?? null,
    [run.opportunities, selectedId],
  );

  const elapsed = useMemo(() => {
    if (elapsedSeconds !== undefined) return elapsedSeconds;
    const start = Date.parse(run.startedAt);
    if (Number.isNaN(start)) return 0;
    const end = run.endedAt ? Date.parse(run.endedAt) : now > 0 ? now : start;
    if (Number.isNaN(end)) return 0;
    return Math.max(0, Math.round((end - start) / 1000));
  }, [elapsedSeconds, run.startedAt, run.endedAt, now]);

  const isActive =
    run.status === "queued" || run.status === "running" || run.status === "planning" ||
    run.status === "searching" || run.status === "verifying" || run.status === "gaps" ||
    run.status === "scoring";

  const coverage = run.coverage;
  const sourcedPct = coverage.claims > 0 ? Math.round((coverage.sourced / coverage.claims) * 100) : 0;
  const skippedStages = run.stages.filter((s) => s.status === "skipped");
  const prevLabel = previous
    ? previous.endedAt ?? previous.startedAt
    : null;

  const select = (id: string) => setSelectedId(id);
  const openEvidence = (id: string) => {
    setSelectedId(id);
    setDrawerOpen(true);
  };
  const copyAllSources = async (o: OpportunityVM) => {
    const text = o.evidence.map((e) => `${e.quote}\n${e.url}`).join("\n\n");
    const ok = await copyText(text);
    push(ok ? `Copied ${o.evidence.length} sources` : "Copy failed — select the text manually", ok ? "ok" : "bad");
  };

  useCommandK(() => setPaletteOpen(true));
  useGlobalKeys({
    j: () => {
      const at = rows.findIndex((o) => o.id === selectedId);
      const next = rows[Math.min(rows.length - 1, at + 1)] ?? rows[0];
      if (next) select(next.id);
    },
    k: () => {
      const at = rows.findIndex((o) => o.id === selectedId);
      const prev = rows[Math.max(0, at - 1)] ?? rows[rows.length - 1];
      if (prev) select(prev.id);
    },
    s: () => {
      if (!selected) return;
      const wasSaved = savedOrders.has(selected.id);
      onToggleShortlist(selected.id);
      push(wasSaved ? "Removed from shortlist" : "Saved to shortlist");
    },
    x: () => {
      if (selected) onToggleDismiss(selected.id);
    },
    e: () => {
      if (selected && selected.evidence.length > 0) setDrawerOpen(true);
    },
    Escape: () => {
      setDrawerOpen(false);
      setExportMenuOpen(false);
    },
  });

  const paletteItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { id: "back", label: "Back to research", kind: "Navigate", onRun: onBack },
      { id: "rerun", label: "Re-run this question", kind: "Action", onRun: onRerun },
      {
        id: "export-md",
        label: "Export Markdown",
        kind: "Export",
        onRun: () => onExport("markdown", false),
      },
      {
        id: "export-shortlist",
        label: `Export shortlist (${shortlisted.length})`,
        kind: "Export",
        onRun: () => onExport("markdown", true),
      },
      { id: "tab-saved", label: `Show shortlist`, kind: "View", onRun: () => setTab("saved") },
      { id: "tab-changes", label: "Show changes since last run", kind: "View", onRun: () => setTab("changes") },
      { id: "delete", label: "Delete this run", kind: "Danger", onRun: onDelete },
    ];
    run.opportunities.slice(0, 8).forEach((o) => {
      items.push({
        id: `opp-${o.id}`,
        label: o.name,
        kind: "Opportunity",
        hint: `${Math.round(o.score)}/100`,
        onRun: () => openEvidence(o.id),
      });
    });
    return items;
  }, [run.opportunities, shortlisted.length, onBack, onRerun, onExport, onDelete]);
  return (
    <div className="lr-root" data-lr-theme={theme === "light" ? "light" : "dark"} data-lr-density={density}>
      <Topbar
        env={<span className="lr-topbar__env">{run.demo ? "Recorded demo" : "Live run"}</span>}
        onHome={onBack}
        onOpenPalette={() => setPaletteOpen(true)}
        right={
          <div className="lr-row">
            {topbarExtra}
            <ThemeControls theme={theme} onTheme={onTheme} density={density} onDensity={onDensity} />
          </div>
        }
      />

      <main className="lr-main lr-main--wide">
        <div className="lr-workspace lr-workspace--noaside">
          <aside className="lr-aside" aria-label="Run status">
            <Card title="Progress">
              <div className="lr-row" style={{ alignItems: "flex-start", gap: 14 }}>
                <BudgetRing elapsedSeconds={elapsed} budgetSeconds={run.budgetSeconds} />
                <div className="lr-stack" style={{ gap: 4, minWidth: 0 }}>
                  <Chip
                    dot
                    tone={
                      isActive ? "info" : run.status === "partial" ? "warn" : run.status === "failed" ? "bad" : "ok"
                    }
                  >
                    {statusLabel(run.status)}
                  </Chip>
                  <span className="lr-help lr-num">
                    {run.searchesUsed} of {run.searchesCap} searches
                  </span>
                  <span className="lr-help lr-num">Elapsed {formatDuration(elapsed)}</span>
                </div>
              </div>
              <div style={{ height: 16 }} />
              <StageRail stages={run.stages} />
            </Card>

            <Card title="Trust and coverage">
              <Meter
                label="Claims with a verbatim source"
                value={coverage.sourced}
                max={Math.max(coverage.claims, coverage.sourced)}
                tone={sourcedPct >= 90 ? "ok" : sourcedPct >= 60 ? "warn" : "bad"}
                hint="Every statement must quote its source word for word, or it is thrown out"
              />
              <div style={{ height: 10 }} />
              <Meter
                label="Gaps already filled by another product"
                value={coverage.gapsFilled}
                max={Math.max(coverage.gapsTested, coverage.gapsFilled)}
                tone="warn"
                hint="Gap tests are searches for a product that already solves the need"
              />
              <div className="lr-stats" style={{ marginTop: 12 }}>
                <Stat k="Claims" v={coverage.claims} />
                <Stat k="Discarded" v={coverage.discarded} title="Thrown out for lacking a verbatim source" />
                <Stat k="Sources" v={run.opportunities.reduce((n, o) => n + o.evidence.length, 0)} />
              </div>
              <p className="lr-help" style={{ marginTop: 10 }}>
                Sourced plus discarded equals claims: {coverage.sourced} + {coverage.discarded} ={" "}
                {coverage.sourced + coverage.discarded}.
              </p>
            </Card>

            <Card title="Keys">
              <div className="lr-stack" style={{ gap: 6 }}>
                <span className="lr-help">
                  <Kbd>J</Kbd> <Kbd>K</Kbd> move · <Kbd>S</Kbd> save · <Kbd>X</Kbd> dismiss
                </span>
                <span className="lr-help">
                  <Kbd>E</Kbd> sources · <Kbd>Esc</Kbd> close · <Kbd>⌘K</Kbd> commands
                </span>
              </div>
            </Card>

            {asideExtra}
          </aside>

          <section className="lr-board" aria-label="Opportunities">
            <header className="lr-stack">
              <div className="lr-row lr-row--wrap">
                <Btn size="sm" variant="ghost" onClick={onBack}>
                  ← Research
                </Btn>
                <span className="lr-spacer" />
                <span className="lr-menu-wrap">
                  <Btn
                    size="sm"
                    variant="ghost"
                    onClick={() => setExportMenuOpen(!exportMenuOpen)}
                    ariaLabel="Export this run"
                  >
                    Export
                  </Btn>
                  {exportMenuOpen ? (
                    <div className="lr-menu" role="menu">
                      {(["markdown", "json", "csv"] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          role="menuitem"
                          className="lr-menu__item"
                          onClick={() => {
                            onExport(f, false);
                            setExportMenuOpen(false);
                          }}
                        >
                          This run as {f}
                        </button>
                      ))}
                      <button
                        type="button"
                        role="menuitem"
                        className="lr-menu__item"
                        disabled={shortlisted.length === 0}
                        onClick={() => {
                          onExport("markdown", true);
                          setExportMenuOpen(false);
                        }}
                      >
                        Shortlist only ({shortlisted.length})
                      </button>
                    </div>
                  ) : null}
                </span>
                <Btn size="sm" variant="ghost" onClick={onRerun}>
                  Re-run
                </Btn>
                <Btn size="sm" variant="danger" onClick={onDelete}>
                  Delete
                </Btn>
              </div>

              <h1 className="lr-q">{run.question}</h1>

              <div className="lr-row lr-row--wrap">
                <Chip tone={run.demo ? "info" : "ok"} dot>
                  {run.demo ? "Recorded demo" : "Live"}
                </Chip>
                <Chip>{run.region}</Chip>
                <span className="lr-count">{now > 0 ? `Started ${relativeTime(run.startedAt, now)}` : "—"}</span>
              </div>
            </header>

            {streaming ? (
              <Banner tone="info" title="Streaming results">
                Cards appear as soon as they are sourced. Nothing is written before its quote arrives.
              </Banner>
            ) : null}

            {run.status === "partial" ? (
              <Banner
                tone="warn"
                title="This run finished early"
                action={
                  onRetryMissing && skippedStages.length > 0 ? (
                    <Btn size="sm" variant="ghost" onClick={onRetryMissing}>
                      Retry missing stages
                    </Btn>
                  ) : undefined
                }
              >
                The {run.budgetSeconds}s budget ran out, so{" "}
                {skippedStages.length > 0
                  ? `${skippedStages.length} optional ${skippedStages.length === 1 ? "stage was" : "stages were"} skipped`
                  : "some optional work was skipped"}
                . Fewer opportunities were tested than a full run would cover — re-run to fill the gaps.
              </Banner>
            ) : null}

            {run.status === "failed" ? (
              <Banner
                tone="bad"
                title="A stage failed"
                action={
                  onRetryMissing ? (
                    <Btn size="sm" variant="ghost" onClick={onRetryMissing}>
                      Try again
                    </Btn>
                  ) : undefined
                }
              >
                {run.stages.find((s) => s.status === "failed")?.detail ??
                  "The run stopped before scoring finished. Nothing was invented to cover the missing part."}
              </Banner>
            ) : null}

            {run.notes.map((n) => (
              <Banner key={n} tone="info">
                {n}
              </Banner>
            ))}

            <Tabs<RunTab>
              value={tab}
              onChange={setTab}
              tabs={[
                { id: "opportunities", label: "Opportunities", count: run.opportunityCount ?? run.opportunities.length },
                { id: "saved", label: "Shortlist", count: shortlisted.length },
                {
                  id: "changes",
                  label: previous ? "Changes since last run" : "Changes",
                  count: Math.max(0, changes.added + changes.up + changes.down + changes.dropped),
                },
              ]}
            />

            <div className="lr-toolbar">
              <input
                className="lr-input"
                value={filter.query}
                placeholder="Filter by name, metric or quoted text"
                aria-label="Filter opportunities"
                onChange={(e) => setFilter({ ...filter, query: e.target.value })}
              />
              <Segmented<"0" | "40" | "70">
                ariaLabel="Minimum score"
                value={filter.minScore === 70 ? "70" : filter.minScore === 40 ? "40" : "0"}
                onChange={(v) => setFilter({ ...filter, minScore: Number(v) })}
                options={[
                  { value: "0", label: "Any score" },
                  { value: "40", label: "40+" },
                  { value: "70", label: "70+" },
                ]}
              />
              <select
                className="lr-select"
                style={{ width: "auto" }}
                value={sort}
                aria-label="Sort by"
                onChange={(e) => setSort(e.target.value as SortKey)}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <Btn size="sm" variant="ghost" onClick={() => setFilter({ ...filter, onlyShortlisted: !filter.onlyShortlisted })} active={filter.onlyShortlisted}>
                Shortlisted
              </Btn>
              {tab === "opportunities" && previous ? (
                <Btn size="sm" variant="ghost" active={filter.onlyChanged} onClick={() => setFilter({ ...filter, onlyChanged: !filter.onlyChanged })}>
                  Changed only
                </Btn>
              ) : null}
              <div className="lr-spacer" />
              <Segmented<"cards" | "table">
                ariaLabel="Layout"
                value={view}
                onChange={setView}
                options={[
                  { value: "cards", label: "Cards" },
                  { value: "table", label: "Table" },
                ]}
              />
              <span className="lr-count lr-num">
                {rows.length} of {tabRows.length}
              </span>
            </div>

            {tab === "changes" ? (
              <Banner
                tone={previous ? "info" : "warn"}
                title={
                  previous
                    ? `Compared with the run from ${now > 0 && prevLabel ? relativeTime(prevLabel, now) : "earlier"}`
                    : "No earlier run to compare against"
                }
              >
                {previous
                  ? `${changes.added} new · ${changes.up} up · ${changes.down} down · ${changes.dropped} dropped · ${changes.unchanged} unchanged`
                  : "Re-run this question and the differences will be shown here."}
              </Banner>
            ) : null}

            {streaming && rows.length === 0 ? (
              <div className="lr-grid">
                <Skeleton variant="card" />
                <Skeleton variant="card" />
                <Skeleton variant="card" />
              </div>
            ) : rows.length === 0 ? (
              tab === "saved" ? (
                <Empty
                  title="Shortlist is empty"
                  text="Press S on an opportunity, or use Save on a card, to keep it here. The shortlist can be exported on its own."
                />
              ) : tab === "changes" ? (
                <Empty
                  title="Nothing changed"
                  text="Every opportunity in this run scored within 2 points of the previous run — or there was no earlier run to compare against."
                />
              ) : (
                <Empty
                  title="No opportunities match those filters"
                  text="Widen the score range, clear the search box, or switch the shortlist filter off."
                  action={
                    <Btn size="sm" variant="ghost" onClick={() => setFilter(EMPTY_FILTER)}>
                      Clear filters
                    </Btn>
                  }
                />
              )
            ) : view === "cards" ? (
              <div className="lr-grid">
                {rows.map((o, i) => (
                  <OpportunityCard
                    key={o.id}
                    o={o}
                    index={i}
                    selected={selectedId === o.id}
                    saved={savedOrders.has(o.id)}
                    dismissed={dismissedSet.has(o.id)}
                    flash={streaming}
                    onSelect={() => select(o.id)}
                    onOpenEvidence={() => openEvidence(o.id)}
                    onToggleShortlist={() => onToggleShortlist(o.id)}
                    onToggleDismiss={() => onToggleDismiss(o.id)}
                  />
                ))}
              </div>
            ) : (
              <OpportunityTable
                rows={rows}
                selectedId={selectedId}
                onSelect={select}
                onOpenEvidence={openEvidence}
                sort={sort}
                onSort={setSort}
              />
            )}
          </section>
        </div>
      </main>

      <Drawer
        open={drawerOpen && selected !== null}
        onClose={() => setDrawerOpen(false)}
        title={selected ? selected.name : "Sources"}
        subtitle={
          selected ? `${Math.round(selected.score)}/100 · ${selected.evidence.length} sources` : undefined
        }
        footer={
          selected ? (
            <>
              <Btn
                size="sm"
                variant="primary"
                onClick={() => {
                  const wasSaved = savedOrders.has(selected.id);
                  onToggleShortlist(selected.id);
                  push(wasSaved ? "Removed from shortlist" : "Saved to shortlist");
                }}
              >
                {savedOrders.has(selected.id) ? "Remove from shortlist" : "Add to shortlist"}
              </Btn>
              <Btn
                size="sm"
                variant="ghost"
                disabled={selected.evidence.length === 0}
                onClick={() => {
                  void copyAllSources(selected);
                }}
              >
                Copy all sources
              </Btn>
              <div className="lr-spacer" />
              <Btn size="sm" variant="quiet" onClick={() => setDrawerOpen(false)}>
                Close
              </Btn>
            </>
          ) : undefined
        }
      >
        {selected ? (
          <>
            {selected.oneLiner ? (
              <p className="lr-help" style={{ margin: 0 }}>
                {selected.oneLiner}
              </p>
            ) : null}

            {selected.competitorCount !== undefined ? (
              <Chip tone={selected.competitorCount === 0 ? "ok" : "warn"} dot>
                {selected.competitorCount === 0
                  ? "No product found already filling this"
                  : `${selected.competitorCount} products already filling this`}
              </Chip>
            ) : null}

            {selected.gaps.length > 0 ? (
              <div className="lr-stack" style={{ gap: 8 }}>
                <span className="lr-label">Gaps tested</span>
                {selected.gaps.map((g) => (
                  <div key={g.id} className="lr-row" style={{ alignItems: "flex-start", gap: 8 }}>
                    <Chip
                      tone={g.status === "served" ? "bad" : g.status === "partially-served" ? "warn" : "ok"}
                      dot
                    >
                      {g.status === "served"
                        ? "Already filled"
                        : g.status === "partially-served"
                          ? "Partially served"
                          : "Still open"}
                    </Chip>
                    <div>
                      <div>{g.statement}</div>
                      {g.note ? <div className="lr-help">{g.note}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {selected.metrics.length > 0 ? (
              <div className="lr-stack" style={{ gap: 8 }}>
                <span className="lr-label">Score breakdown</span>
                {selected.metrics.map((m) => (
                  <Meter key={m.id} label={m.label} value={m.value} max={m.max} hint={m.hint} />
                ))}
              </div>
            ) : null}

            {selected.detail && selected.detail.length > 0 ? (
              <div className="lr-stack" style={{ gap: 10 }}>
                <span className="lr-label">The reasoning</span>
                {selected.detail.map((row) => (
                  <div key={`${row.label}-${row.text.slice(0, 24)}`}>
                    <div className="lr-help" style={{ fontWeight: 600 }}>{row.label}</div>
                    <p style={{ margin: "2px 0 0" }}>{row.text}</p>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="lr-stack" style={{ gap: 8 }}>
              <span className="lr-label">Sources, quoted word for word</span>
              {selected.evidence.length === 0 ? (
                <p className="lr-help" style={{ margin: 0 }}>
                  No quote survived verification, so this statement is not asserted anywhere in the run.
                </p>
              ) : (
                selected.evidence.map((ev) => (
                  <EvidenceCard
                    key={ev.id}
                    ev={ev}
                    onCopy={(text) => {
                      void copyText(text).then((ok) =>
                        push(ok ? "Quote copied" : "Copy failed — select it manually", ok ? "ok" : "bad"),
                      );
                    }}
                  />
                ))
              )}
            </div>
          </>
        ) : null}
      </Drawer>

      <Toasts toasts={toasts} onDismiss={dismiss} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
        placeholder="Jump to an opportunity, export or action…"
      />
    </div>
  );
}






