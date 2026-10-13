"use client";

import Link from "next/link";
import { Fragment, useEffect, useId, useRef, useState } from "react";

import { citeGroups } from "@/lib/evidence";
import { SUB_SCORES, ideaLink, regionLabel, stripCites, type FeedItem } from "@/lib/v3/feed";
import { ArrowRightIcon, CloseIcon } from "./icons";
import { CitedText, ConfidenceBadge, ExampleBadge, GapBadge, Monogram, ScoreDial, ScoreExplainer, ScoreRadar, ShortlistButton, SourceLine, SubScoreRow, cx, useModal } from "./parts";
import Sparkline, { DIRECTION_LABEL } from "./Sparkline";

const ANCHOR = "lr3-src";
/** how long the "Copied" word stays on the copy button */
const COPIED_MS = 2000;

/** The address of one idea: always the run page, whichever page the panel is open on. */
const linkTo = (item: FeedItem) => ideaLink(item, window.location.origin);

/**
 * Print only the panel, in ink colours: the page behind it (and the panel's own controls) go
 * away, the panel stops floating, and text that was light on dark becomes dark on white.
 */
const PRINT_CSS = `@media print {
  body:has(.lr3-print) { overflow: visible !important; background: #fff !important; }
  .lr3:has(.lr3-print) > :not(.lr3-print) { display: none !important; }
  .lr3-print { position: static !important; inset: auto !important; }
  .lr3-print [data-print-panel] { position: static !important; max-width: none !important; border: 0 !important; box-shadow: none !important; background: #fff !important; backdrop-filter: none !important; }
  .lr3-print [data-print-panel] * { color: #111 !important; background: transparent !important; border-color: #ccc !important; box-shadow: none !important; text-shadow: none !important; }
  .lr3-print [data-print-body] { overflow: visible !important; }
  .lr3-print [data-noprint] { display: none !important; }
}`;

type CopyState = { kind: "idle" } | { kind: "copied" } | { kind: "manual"; link: string };

/* small line icons for the header tools (24-unit grid, like ./icons.tsx) */
const iconProps = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.75, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
const LinkIcon = () => (
  <svg {...iconProps}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </svg>
);
const CheckIcon = () => (
  <svg {...iconProps}>
    <path d="m5 12 4 4L19 7" />
  </svg>
);
const ShareIcon = () => (
  <svg {...iconProps}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M5 12v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7" />
  </svg>
);
const PrintIcon = () => (
  <svg {...iconProps}>
    <path d="M7 9V4h10v5" />
    <rect x="4" y="9" width="16" height="8" rx="1.5" />
    <path d="M7 14h10v6H7z" />
  </svg>
);

const tool =
  "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2.5 text-xs font-medium text-zinc-300 transition-all duration-200 hover:border-white/20 hover:bg-white/[0.07] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70";

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-white/[0.06] pt-5">
      <h3 className="mb-2 text-sm font-semibold text-zinc-300">{title}</h3>
      <div className="text-[15px] leading-relaxed text-zinc-200">{children}</div>
    </section>
  );
}

