"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import type { SortKey } from "@/lib/v3/feed";
import { CloseIcon, DownloadIcon, KeyboardIcon, MenuIcon, PlusIcon, RadarLogo, SearchIcon, StarIcon, TagIcon, TrendIcon, TrophyIcon } from "./icons";
import { cx, useDismiss, useModal } from "./parts";

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
  /** extra controls on the right, before "New search" (the run page's download button) */
  actions?: ReactNode;
  /** a short trail after the logo, e.g. the run's status */
  crumb?: ReactNode;
  /** the feed's "Saved only" filter: "Saved (n)" in the top bar and the menu turns it on; nothing shows while n is 0 */
  saved?: { count: number; active: boolean; onToggle: () => void };
  /** "Download ideas (CSV)" in the menu: the ideas shown right now; disabled while there are none */
  download?: { count: number; onClick: () => void };
}

const QUICK: { key: SortKey | "categories"; label: string; icon: typeof TrendIcon; hint: string }[] = [
  { key: "momentum", label: "Getting popular", icon: TrendIcon, hint: "Ideas whose problem more and more people search for first" },
  { key: "categories", label: "Filters", icon: TagIcon, hint: "Pick a topic, whether it's solved, how sure we are, or a country" },
  { key: "score", label: "Best score", icon: TrophyIcon, hint: "Ideas with the highest idea score first" },
];

/** The one-line reminder under the search box on wide screens. */
const HINT = "Press / to search, N for a new search, ? for all shortcuts";

/** What each key does, for the help dialog. */
function shortcutList(mac: boolean): { keys: string[]; what: string }[] {
  return [
    { keys: ["/", mac ? "⌘ K" : "Ctrl K"], what: "Go to the search box" },
    { keys: ["N"], what: "Start a new search" },
    { keys: ["Esc"], what: "Close a panel, menu or dialog" },
    { keys: ["?"], what: "Show these shortcuts" },
  ];
}

const MENU_ITEM = "block w-full rounded-lg px-3 py-2 text-left text-sm text-zinc-200 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-400/70";

function SearchField({ search, inputRef, shortcut, hint, className }: { search: SearchProps; inputRef: RefObject<HTMLInputElement | null>; shortcut: string; hint?: string; className?: string }) {
  const id = useId();
  return (
    <div className={cx("group relative flex items-center", className)}>
      <label htmlFor={id} className="sr-only">
        Search the ideas
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
        placeholder="Search ideas, problems, topics…"
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
        <kbd aria-hidden="true" className="pointer-events-none absolute right-2.5 hidden rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs font-medium text-zinc-400 sm:inline-block">
          {shortcut}
        </kbd>
      )}
      {hint && <p className="pointer-events-none absolute left-1 top-full mt-0.5 hidden whitespace-nowrap text-xs leading-none text-zinc-400 xl:block">{hint}</p>}
    </div>
  );
}

