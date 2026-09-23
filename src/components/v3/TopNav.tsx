"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import type { SortKey } from "@/lib/v3/feed";
import { CloseIcon, MenuIcon, PlusIcon, RadarLogo, SearchIcon, TagIcon, TrendIcon, TrophyIcon } from "./icons";
import { cx, useDismiss } from "./parts";

interface SearchProps {
  value: string;
  onChange: (value: string) => void;
}

interface Props {
  /** the feed's search box and quick links; the run page leaves these out */
  search?: SearchProps;
  sort?: SortKey;
  onSort?: (sort: SortKey) => void;
  onCategories?: () => void;
  onNew: () => void;
  budget: { monthUsed: number; monthLimit: number } | null;
  apiNote: string | null;
  /** false while a dialog is open, so the search shortcut never pulls focus out of it */
  shortcutsEnabled?: boolean;
  /** extra controls on the right, before New research (the run page's Export) */
  actions?: ReactNode;
  /** a short trail after the logo, e.g. the run's status */
  crumb?: ReactNode;
}

const QUICK: { key: SortKey | "categories"; label: string; icon: typeof TrendIcon; hint: string }[] = [
  { key: "momentum", label: "Trending", icon: TrendIcon, hint: "Sort by momentum: the 12-month search-interest slope, plus a bump when the run found recent news" },
  { key: "categories", label: "Categories", icon: TagIcon, hint: "Filter by research question, gap status, confidence and region" },
  { key: "score", label: "Top rated", icon: TrophyIcon, hint: "Sort by opportunity score" },
];

function SearchField({ search, inputRef, shortcut, className }: { search: SearchProps; inputRef: RefObject<HTMLInputElement | null>; shortcut: string; className?: string }) {
  const id = useId();
  return (
    <div className={cx("group relative flex items-center", className)}>
      <label htmlFor={id} className="sr-only">
        Search opportunities
      </label>
      <SearchIcon size={16} className="pointer-events-none absolute left-3 text-zinc-400 transition-colors group-focus-within:text-indigo-300" />
      <input
        id={id}
        ref={inputRef}
        type="search"
        value={search.value}
        onChange={(e) => search.onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !e.nativeEvent.isComposing) {
            search.onChange("");
            e.currentTarget.blur();
          }
        }}
        aria-keyshortcuts={shortcut === "⌘K" ? "Meta+K" : "Control+K"}
        placeholder="Search opportunities, problems, questions…"
        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-16 text-sm text-zinc-100 placeholder:text-zinc-400 transition-all duration-200 hover:border-white/15 focus:border-indigo-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-4 focus:ring-indigo-500/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {search.value ? (
        <button
          type="button"
          onClick={() => search.onChange("")}
          aria-label="Clear search"
          className="absolute right-2 grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
        >
          <CloseIcon size={14} />
        </button>
      ) : (
        <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 hidden rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400 sm:inline-block">
          {shortcut}
        </kbd>
      )}
    </div>
  );
}