/** Everything about one idea, every cited sentence footnoted to the web page it came from. */
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
  const linkRef = useRef<HTMLInputElement>(null);
  const linkId = useId();
  const [copy, setCopy] = useState<CopyState>({ kind: "idle" });
  const [canShare, setCanShare] = useState(false);
  // focus starts on the scrollable text, so arrow keys and Page Down read it and Space never closes it
  useModal(panelRef, onClose, bodyRef);

  // the share sheet exists on phones and some desktops only; decided after mount so the server render agrees
  useEffect(() => {
    const t = window.setTimeout(() => setCanShare(typeof navigator !== "undefined" && typeof navigator.share === "function"), 0);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    if (copy.kind !== "copied") return;
    const t = window.setTimeout(() => setCopy({ kind: "idle" }), COPIED_MS);
    return () => window.clearTimeout(t);
  }, [copy]);

  // no clipboard access: the link is shown selected, so one keypress copies it
  useEffect(() => {
    if (copy.kind !== "manual") return;
    linkRef.current?.focus();
    linkRef.current?.select();
  }, [copy]);

  const copyLink = async () => {
    const link = linkTo(item);
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setCopy({ kind: "copied" });
    } catch {
      setCopy({ kind: "manual", link });
    }
  };

  const share = async () => {
    try {
      await navigator.share({ title: item.title, url: linkTo(item) });
    } catch {
      /* the reader closed the share sheet, or the browser refused: nothing to do */
    }
  };

  const print = () => {
    try {
      window.print();
    } catch {
      /* a browser with no print dialog */
    }
  };

  const trendTone = item.trend ? { up: "text-emerald-300", down: "text-rose-300", flat: "text-zinc-300" }[item.trend.direction] : "";

  return (
    <div className="lr3-print fixed inset-0 z-50">
      <style>{PRINT_CSS}</style>
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/60 backdrop-blur-sm" data-noprint="" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr3-detail-title"
        data-print-panel=""
        className="lr3-slide absolute inset-y-0 right-0 flex w-full max-w-2xl flex-col border-l border-white/10 bg-zinc-950/95 shadow-2xl shadow-black backdrop-blur-xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-5 py-3 sm:px-7">
          <p className="min-w-0 truncate text-xs text-zinc-400">
            {item.question} · {regionLabel(item.region)}
          </p>
          <div className="flex shrink-0 items-center gap-1.5" data-noprint="">
            <button type="button" onClick={() => void copyLink()} title="Copy a link to this idea" className={cx(tool, copy.kind === "copied" && "border-emerald-400/30 bg-emerald-400/10 text-emerald-200")}>
              {copy.kind === "copied" ? <CheckIcon /> : <LinkIcon />}
              <span className="sr-only sm:not-sr-only">{copy.kind === "copied" ? "Copied" : "Copy link"}</span>
            </button>
            <span role="status" aria-live="polite" className="sr-only">
              {copy.kind === "copied" ? "Link copied" : ""}
            </span>
            {canShare && (
              <button type="button" onClick={() => void share()} title="Share this idea" className={tool}>
                <ShareIcon />
                <span className="sr-only sm:not-sr-only">Share</span>
              </button>
            )}
            <button type="button" onClick={print} title="Print this idea" className={tool}>
              <PrintIcon />
              <span className="sr-only sm:not-sr-only">Print</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-1 grid size-9 shrink-0 place-items-center rounded-lg text-zinc-400 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              <CloseIcon size={18} />
            </button>
          </div>
        </div>
        {copy.kind === "manual" && (
          <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.02] px-5 py-2 sm:px-7" data-noprint="">
            <label htmlFor={linkId} className="shrink-0 text-xs text-zinc-300">
              Copy this link:
            </label>
            <input
              id={linkId}
              ref={linkRef}
              type="text"
              readOnly
              value={copy.link}
              onFocus={(e) => e.currentTarget.select()}
              className="h-8 min-w-0 flex-1 rounded-lg border border-white/10 bg-white/[0.04] px-2 font-mono text-xs text-zinc-100 focus:border-indigo-400/60 focus:outline-none focus:ring-2 focus:ring-indigo-400/40"
            />
          </div>
        )}

        <div
          ref={bodyRef}
          tabIndex={0}
          role="region"
          aria-labelledby="lr3-detail-title"
          data-print-body=""
          className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/40 sm:px-7"
        >
          <div className="flex items-start gap-4">
            <Monogram title={item.title} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 id="lr3-detail-title" className="text-balance text-xl font-semibold tracking-tight text-white [overflow-wrap:anywhere] sm:text-2xl">
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
            <ul className="space-y-3" aria-label="The parts of the score">
              {SUB_SCORES.map((s) => (
                <SubScoreRow key={s.key} label={s.label} what={s.what} value={o.subScores?.[s.key] ?? 0} max={s.max} />
              ))}
            </ul>
          </div>
          {item.trend && (
            <div className="flex items-center gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
              <Sparkline series={item.trend} className={cx("shrink-0", trendTone)} />
              <div className="min-w-0">
                <p className="text-sm text-zinc-200">
                  Search interest over the last 12 months: <span className={cx("font-medium", trendTone)}>{DIRECTION_LABEL[item.trend.direction]}</span>
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-400" title={item.trend.label}>
                  Google searches for &ldquo;{item.trend.label}&rdquo;
                </p>
              </div>
            </div>
          )}
          <ScoreExplainer />

          <Block title="Who it's for">{o.target}</Block>
          <Block title="The problem">
            <CitedText text={o.problem} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>
          <Block title="What people use now">
            <CitedText text={o.existingSolutions} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>
          <Block title="What's missing">
            <CitedText text={o.gap} footnotes={item.footnotes} anchor={ANCHOR} />
          </Block>
          {o.mvpScope?.length > 0 && (
            <Block title="What to build first">
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
            <Block title="Why it might not work">
              <ul className="space-y-3">
                {o.skeptic.map((s, i) => {
                  // the pages the objection names but does not cite inline still get their footnotes,
                  // so every page in the list below is referenced from the text
                  const inline = new Set(citeGroups(s.basis ?? "").flatMap((g) => g.ids));
                  const extra = [...new Set((s.evidenceIds ?? []).filter((id) => !inline.has(id)).map((id) => item.footnotes[id]).filter(Boolean))].sort((a, b) => a - b);
                  return (
                    <li key={i} className="rounded-xl border border-rose-400/15 bg-rose-400/[0.04] p-3.5">
                      <p className="font-medium text-zinc-100">
                        {stripCites(s.objection)}
                        {extra.length > 0 && (
                          <sup className="ml-0.5 whitespace-nowrap text-xs">
                            {extra.map((n, j) => (
                              <Fragment key={n}>
                                {j > 0 && <span aria-hidden="true" className="text-zinc-500">,</span>}
                                <a href={`#${ANCHOR}-${n}`} className="rounded font-mono text-xs font-medium text-indigo-300 hover:text-indigo-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70" aria-label={`Web page ${n}`}>
                                  {n}
                                </a>
                              </Fragment>
                            ))}
                          </sup>
                        )}
                      </p>
                      <p className="mt-1 text-sm text-zinc-300">
                        <CitedText text={s.basis} footnotes={item.footnotes} anchor={ANCHOR} />
                      </p>
                      {s.wouldChangeMind && (
                        <p className="mt-2 text-sm text-zinc-300">
                          <span className="font-medium text-zinc-200">What would change our mind:</span> {stripCites(s.wouldChangeMind)}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Block>
          )}

          {item.sources.length > 0 && (
            <Block title={`Web pages we read (${item.sources.length})`}>
              <p className="-mt-1 mb-2 text-[13px] text-zinc-400">The pages this idea came from, numbered in the order the text mentions them.</p>
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

        <div className="flex flex-wrap items-center gap-2 border-t border-white/[0.06] bg-zinc-950/80 px-5 py-3 sm:px-7" data-noprint="">
          <ShortlistButton active={shortlisted} onToggle={onToggleShortlist} title={item.title} />
          {showRunLink && (
            <Link
              href={`/runs/${item.runId}`}
              className="group ml-auto inline-flex h-9 items-center gap-2 rounded-lg bg-white px-3.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
            >
              Open the whole search
              <ArrowRightIcon size={15} className="transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
