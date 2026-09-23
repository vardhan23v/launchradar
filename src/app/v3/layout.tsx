import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./v3.css";

/**
 * Layout for the /v3 dashboard: dark, Geist, Tailwind utilities with a few scoped keyframes.
 * The report view (/) and the triage board (/v2) keep their own styles untouched.
 */
const geist = Geist({ variable: "--font-v3", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LaunchRadar — On the radar",
  description: "Every opportunity LaunchRadar has found, ranked and filterable, each claim quoted from a search result.",
};

export default function V3Layout({ children }: { children: React.ReactNode }) {
  return <div className={`${geist.variable} lr3-root`}>{children}</div>;
}
