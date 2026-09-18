import type { Engine, QuestionType } from "../config";
import { ROUTING } from "../config";

export function enginesFor(type: QuestionType): Engine[] {
  return ROUTING[type];
}

export function defaultEngines(): Engine[] {
  return ["google", "google_autocomplete", "google_news", "google_trends"];
}

export interface EngineBadge {
  label: string;
  sort: number;
}

export function engineLabel(engine: Engine): string {
  const m: Record<string, string> = {
    google: "Google Web",
    google_news: "News",
    google_autocomplete: "Autocomplete",
    google_trends: "Trends",
    google_maps: "Maps",
    google_maps_reviews: "Maps Reviews",
    google_play_product: "Play Store",
    apple_reviews: "App Store",
    google_shopping: "Shopping",
    google_jobs: "Jobs",
    youtube: "YouTube",
  };
  return m[engine] ?? engine;
}