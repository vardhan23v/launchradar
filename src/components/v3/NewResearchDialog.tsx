"use client";

import { useEffect, useRef, useState } from "react";

import { REGIONS } from "@/lib/v3/feed";
import { ChevronDownIcon, CloseIcon, RadarLogo } from "./icons";

const MAX = 300; // the API refuses longer questions

export default function NewResearchDialog({
  onClose,
  onStart,
  onExample,
  busy,
  error,
  blockedReason,
  runBudget,
  budget,
  hasExample,
}: {
  onClose: () => void;
  onStart: (question: string, region: string) => void;
  onExample: () => void;
  busy: boolean;
  error: string | null;
  /** Why a new question cannot be researched right now (missing keys, quota), or null. */
  blockedReason: string | null;
  runBudget: number;
  budget: { monthUsed: number; monthLimit: number } | null;
  hasExample: boolean;
}) {
  const [question, setQuestion] = useState("");
  const [region, setRegion] = useState("in");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const f = dialogRef.current.querySelectorAll<HTMLElement>("button:not([disabled]), textarea, select, a[href]");
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) {
        e.preventDefault();
        f[f.length - 1].focus();
      } else if (!e.shiftKey && document.activeElement === f[f.length - 1]) {
        e.preventDefault();
        f[0].focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [onClose]);

  const trimmed = question.trim();
  const canStart = !busy && !blockedReason && trimmed.length > 0 && trimmed.length <= MAX;

  return (
    <div className="fixed inset-0 z-50 grid place-items-end p-0 sm:place-items-center sm:p-6">
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="lr3-new-title"
        className="lr3-rise relative w-full max-w-lg overflow-hidden rounded-t-2xl border border-white/10 bg-zinc-900/95 shadow-2xl shadow-black/70 backdrop-blur-xl sm:rounded-2xl"
      >
        <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.25),transparent_70%)]" />
        <form
          className="relative p-5 sm:p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (canStart) onStart(trimmed, region);
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <RadarLogo size={32} />
              <div>
                <h2 id="lr3-new-title" className="text-lg font-semibold tracking-tight text-white">
                  New research
                </h2>
                <p className="text-sm text-zinc-400">Name a market. LaunchRadar searches it and brings back gaps with sources.</p>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white">
              <CloseIcon size={16} />
            </button>
          </div>

          <label className="mt-5 block">
            <span className="text-xs font-medium text-zinc-300">Market or question</span>
            <textarea
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canStart) onStart(trimmed, region);
                }
              }}
              rows={3}
              maxLength={MAX}
              placeholder="e.g. Meal planning for shift workers"
              className="mt-1.5 w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3.5 py-3 text-[15px] text-zinc-100 placeholder:text-zinc-500 transition-all duration-200 focus:border-indigo-400/60 focus:outline-none focus:ring-4 focus:ring-indigo-500/15"
            />
            <span className="mt-1 block text-right font-mono text-[11px] tabular-nums text-zinc-500">
              {question.length}/{MAX}
            </span>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-zinc-300">Region</span>
            <span className="relative mt-1.5 block">
              <select
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
            </span>
          </label>

          {blockedReason ? (
            <p role="status" className="mt-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] px-3.5 py-3 text-sm text-amber-100">
              {blockedReason}
            </p>
          ) : (
            <p className="mt-4 text-xs text-zinc-500">
              Uses up to {runBudget} searches
              {budget ? ` · ${budget.monthUsed} of ${budget.monthLimit} used this month` : ""}. A run takes a few minutes; you can leave the page and come back.
            </p>
          )}
          {error && (
            <p role="alert" className="mt-3 rounded-xl border border-rose-400/25 bg-rose-400/[0.07] px-3.5 py-3 text-sm text-rose-100">
              {error}
            </p>
          )}

          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
            {hasExample && (
              <button type="button" onClick={onExample} disabled={busy} className="h-10 rounded-xl px-3 text-sm font-medium text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white disabled:opacity-50 sm:mr-auto">
                Open the recorded example
              </button>
            )}
            <button
              type="submit"
              disabled={!canStart}
              className="h-10 rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(99,102,241,0.8)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400 disabled:cursor-not-allowed disabled:bg-zinc-700 disabled:text-zinc-400 disabled:shadow-none"
            >
              {busy ? "Starting…" : "Start research"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
