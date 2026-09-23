"use client";

import Link from "next/link";
import { useRef } from "react";

import { SUB_SCORES, regionLabel, stripCites, type FeedItem } from "@/lib/v3/feed";
import { ArrowRightIcon, CloseIcon } from "./icons";
import { CitedText, ConfidenceBadge, ExampleBadge, GapBadge, Monogram, ScoreDial, ScoreRadar, ShortlistButton, SourceLine, useModal } from "./parts";

const ANCHOR = "lr3-src";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
      <div className="text-[15px] leading-relaxed text-zinc-200">{children}</div>
    </section>
  );
}

/** The full case for one opportunity, every cited sentence footnoted to the result it came from. */
export default function DetailPanel({
  item,
  shortlisted,
  onToggleShortlist,
  onClose,
  showRunLink = true,
}: {
  item: FeedItem;
  shortlisted: boolean;
  onToggleShortlist: () => void;
  onClose: () => void;
  /** off on the run page itself */
  showRunLink?: boolean;
}) {
  const o = item.opportunity;
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // focus starts on the scrollable case, so arrow keys and Page Down read it and Space never closes it
  useModal(panelRef, onClose, bodyRef);

  return (
    <div className="fixed inset-0 z-50">
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr3-detail-title"
        className="lr3-slide absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-white/10 bg-zinc-950/95 shadow-2xl shadow-black backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3 sm:px-7">
          <p className="truncate text-xs text-zinc-400">
            {item.question} · {regionLabel(item.region)}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div
          ref={bodyRef}
          tabIndex={0}
          role="region"
          aria-labelledby="lr3-detail-title"
          className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/40 sm:px-7"
        >
          <div className="flex items-start gap-4">
            <Monogram title={item.title} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 id="lr3-detail-title" className="text-balance text-2xl font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
                {item.title}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.demo && <ExampleBadge />}
                <GapBadge status={item.gapStatus} />
                <ConfidenceBadge value={item.confidence} />
              </div>
            </div>
            <ScoreDial score={item.score} size="md" />
          </div>

          <p className="text-pretty text-lg leading-relaxed text-zinc-100">
            <CitedText text={o.pitch} footnotes={item.footnotes} anchor={ANCHOR} />
          </p>

          <div className="grid items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto" aria-hidden="true">
              <ScoreRadar o={o} size={190} />
            </div>
            <ul className="space-y-2.5" aria-label="Sub-scores">
              {SUB_SCORES.map((s) => {
                const v = o.subScores?.[s.key] ?? 0;
                return (
                  <li key={s.key}>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-300">{s.label}</span>
                      <span className="font-mono tabular-nums text-zinc-100">
                        {Math.round(v * 10) / 10}/{s.max}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
                      <div className="lr3-fill h-full rounded-full bg-linear-to-r from-indigo-400 to-emerald-400" style={{ width: `${(v / s.max) * 100}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <Block title="Who it's for">{o.target}</Block>
          <Block title="The problem">
            <CitedText text={o.problem} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>
          <Block title="What exists today">
            <CitedText text={o.existingSolutions} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>
          <Block title="The gap">
            <CitedText text={o.gap} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>
          {o.mvpScope?.length > 0 && (
            <Block title="First version">
              <ul className="list-disc space-y-1.5 pl-5 marker:text-zinc-500">
                {o.mvpScope.map((m, i) => (
                  <li key={i}>
                    <CitedText text={m} footnotes={item.footnotes} anchor={ANCHOR} />
                  </li>
                ))}
              </ul>
            </Block>
          )}
          <Block title="How to test it first">
            <CitedText text={o.firstValidationStep} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>

          {o.skeptic?.length > 0 && (
            <Block title="The case against">
              <ul className="space-y-3">
                {o.skeptic.map((s, i) => (
                  <li key={i} className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] p-3.5">
                    <p className="font-medium text-zinc-100">{stripCites(s.objection)}</p>
                    <p className="mt-1 text-sm text-zinc-300">
                      <CitedText text={s.basis} footnotes={item.footnotes} anchor={ANCHOR} />
                    </p>
                    {s.wouldChangeMind && <p className="mt-2 text-sm text-zinc-300">Would change the verdict: {stripCites(s.wouldChangeMind)}</p>}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {item.sources.length > 0 && (
            <Block title={`Sources (${item.sources.length})`}>
              <p className="-mt-1 mb-2 text-xs text-zinc-400">Search results this case cites, numbered in reading order.</p>
              <ol className="space-y-1">
                {item.sources.map((s, i) => (
                  <li key={s.id} id={`${ANCHOR}-${i + 1}`} className="scroll-mt-4 rounded-lg target:bg-indigo-400/10">
                    <SourceLine s={s} n={i + 1} />
                  </li>
                ))}
              </ol>
            </Block>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] bg-zinc-950/80 px-5 py-3 sm:px-7">
          <ShortlistButton active={shortlisted} onToggle={onToggleShortlist} title={item.title} />
          {showRunLink && (
            <Link
              href={`/runs/${item.runId}`}
              className="group ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Open the whole run
              <ArrowRightIcon size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
