"use client";

import type { FeedItem } from "@/lib/v3/feed";
import { regionLabel, relativeDay } from "@/lib/v3/feed";
import { ArrowRightIcon, TrophyIcon } from "./icons";
import { ConfidenceBadge, GapBadge, Monogram, ScoreDial, ScoreRadar, ShortlistButton, SourcesPopover, cx } from "./parts";

interface CardProps {
  item: FeedItem;
  rank: number;
  now: number;
  shortlisted: boolean;
  onToggleShortlist: () => void;
  onOpen: () => void;
}

/** Where a finding came from: the research question plays the part a maker would on a launch site. */
function Origin({ item, now }: { item: FeedItem; now: number }) {
  return (
    <p className="flex min-w-0 items-center gap-2 text-xs text-zinc-400">
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center rounded-full bg-zinc-800 font-mono text-[9px] font-semibold uppercase text-zinc-300 ring-1 ring-white/10"
      >
        {item.region}
      </span>
      <span className="truncate" title={item.question}>
        {item.question}
      </span>
      <span aria-hidden="true" className="text-zinc-600">
        ·
      </span>
      <span className="shrink-0 text-zinc-500">{item.demo ? "Example" : relativeDay(item.createdAt, now)}</span>
    </p>
  );
}

/** #1 of the current feed: glowing border, the sub-score pentagon as its preview. */
export function FeaturedCard({ item, shortlisted, onToggleShortlist, onOpen, scopeLabel }: Omit<CardProps, "rank"> & { scopeLabel: string }) {
  return (
    <section aria-labelledby="lr3-featured-title" className="lr3-appear relative">
      <div aria-hidden="true" className="pointer-events-none absolute -inset-6 rounded-[2rem] bg-indigo-500/10 blur-3xl" />
      <div className="relative rounded-2xl bg-linear-to-br from-indigo-400/70 via-sky-400/30 to-emerald-400/60 p-px shadow-[0_0_60px_-20px_rgba(99,102,241,0.65)]">
        <div className="relative overflow-hidden rounded-[15px] bg-zinc-950/90 backdrop-blur-xl">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.18),transparent_55%)]" />
          <div className="relative grid gap-6 p-5 sm:p-7 md:grid-cols-[minmax(0,1fr)_auto] md:gap-8">
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-indigo-400/15 px-2.5 py-1 text-xs font-semibold text-indigo-200 ring-1 ring-inset ring-indigo-400/30">
                  <TrophyIcon size={13} />
                  {scopeLabel}
                </span>
                <GapBadge status={item.gapStatus} />
                <ConfidenceBadge value={item.confidence} />
              </div>

              <div className="flex items-start gap-4">
                <Monogram title={item.title} size="lg" />
                <div className="min-w-0">
                  <h2 id="lr3-featured-title" className="text-balance text-2xl font-semibold tracking-tight text-white [overflow-wrap:anywhere] sm:text-3xl">
                    <button type="button" onClick={onOpen} className="text-left transition-colors hover:text-indigo-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 rounded-md">
                      {item.title}
                    </button>
                  </h2>
                  <p className="mt-2 max-w-2xl text-pretty text-[15px] leading-relaxed text-zinc-300">{item.tagline}</p>
                </div>
              </div>

              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div className="min-w-0">
                  <dt className="text-xs text-zinc-500">For</dt>
                  <dd className="text-zinc-200">{item.opportunity.target}</dd>
                </div>
                <div className="min-w-0">
                  <dt className="text-xs text-zinc-500">Found by researching</dt>
                  <dd className="truncate text-zinc-200" title={item.question}>
                    {item.question} · {regionLabel(item.region)}
                  </dd>
                </div>
              </dl>

              <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={onOpen}
                  className="group inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-zinc-900 transition-all duration-200 hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
                >
                  Read the case
                  <ArrowRightIcon size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </button>
                <ShortlistButton active={shortlisted} onToggle={onToggleShortlist} />
                <SourcesPopover sources={item.sources} onSeeAll={onOpen} />
              </div>
            </div>

            <div className="flex items-center justify-center gap-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 md:flex-col md:justify-between">
              <div className="flex flex-col items-center gap-1.5 md:order-2">
                <ScoreDial score={item.score} size="lg" />
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">Score</span>
              </div>
              <div className="hidden sm:block md:order-1">
                <ScoreRadar o={item.opportunity} size={200} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/** A feed card. The title is the one link; the card is clickable through it (stretched link). */
