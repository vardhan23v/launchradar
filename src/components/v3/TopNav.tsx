"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { SortKey } from "@/lib/v3/feed";
import { CloseIcon, MenuIcon, PlusIcon, RadarLogo, SearchIcon, TagIcon, TrendIcon, TrophyIcon } from "./icons";
import { cx, useDismiss } from "./parts";

interface Props {
  search: string;
  onSearch: (value: string) => void;
  sort: SortKey;
  onSort: (sort: SortKey) => void;
  onCategories: () => void;
  onNew: () => void;
  budget: { monthUsed: number; monthLimit: number } | null;
  apiNote: string | null;
}

const QUICK: { key: SortKey | "categories"; label: string; icon: typeof TrendIcon; hint: string }[] = [
  { key: "momentum", label: "Trending", icon: TrendIcon, hint: "Sort by momentum: how fast searches for the problem are rising" },
  { key: "categories", label: "Categories", icon: TagIcon, hint: "Filter by research question, region and gap" },
  { key: "score", label: "Top rated", icon: TrophyIcon, hint: "Sort by opportunity score" },
];

interface FieldProps {
  search: string;
  onSearch: (value: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
  shortcut: string;
  className?: string;
}

function SearchField({ search, onSearch, inputRef, shortcut, className }: FieldProps) {
  return (
    <label className={cx("group relative flex items-center", className)}>
      <span className="sr-only">Search opportunities</span>
      <SearchIcon size={16} className="pointer-events-none absolute left-3 text-zinc-500 transition-colors group-focus-within:text-indigo-300" />
      <input
        ref={inputRef}
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            onSearch("");
            e.currentTarget.blur();
          }
        }}
        placeholder="Search opportunities, problems, questions…"
        className="h-10 w-full rounded-xl border border-white/10 bg-white/[0.04] pl-9 pr-16 text-sm text-zinc-100 placeholder:text-zinc-500 transition-all duration-200 hover:border-white/15 focus:border-indigo-400/60 focus:bg-white/[0.06] focus:outline-none focus:ring-4 focus:ring-indigo-500/15 [&::-webkit-search-cancel-button]:hidden"
      />
      {search ? (
        <button
          type="button"
          onClick={() => onSearch("")}
          aria-label="Clear search"
          className="absolute right-2 grid size-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white"
        >
          <CloseIcon size={14} />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 hidden rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] font-medium text-zinc-400 sm:inline-block">
          {shortcut}
        </kbd>
      )}
    </label>
  );
}

export default function TopNav(props: Props) {
  const { search, onSearch, sort, onSort, onCategories, onNew, budget, apiNote } = props;
  const [menu, setMenu] = useState(false);
  const desktopRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const [shortcut, setShortcut] = useState("Ctrl K");

  // ⌘K / Ctrl+K, or "/" when not typing, focuses whichever search box is on screen
  useEffect(() => {
    const t = window.setTimeout(() => {
      if (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) setShortcut("⌘K");
    }, 0);
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
      if (!combo && !(e.key === "/" && !typing)) return;
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
  }, []);
  const closeMenu = useCallback(() => setMenu(false), []);
  const menuRef = useDismiss(menu, closeMenu);

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/55">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <Link href="/v3" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70" aria-label="LaunchRadar home">
          <RadarLogo />
          <span className="text-[15px] font-semibold tracking-tight text-white">LaunchRadar</span>
        </Link>

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

        <SearchField search={search} onSearch={onSearch} inputRef={desktopRef} shortcut={shortcut} className="ml-auto hidden w-full max-w-sm md:flex" />

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <button
            type="button"
            onClick={onNew}
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
              aria-haspopup="menu"
              aria-expanded={menu}
              aria-label="More"
              onClick={() => setMenu((v) => !v)}
              className="grid size-10 place-items-center rounded-xl border border-white/10 bg-white/[0.04] text-zinc-300 transition-all duration-200 hover:border-white/20 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
            >
              <MenuIcon size={18} />
            </button>
            {menu && (
              <div role="menu" className="lr3-appear absolute right-0 top-12 w-64 overflow-hidden rounded-xl border border-white/10 bg-zinc-900/95 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-xl">
                {budget && (
                  <div className="px-3 pb-2.5 pt-2">
                    <p className="flex justify-between text-xs text-zinc-400">
                      <span>Searches this month</span>
                      <span className="font-mono tabular-nums text-zinc-200">
                        {budget.monthUsed}/{budget.monthLimit}
                      </span>
                    </p>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
                      <div
                        className="h-full rounded-full bg-linear-to-r from-indigo-400 to-emerald-400"
                        style={{ width: `${Math.min(100, (budget.monthUsed / Math.max(1, budget.monthLimit)) * 100)}%` }}
                      />
                    </div>
                    {apiNote && <p className="mt-2 text-[11px] leading-snug text-zinc-500">{apiNote}</p>}
                  </div>
                )}
                <div className="my-1 h-px bg-white/[0.06]" />
                <p className="px-3 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-500">Other views</p>
                <Link role="menuitem" href="/" className="block rounded-lg px-3 py-2 text-sm text-zinc-200 hover:bg-white/[0.06]" onClick={closeMenu}>
                  Report view
                  <span className="block text-xs text-zinc-500">Each run as a cited report</span>
                </Link>
                <Link role="menuitem" href="/v2" className="block rounded-lg px-3 py-2 text-sm text-zinc-200 hover:bg-white/[0.06]" onClick={closeMenu}>
                  Triage board
                  <span className="block text-xs text-zinc-500">Shortlist and dismiss, run by run</span>
                </Link>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="border-t border-white/[0.04] px-4 pb-3 pt-2 md:hidden">
        <SearchField search={search} onSearch={onSearch} inputRef={mobileRef} shortcut={shortcut} />
      </div>
    </header>
  );
}