/** The keyboard shortcuts, as a small dialog: "?" or the menu opens it, Esc closes it. */
function ShortcutsDialog({ mac, onClose }: { mac: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useModal(ref, onClose, closeRef);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div aria-hidden="true" onClick={onClose} className="lr3-fade absolute inset-0 bg-black/65 backdrop-blur-sm" />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="lr3-rise relative w-full max-w-sm rounded-t-2xl border border-white/10 bg-zinc-900/95 p-5 shadow-2xl shadow-black/70 backdrop-blur-xl sm:rounded-2xl"
      >
        <div className="flex items-center justify-between gap-4">
          <h2 id={titleId} className="flex items-center gap-2 text-base font-semibold tracking-tight text-white">
            <KeyboardIcon size={18} className="text-indigo-300" />
            Keyboard shortcuts
          </h2>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-8 shrink-0 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70"
          >
            <CloseIcon size={16} />
          </button>
        </div>
        <dl className="mt-3 divide-y divide-white/[0.06]">
          {shortcutList(mac).map((s) => (
            <div key={s.what} className="flex items-center justify-between gap-4 py-2.5 text-sm">
              <dt className="text-zinc-200">{s.what}</dt>
              <dd className="flex shrink-0 items-center gap-1.5">
                {s.keys.map((k, i) => (
                  <Fragment key={k}>
                    {i > 0 && <span className="text-xs text-zinc-400">or</span>}
                    <kbd className="rounded-md border border-white/10 bg-white/[0.06] px-1.5 py-0.5 font-mono text-xs font-medium text-zinc-100">{k}</kbd>
                  </Fragment>
                ))}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-snug text-zinc-400">The letters only work while you&apos;re not typing in a box.</p>
      </div>
    </div>
  );
}

export default function TopNav({ search, sort, onSort, onCategories, onNew, budget, apiNote, shortcutsEnabled = true, actions, crumb, saved, download }: Props) {
  const [menu, setMenu] = useState(false);
  const [help, setHelp] = useState(false);
  const desktopRef = useRef<HTMLInputElement>(null);
  const mobileRef = useRef<HTMLInputElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [mac, setMac] = useState(false);
  const enabled = useRef(shortcutsEnabled);
  const startNew = useRef(onNew);
  useEffect(() => {
    enabled.current = shortcutsEnabled;
    startNew.current = onNew;
  }, [shortcutsEnabled, onNew]);
  const panelId = useId();

  // ⌘K on a Mac (Ctrl+K elsewhere) or "/" focuses whichever search box is on screen; "N" starts a
  // new search and "?" lists the shortcuts. The bare keys only count when not typing in a box, and
  // nothing fires while a dialog is open.
  useEffect(() => {
    const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    const t = window.setTimeout(() => setMac(isMac), 0);
    const onKey = (e: KeyboardEvent) => {
      if (!enabled.current || e.isComposing || e.repeat || document.querySelector('[aria-modal="true"]')) return;
      const target = e.target as HTMLElement | null;
      const typing = !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const plain = !typing && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (plain && e.key.toLowerCase() === "n") {
        e.preventDefault();
        startNew.current();
        return;
      }
      if (plain && e.key === "?") {
        e.preventDefault();
        setHelp(true);
        return;
      }
      const combo = e.key.toLowerCase() === "k" && (isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
      const slash = plain && e.key === "/";
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
  }, []);

  const closeMenu = useCallback(() => setMenu(false), []);
  const closeHelp = useCallback(() => setHelp(false), []);
  const menuRef = useDismiss(menu, closeMenu);
  const shortcut = mac ? "⌘K" : "Ctrl K";
  const showSaved = !!saved && saved.count > 0;

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-zinc-950/70 backdrop-blur-xl supports-[backdrop-filter]:bg-zinc-950/55">
      <div className={cx("mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6", search && "xl:h-[4.5rem]")}>
        <Link href="/" className="flex shrink-0 items-center gap-2.5 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70" aria-label="LaunchRadar, all ideas">
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

        {search && <SearchField search={search} inputRef={desktopRef} shortcut={shortcut} hint={HINT} className="ml-auto hidden w-full max-w-sm md:flex" />}

        <div className={cx("ml-auto flex items-center gap-2", search && "md:ml-0")}>
          {showSaved && (
            <button
              type="button"
              aria-pressed={saved.active}
              onClick={saved.onToggle}
              title={saved.active ? "Showing only the ideas you saved. Click to show all." : "Show only the ideas you saved"}
              className={cx(
                "hidden h-10 shrink-0 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400/70 sm:inline-flex",
                saved.active ? "border-amber-300/40 bg-amber-300/10 text-amber-100" : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-white/20 hover:text-white",
              )}
            >
              <StarIcon size={15} filled={saved.active} className={saved.active ? "text-amber-300" : "text-zinc-400"} />
              Saved ({saved.count})
            </button>
          )}
          {actions}
          <button
            type="button"
            onClick={onNew}
            aria-haspopup="dialog"
            aria-keyshortcuts="n"
            className="group relative inline-flex h-10 items-center gap-2 overflow-hidden rounded-xl bg-indigo-500 px-3 text-sm font-semibold text-white shadow-[0_0_24px_-4px_rgba(99,102,241,0.75)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400 hover:shadow-[0_0_32px_-2px_rgba(129,140,248,0.9)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 sm:px-4"
          >
            <span aria-hidden="true" className="lr3-sheen pointer-events-none absolute inset-0" />
            <PlusIcon size={16} />
            <span className="hidden sm:inline">New search</span>
            <span className="sr-only sm:hidden">New search</span>
          </button>

          <div ref={menuRef} className="relative">
            <button
              ref={menuButtonRef}
              type="button"
              aria-expanded={menu}
              aria-controls={panelId}
              aria-label={`More: lookups left${showSaved ? ", saved ideas" : ""}${download ? ", download" : ""}, shortcuts`}
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
                        <span>Lookups this month</span>
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
                      <p className="mt-2 text-[13px] leading-snug text-zinc-400">
                        Every search uses some lookups. The free server starts this count again whenever it restarts; the web lookup service also has its own monthly limit.
                      </p>
                    </>
                  ) : (
                    <p className="text-[13px] text-zinc-400">Connecting to the server…</p>
                  )}
                  {apiNote && <p className="mt-2 text-[13px] leading-snug text-zinc-200">{apiNote}</p>}
                </div>
                <div className="my-1 h-px bg-white/[0.06]" />
                <Link href="/" className={MENU_ITEM} onClick={closeMenu}>
                  All ideas
                  <span className="block text-[13px] text-zinc-400">Every idea from every finished search</span>
                </Link>
                {showSaved && (
                  <button
                    type="button"
                    aria-pressed={saved.active}
                    onClick={() => {
                      closeMenu();
                      saved.onToggle();
                    }}
                    className={MENU_ITEM}
                  >
                    <span className="flex items-center gap-2">
                      <StarIcon size={14} filled={saved.active} className={saved.active ? "text-amber-300" : "text-zinc-400"} />
                      Saved ({saved.count})
                    </span>
                    <span className="block text-[13px] text-zinc-400">{saved.active ? "Showing only the ideas you saved. Click to show all." : "Show only the ideas you saved"}</span>
                  </button>
                )}
                {download && (
                  <button
                    type="button"
                    disabled={download.count === 0}
                    onClick={() => {
                      closeMenu();
                      download.onClick();
                    }}
                    className={cx(MENU_ITEM, "disabled:cursor-default disabled:opacity-50")}
                  >
                    <span className="flex items-center gap-2">
                      <DownloadIcon size={14} className="text-zinc-400" />
                      Download ideas (CSV)
                    </span>
                    <span className="block text-[13px] text-zinc-400">
                      {download.count === 0 ? "Nothing to download yet" : `The ${download.count} ${download.count === 1 ? "idea" : "ideas"} shown now, as a spreadsheet`}
                    </span>
                  </button>
                )}
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={() => {
                    menuButtonRef.current?.focus(); // so the dialog can hand focus back to something that stays on the page
                    closeMenu();
                    setHelp(true);
                  }}
                  className={MENU_ITEM}
                >
                  <span className="flex items-center gap-2">
                    <KeyboardIcon size={14} className="text-zinc-400" />
                    Keyboard shortcuts
                  </span>
                  <span className="block text-[13px] text-zinc-400">Press ? anywhere to see them</span>
                </button>
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

      {help && <ShortcutsDialog mac={mac} onClose={closeHelp} />}
    </header>
  );
}
