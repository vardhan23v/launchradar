"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";

import { SUB_SCORES, regionLabel, stripCites, type FeedItem } from "@/lib/v3/feed";
import { CloseIcon, ExternalIcon } from "./icons";
import { CitedText, ConfidenceBadge, GapBadge, Monogram, ScoreDial, ScoreRadar, ShortlistButton } from "./parts";

const ANCHOR = "lr3-src";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-5">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-500">{title}</h3>
      <div className="text-[15px] leading-relaxed text-zinc-200">{children}</div>
    </section>
  );
}

/** The full case for one opportunity, every sentence footnoted to the page it came from. */
export default function DetailPanel({
  item,
  shortlisted,
  onToggleShortlist,
  onClose,
}: {
  item: FeedItem;
  shortlisted: boolean;
  onToggleShortlist: () => void;
  onClose: () => void;
}) {
  const o = item.opportunity;
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // focus moves in, Escape closes, Tab stays inside, the page behind stops scrolling,
  // and focus returns to whatever opened the panel
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);

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
          <p className="truncate text-xs text-zinc-500">
            {item.question} · {regionLabel(item.region)}
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            <CloseIcon size={18} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-6 sm:px-7">
          <header className="flex items-start gap-4">
            <Monogram title={item.title} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 id="lr3-detail-title" className="text-balance text-2xl font-semibold tracking-tight text-white [overflow-wrap:anywhere]">
                {item.title}
              </h2>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <GapBadge status={item.gapStatus} />
                <ConfidenceBadge value={item.confidence} />
              </div>
            </div>
            <ScoreDial score={item.score} size="md" />
          </header>

          <p className="text-pretty text-lg leading-relaxed text-zinc-100">
            <CitedText text={o.pitch} footnotes={item.footnotes} anchor={ANCHOR} />
          </p>

          <div className="grid items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto">
              <ScoreRadar o={o} size={190} />
            </div>
            <ul className="space-y-2.5">
              {SUB_SCORES.map((s) => {
                const v = o.subScores?.[s.key] ?? 0;
                return (
                  <li key={s.key}>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-400">{s.label}</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {Math.round(v * 10) / 10}/{s.max}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
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
              <ul className="list-disc space-y-1.5 pl-5 marker:text-zinc-600">
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
                    <p className="mt-1 text-sm text-zinc-400">
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
              <ol className="space-y-1">
                {item.sources.map((s, i) => (
                  <li key={s.url} id={`${ANCHOR}-${i + 1}`} className="scroll-mt-4 rounded-lg target:bg-indigo-400/10">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group flex items-start gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                    >
                      <span className="mt-0.5 w-5 shrink-0 text-right font-mono text-xs text-zinc-500">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm text-zinc-100 group-hover:text-white">{s.title || s.domain}</span>
                        <span className="block truncate text-xs text-zinc-500">{s.domain}</span>
                      </span>
                      <ExternalIcon size={14} className="mt-1 shrink-0 text-zinc-600 group-hover:text-zinc-300" />
                    </a>
                  </li>
                ))}
              </ol>
            </Block>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] bg-zinc-950/80 px-5 py-3 sm:px-7">
          <ShortlistButton active={shortlisted} onToggle={onToggleShortlist} />
          <div className="ml-auto flex gap-2">
            <Link
              href={`/v2/runs/${item.runId}`}
              className="inline-flex h-9 items-center rounded-lg border border-white/10 px-3 text-sm text-zinc-200 transition-colors hover:bg-white/[0.06]"
            >
              Triage board
            </Link>
            <Link
              href={`/runs/${item.runId}`}
              className="inline-flex h-9 items-center rounded-lg bg-white px-3 text-sm font-medium text-zinc-900 transition-colors hover:bg-indigo-50"
            >
              Full report
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
