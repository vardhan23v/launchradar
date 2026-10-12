import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./radar.css";

/**
 * Layout for the radar dashboard (home page) and the run pages: dark, Geist, Tailwind utilities
 * with a few scoped keyframes.
 */
const geist = Geist({ variable: "--font-v3", subsets: ["latin"] });

const DESCRIPTION = "Every opportunity LaunchRadar has found, ranked and filterable, with each case linked to the search results it cites.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  openGraph: { title: "LaunchRadar", description: DESCRIPTION, url: "/" },
  twitter: { title: "LaunchRadar", description: DESCRIPTION },
};

export default function RadarLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${geist.variable} lr3-root`}>{children}</div>;
}
