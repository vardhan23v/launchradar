import type { Metadata } from "next";
import { Geist } from "next/font/google";

import { SkipLink } from "@/components/v3/parts";
import "./radar.css";

/**
 * Layout for the radar dashboard (home page) and the run pages: dark, Geist, Tailwind utilities
 * with a few scoped keyframes.
 */
const geist = Geist({ variable: "--font-v3", subsets: ["latin"] });

const DESCRIPTION = "Product ideas from what people complain about on the web, each with the web pages it came from so you can check for yourself.";

export const metadata: Metadata = {
  description: DESCRIPTION,
  openGraph: { title: "LaunchRadar", description: DESCRIPTION, url: "/" },
  twitter: { title: "LaunchRadar", description: DESCRIPTION },
};

export default function RadarLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${geist.variable} lr3-root`}>
      <SkipLink />
      {children}
    </div>
  );
}
