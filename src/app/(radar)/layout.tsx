import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./radar.css";

/**
 * Layout for the home page (the radar dashboard): dark, Geist, Tailwind utilities with a few scoped
 * keyframes. The report view (/report, /runs/[id]) and the triage board (/v2) keep their own styles.
 */
const geist = Geist({ variable: "--font-v3", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LaunchRadar",
  description: "Every opportunity LaunchRadar has found, ranked and filterable, with each case linked to the search results it cites.",
};

export default function V3Layout({ children }: { children: React.ReactNode }) {
  return <div className={`${geist.variable} lr3-root`}>{children}</div>;
}
