"use client";

import { useId, useRef, useState } from "react";

import { INTRO, REGIONS, TOPIC_IDEAS } from "@/lib/v3/feed";
import { ChevronDownIcon, CloseIcon, RadarLogo } from "./icons";
import { HowItWorks, cx, useModal } from "./parts";

const MAX = 300; // the server refuses longer topics

export default function NewResearchDialog({
  onClose,
  onStart,
  onExample,
  busy,
  error,
  blockedReason,
  runBudget,
  hasExample,
  initialQuestion = "",
  initialRegion = "in",
}: {
  onClose: () => void;
  onStart: (question: string, region: string) => void;
  onExample: () => void;
  busy: boolean;
  error: string | null;
  /** Why a new search cannot start right now (missing keys, lookup limit), or null. */
  blockedReason: string | null;
  runBudget: number;
  hasExample: boolean;
  initialQuestion?: string;
  initialRegion?: string;
}) {
  const [question, setQuestion] = useState(initialQuestion);
  const [region, setRegion] = useState(initialRegion);
  const [showHow, setShowHow] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useModal(dialogRef, onClose, inputRef);
  const ids = { q: useId(), count: useId(), note: useId(), region: useId(), how: useId(), ideas: useId() };

  const trimmed = question.trim();
  const canStart = !busy && !blockedReason && trimmed.length > 0 && trimmed.length <= MAX;

  /** A ready-made topic fills the box; focus goes to its end so the reader can change it. */
  const pickTopic = (topic: string) => {
    setQuestion(topic);
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    // the box shows the new text after React renders; put the cursor after it then
    window.requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr3-new-title"
        className="lr3-rise relative max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-t-2xl border border-white/10 bg-zinc-900/95 shadow-2xl shadow-black/70 backdrop-blur-xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-2xl"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.25),transparent_70%)]" />
        <form
          className="relative p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) onStart(trimmed, region);
          }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <RadarLogo size={32} />
              <h2 id="lr3-new-title" className="text-lg font-semibold tracking-tight text-white">
                New search
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              <CloseIcon size={16} />
            </button>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-zinc-300">{INTRO}</p>
          <button
            type="button"
            aria-expanded={showHow}
            aria-controls={ids.how}
            onClick={() => setShowHow((v) => !v)}
            className="mt-1.5 rounded text-[13px] font-medium text-indigo-300 transition-colors hover:text-indigo-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            {showHow ? "Hide how it works" : "How does this work?"}
          </button>

          {showHow && (
            <div id={ids.how} className="lr3-appear mt-4 rounded-xl border border-white/[0.07] bg-white/[0.02] px-4 py-3">
              <HowItWorks />
            </div>
          )}

          <div className="mt-5">
            <label htmlFor={ids.q} className="text-[13px] font-medium text-zinc-200">
              What topic?
            </label>
            <textarea
              id={ids.q}
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                // an input method confirms a candidate with Enter: that must never start a search
                if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canStart) onStart(trimmed, region);
                }
              }}
              rows={3}
              maxLength={MAX}
              aria-describedby={`${ids.count} ${ids.note}`}
              placeholder="e.g. meal planning for nurses"
              className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[15px] text-zinc-100 placeholder:text-zinc-400 transition-all duration-200 focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
            />
            <p id={ids.count} className="mt-1 text-right font-mono text-xs tabular-nums text-zinc-400">
              {question.length} of {MAX} characters
            </p>
            <p id={ids.ideas} className="mt-2 text-[13px] font-medium text-zinc-300">
              Try one of these
            </p>
            <ul aria-labelledby={ids.ideas} className="mt-1.5 flex flex-wrap gap-1.5">
              {TOPIC_IDEAS.map((topic) => {
                const picked = trimmed === topic;
                return (
                  <li key={topic}>
                    <button
                      type="button"
                      aria-pressed={picked}
                      onClick={() => pickTopic(topic)}
                      className={cx(
                        "rounded-full border px-3 py-1 text-xs font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                        picked ? "border-indigo-400/50 bg-indigo-400/15 text-indigo-100" : "border-white/10 bg-white/[0.03] text-zinc-200 hover:border-indigo-400/40 hover:bg-indigo-400/10 hover:text-white",
                      )}
                    >
                      {topic}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <label htmlFor={ids.region} className="text-[13px] font-medium text-zinc-200">
              Country
            </label>
            <div className="relative mt-1.5">
              <select
                id={ids.region}
                value={region}
                onChange={(e) => setRegion(e.target.value)}
                className="h-10 w-full appearance-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 pr-9 text-sm text-zinc-100 focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
              >
                {REGIONS.map((r) => (
                  <option key={r.code} value={r.code} className="bg-zinc-900">
                    {r.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400" />
            </div>
          </div>

          {blockedReason ? (
            <p id={ids.note} role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-3 text-sm text-amber-100">
              {blockedReason}
            </p>
          ) : (
            <p id={ids.note} className="mt-4 text-[13px] text-zinc-400">
              Uses up to {runBudget} lookups. Usually takes 5–10 minutes; you can leave and come back.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3.5 py-3 text-sm text-rose-100">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {hasExample && (
              <button
                type="button"
                onClick={onExample}
                disabled={busy}
                className="h-10 rounded-xl px-3 text-sm font-medium text-zinc-200 transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 disabled:opacity-50 sm:mr-auto"
              >
                Open the example search
              </button>
            )}
            <button
              type="submit"
              disabled={!canStart}
              className="h-10 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(99,102,241,0.8)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-300 disabled:shadow-none"
            >
              {busy ? "Starting…" : "Start searching"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
