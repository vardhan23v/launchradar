import type { Metadata } from "next";
import { Geist } from "next/font/google";
import Link from "next/link";

import { RadarLogo } from "@/components/v3/icons";
import "./(radar)/radar.css";

/* This page lives outside the (radar) route group, so it brings the dashboard's font and styles itself. */
const geist = Geist({ variable: "--font-v3", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Page not found",
};

/** The page for an address that goes nowhere: dark like the rest, one plain sentence, one way back. */
export default function NotFound() {
  return (
    <div className={`${geist.variable} lr3-root relative flex min-h-screen flex-1 flex-col overflow-x-clip bg-zinc-950 text-zinc-100 antialiased`}>
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)]" />
      <div aria-hidden="true" className="lr3-grid pointer-events-none absolute inset-x-0 top-0 h-[420px]" />
      <main className="relative mx-auto flex w-full max-w-md flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <RadarLogo size={56} />
        <p className="mt-6 font-mono text-xs font-medium tracking-wider text-zinc-400">Error 404</p>
        <h1 className="mt-2 text-balance text-2xl font-semibold tracking-tight text-white sm:text-3xl">This page doesn&apos;t exist</h1>
        <p className="mt-3 text-pretty text-[15px] leading-relaxed text-zinc-300">The link may be wrong, or the search it pointed to is gone.</p>
        <Link
          href="/"
          className="mt-6 inline-flex h-10 items-center rounded-xl bg-indigo-500 px-4 text-sm font-semibold text-white shadow-[0_0_24px_-6px_rgba(99,102,241,0.8)] ring-1 ring-inset ring-white/20 transition-all duration-200 hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200"
        >
          Go to all ideas
        </Link>
      </main>
    </div>
  );
}