export default function TopNav({ search, sort, onSort, onCategories, onNew, budget, apiNote, shortcutsEnabled = true, actions, crumb }: Props) {
  const [menu, setMenu] = useState(false);
  const desktopRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const [mac, setMac] = useState(false);
  const enabled = useRef(shortcutsEnabled);
  useEffect(() => {
    enabled.current = shortcutsEnabled;
  }, [shortcutsEnabled]);
  const panelId = useId();
  const hasSearch = !!search;

  // ⌘K on a Mac, Ctrl+K elsewhere, or "/" when not typing: focus whichever search box is on screen
  useEffect(() => {
    if (!hasSearch) return;
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const t = window.setTimeout(() => setMac(isMac), 0);
    const onKey = (e: KeyboardEvent) => {
      if (!enabled.current || e.isComposing || document.querySelector('[aria-modal="true"]')) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const combo = e.key.toLowerCase() === "k" && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
      const slash = e.key === "/" && !typing;
      if (!combo && !slash) return;
      if (combo && target?.tagName === "TEXTAREA") return; // leave the text field's own shortcuts alone
      const input = [desktopRef.current, mobileRef.current].find((el) => el && el.offsetParent !== null);
      if (!input) return;
      e.preventDefault();
      input.focus();
      input.select();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [hasSearch]);

  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, closeMenu);
  const shortcut = mac ? "⌘K" : "Ctrl K";

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/55">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70" aria-label="LaunchRadar, all findings">
          <RadarLogo />
          <span className="text-[15px] font-semibold tracking-tight text-white">LaunchRadar</span>
        </Link>
        {crumb && <div className="ml-1 hidden min-w-0 items-center gap-2 text-sm text-zinc-400 sm:flex">{crumb}</div>}

        {search && onSort && onCategories && (
          <nav aria-label="Quick links" className="ml-4 hidden items-center gap-1 lg:flex">
            {QUICK.map(({ key, label, icon: Icon, hint }) => {
              const active = key === sort;
              return (
                <button
                  key={key}
                  type="button"
                  title={hint}
                  aria-pressed={key === "categories" ? undefined : active}
                  onClick={() => (key === "categories" ? onCategories() : onSort(key))}
                  className={cx(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-sm transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70",
                    active ? "bg-white/[0.08] text-white" : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100",
                  )}
                >
                  <Icon size={15} />
                  {label}
                </button>
              );
            })}
          </nav>
        )}

        {search && <SearchField search={search} inputRef={desktopRef} shortcut={shortcut} className="ml-auto hidden w-full max-w-sm md:flex" />}

        <div className={cx("ml-auto flex items-center gap-2", search && "md:ml-0")}>
          {actions}
          <button
            type="button"
            onClick={onNew}
            aria-haspopup="dialog"
            className="group relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-xl bg-indigo-500 px-3 text-sm font-semibold text-white shadow-[0_0_24px_-4px_rgba(99,102,241,0.75)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400 hover:shadow-[0_0_32px_-2px_rgba(129,140,248,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 sm:px-4"
          >
            <span aria-hidden="true" className="lr3-sheen pointer-events-none absolute inset-0" />
            <PlusIcon size={16} />
            <span className="hidden sm:inline">New research</span>
            <span className="sr-only sm:hidden">New research</span>
          </button>

          <div ref={menuRef} className="relative">
            <button
              type="button"
              aria-expanded={menu}
              aria-controls={panelId}
              aria-label="Search budget and status"
              onClick={() => setMenu((v) => !v)}
              className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-all duration-200 hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              <MenuIcon size={18} />
            </button>
            {menu && (
              <div id={panelId} className="lr3-appear absolute right-0 top-12 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                <div className="px-3 pb-2.5 pt-2">
                  {budget ? (
                    <>
                      <p className="flex justify-between gap-3 text-xs text-zinc-300">
                        <span>Searches counted by the server this month</span>
                        <span className="font-mono tabular-nums text-zinc-100">
                          {budget.monthUsed}/{budget.monthLimit}
                        </span>
                      </p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden="true">
                        <div
                          className="h-full rounded-full bg-linear-to-r from-indigo-400 to-emerald-400"
                          style={{ width: `${Math.min(100, (budget.monthUsed / Math.max(1, budget.monthLimit)) * 100)}%` }}
                        />
                      </div>
                      <p className="mt-2 text-[11px] leading-snug text-zinc-400">
                        The free server starts this count again whenever it restarts. SerpApi still enforces your plan&apos;s own monthly limit.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-zinc-400">Connecting to the research server…</p>
                  )}
                  {apiNote && <p className="mt-2 text-xs leading-snug text-zinc-200">{apiNote}</p>}
                </div>
                <div className="my-1 h-px bg-white/[0.06]" />
                <Link href="/" className="block rounded-lg px-3 py-2 text-sm text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/70" onClick={closeMenu}>
                  All findings
                  <span className="block text-xs text-zinc-400">Every opportunity from every finished run</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      {search && (
        <div className="border-t border-white/[0.04] px-4 pb-3 pt-2 md:hidden">
          <SearchField search={search} inputRef={mobileRef} shortcut={shortcut} />
        </div>
      )}
    </header>
  );
}
