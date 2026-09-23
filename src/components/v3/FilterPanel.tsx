"use client";

import type { GapStatus } from "@/lib/types";
import { GAP_LABEL, activeFilterCount, regionLabel, type DateRange, type Filters, type facetCounts } from "@/lib/v3/feed";
import { StarIcon } from "./icons";
import { cx } from "./parts";

type Counts = ReturnType<typeof facetCounts>;

const DATES: { key: DateRange; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "week", label: "This week" },
  { key: "all", label: "All time" },
];

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Section({ title, id, children }: { title: string; id?: string; children: React.ReactNode }) {
  return (
    <div id={id} className="scroll-mt-24 border-t border-white/[0.06] pt-4">
      <fieldset>
        <legend className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</legend>
        {children}
      </fieldset>
    </div>
  );
}

function Check({ checked, onChange, label, count, title }: { checked: boolean; onChange: () => void; label: string; count: number; title?: string }) {
  return (
    <label
      title={title}
      className={cx(
        "flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors duration-150",
        checked ? "bg-indigo-400/10 text-white" : "text-zinc-300 hover:bg-white/[0.04]",
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="peer sr-only" />
      <span
        aria-hidden="true"
        className={cx(
          "grid size-4 shrink-0 place-items-center rounded border transition-all duration-150 peer-focus-visible:ring-2 peer-focus-visible:ring-indigo-400/70",
          checked ? "border-indigo-400 bg-indigo-500" : "border-white/20 bg-white/[0.03]",
        )}
      >
        {checked && (
          <svg viewBox="0 0 12 12" className="size-3 text-white" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="m2.5 6.5 2.5 2.5 4.5-5.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="font-mono text-xs tabular-nums text-zinc-500">{count}</span>
    </label>
  );
}

export default function FilterPanel({
  filters,
  onChange,
  counts,
  shortlistCount,
}: {
  filters: Filters;
  onChange: (next: Filters) => void;
  counts: Counts;
  shortlistCount: number;
}) {
  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const active = activeFilterCount(filters);
  const gapOrder: GapStatus[] = ["open", "partially-served", "served"];
  const confidenceOrder = ["High", "Medium", "Low"];
  const confidences = [...counts.confidence.keys()].sort((a, b) => confidenceOrder.indexOf(a) - confidenceOrder.indexOf(b));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Filters</h2>
        <button
          type="button"
          disabled={!active}
          onClick={() => onChange({ ...filters, regions: [], gaps: [], confidence: [], questions: [], date: "all", shortlistedOnly: false })}
          className="text-xs font-medium text-indigo-300 transition-colors hover:text-indigo-200 disabled:cursor-default disabled:text-zinc-600"
        >
          Clear{active ? ` (${active})` : ""}
        </button>
      </div>

      <button
        type="button"
        aria-pressed={filters.shortlistedOnly}
        onClick={() => set({ shortlistedOnly: !filters.shortlistedOnly })}
        className={cx(
          "flex w-full items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
          filters.shortlistedOnly
            ? "border-amber-300/40 bg-amber-300/10 text-amber-100"
            : "border-white/[0.08] bg-white/[0.02] text-zinc-300 hover:border-white/15 hover:bg-white/[0.05]",
        )}
      >
        <StarIcon size={15} filled={filters.shortlistedOnly} className={filters.shortlistedOnly ? "text-amber-300" : "text-zinc-400"} />
        Shortlist only
        <span className="ml-auto font-mono text-xs tabular-nums text-zinc-500">{shortlistCount}</span>
      </button>

      <Section title="When">
        <div role="radiogroup" aria-label="Date range" className="grid grid-cols-3 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
          {DATES.map((d) => (
            <button
              key={d.key}
              type="button"
              role="radio"
              aria-checked={filters.date === d.key}
              onClick={() => set({ date: d.key })}
              className={cx(
                "rounded-lg px-2 py-1.5 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                filters.date === d.key ? "bg-white/10 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200",
              )}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Section>

      {counts.questions.size > 0 && (
        <Section title="Research question" id="lr3-categories">
          <div className="space-y-0.5">
            {[...counts.questions.entries()].map(([q, n]) => (
              <Check key={q} label={q} title={q} count={n} checked={filters.questions.includes(q)} onChange={() => set({ questions: toggle(filters.questions, q) })} />
            ))}
          </div>
        </Section>
      )}

      <Section title="Gap status">
        <div className="space-y-0.5">
          {gapOrder
            .filter((g) => counts.gaps.has(g))
            .map((g) => (
              <Check key={g} label={GAP_LABEL[g]} count={counts.gaps.get(g) ?? 0} checked={filters.gaps.includes(g)} onChange={() => set({ gaps: toggle(filters.gaps, g) })} />
            ))}
        </div>
      </Section>

      <Section title="Confidence">
        <div className="space-y-0.5">
          {confidences.map((c) => (
            <Check key={c} label={c} count={counts.confidence.get(c) ?? 0} checked={filters.confidence.includes(c)} onChange={() => set({ confidence: toggle(filters.confidence, c) })} />
          ))}
        </div>
      </Section>

      <Section title="Region">
        <div className="space-y-0.5">
          {[...counts.regions.entries()].map(([r, n]) => (
            <Check key={r} label={regionLabel(r)} count={n} checked={filters.regions.includes(r)} onChange={() => set({ regions: toggle(filters.regions, r) })} />
          ))}
        </div>
      </Section>
    </div>
  );
}