export function GridCard({ item, rank, now, shortlisted, onToggleShortlist, onOpen }: CardProps) {
  return (
    <article
      className={cx(
        "group relative flex h-full flex-col gap-4 rounded-2xl border border-white/[0.07] bg-zinc-900/40 p-5",
        "transition-all duration-200 hover:-translate-y-0.5 hover:border-indigo-500/50 hover:bg-zinc-900/70 hover:shadow-[0_12px_40px_-20px_rgba(99,102,241,0.55)]",
        "focus-within:border-indigo-500/50",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <Monogram title={item.title} />
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs tabular-nums text-zinc-600">#{rank}</span>
          <ScoreDial score={item.score} size="sm" />
        </div>
      </div>

      <div className="min-w-0">
        <h3 className="text-base font-semibold leading-snug tracking-tight text-zinc-50 [overflow-wrap:anywhere]">
          <button
            type="button"
            onClick={onOpen}
            className="text-left after:absolute after:inset-0 after:rounded-2xl focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-indigo-400/70"
          >
            {item.title}
          </button>
        </h3>
        <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-zinc-400">{item.tagline}</p>
        <div className="mt-3">
          <Origin item={item} now={now} />
        </div>
      </div>

      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-3 gap-y-3 border-t border-white/[0.06] pt-4">
        <div className="flex flex-wrap gap-1.5">
          <GapBadge status={item.gapStatus} />
          <ConfidenceBadge value={item.confidence} />
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <SourcesPopover sources={item.sources} onSeeAll={onOpen} />
          <ShortlistButton active={shortlisted} onToggle={onToggleShortlist} compact />
        </div>
      </div>
    </article>
  );
}

/** Compact row for the list view. */
export function ListRow({ item, rank, now, shortlisted, onToggleShortlist, onOpen }: CardProps) {
  return (
    <li
      className={cx(
        "lr3-appear group relative flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4",
        "transition-colors duration-200 hover:bg-white/[0.03] focus-within:bg-white/[0.03]",
      )}
    >
      <span className="hidden w-6 shrink-0 text-right font-mono text-xs tabular-nums text-zinc-600 sm:block">{rank}</span>
      <Monogram title={item.title} size="sm" />
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-zinc-100">
          <button type="button" onClick={onOpen} className="text-left after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-indigo-400/70">
            {item.title}
          </button>
        </h3>
        <p className="truncate text-xs text-zinc-400">{item.tagline}</p>
        <div className="mt-1 md:hidden">
          <Origin item={item} now={now} />
        </div>
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 lg:flex">
        <GapBadge status={item.gapStatus} />
        <ConfidenceBadge value={item.confidence} />
      </div>
      <div className="hidden w-56 shrink-0 md:block">
        <Origin item={item} now={now} />
      </div>
      <ScoreDial score={item.score} size="sm" />
      <ShortlistButton active={shortlisted} onToggle={onToggleShortlist} compact />
    </li>
  );
}

export function CardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-4 rounded-2xl border border-white/[0.06] bg-zinc-900/30 p-5" aria-hidden="true">
      <div className="flex justify-between">
        <div className="lr3-shimmer size-11 rounded-xl" />
        <div className="lr3-shimmer size-10 rounded-full" />
      </div>
      <div className="lr3-shimmer h-4 w-3/4 rounded" />
      <div className="space-y-2">
        <div className="lr3-shimmer h-3 w-full rounded" />
        <div className="lr3-shimmer h-3 w-2/3 rounded" />
      </div>
      <div className="flex gap-1.5">
        <div className="lr3-shimmer h-5 w-16 rounded-full" />
        <div className="lr3-shimmer h-5 w-24 rounded-full" />
      </div>
      <div className="lr3-shimmer mt-auto h-8 w-full rounded-lg" />
    </div>
  );
}
