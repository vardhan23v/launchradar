/**
 * Runtime configuration. A Worker has no process.env: settings arrive on the `env` binding, so every
 * reader takes it as a parameter. Keys are secrets (never logged, never sent to the browser).
 */

export interface Settings {
  SERPAPI_MODE?: string;
  SERPAPI_API_KEY?: string;
  LLM_PROVIDER?: string;
  LLM_API_KEY?: string;
  GEMINI_API_KEY?: string;
  OPENAI_API_KEY?: string;
  LLM_MODEL?: string;
  LLM_BASE_URL?: string;
  LLM_JSON_MODE?: string;
  LLM_REASONING_EFFORT?: string;
  RUN_SEARCH_BUDGET?: string;
  MONTHLY_SEARCH_BUDGET?: string;
  HOURLY_SEARCH_GUARD?: string;
  CACHE_TTL_HOURS?: string;
  DEMO_DELAY_MS?: string;
  DEMO_DELAY_BASE_MS?: string;
}

export const ALL_ENGINES = [
  "google", "google_news", "google_autocomplete", "google_trends", "google_maps",
  "google_maps_reviews", "google_play_product", "apple_reviews", "google_shopping",
  "google_jobs", "youtube",
];

export interface Region {
  gl: string;
  hl: string;
  google_domain: string;
  location: string;
  geo: string;
}

export const REGIONS: Record<string, Region> = {
  in: { gl: "in", hl: "en", google_domain: "google.co.in", location: "India", geo: "IN" },
  us: { gl: "us", hl: "en", google_domain: "google.com", location: "United States", geo: "US" },
  // Google Trends uses ISO 3166 (GB), unlike gl=uk
  uk: { gl: "uk", hl: "en", google_domain: "google.co.uk", location: "United Kingdom", geo: "GB" },
};
export const REGION_NAMES: Record<string, string> = { in: "India", us: "United States", uk: "United Kingdom" };

// Question-type routing is code, not an LLM choice (ARCH §3)
export const ROUTING: Record<string, string[]> = {
  consumer_app: ["google", "google_autocomplete", "google_news", "google_trends", "google_play_product", "apple_reviews"],
  physical_product: ["google", "google_shopping", "google_trends", "google_news"],
  local_service: ["google", "google_maps", "google_maps_reviews", "google_trends"],
  b2b: ["google", "google_news", "google_jobs", "google_trends"],
};

// Per-run budget split (ARCH §4 / IMPL B2-B4). Autocomplete seeds come out of discovery.
export const DISCOVERY_SHARE = 12;
export const AUTOCOMPLETE_SEEDS = 2;
export const COMPETITORS_SHARE = 6;
export const GAP_VERIFY_SHARE = 5;
export const TRENDS_SHARE = 2;
export const MIN_DISCOVERY_EVIDENCE = 15;

export const SEARCH_TIMEOUT_MS = 20_000;
export const RETRIES_ON_5XX = 1;
export const LLM_TIMEOUT_MS = 90_000;

// Opportunity score weights (ARCH §5) — the single place they live
export const SCORE_WEIGHTS = { pain: 30, momentum: 20, commercial: 20, whitespace: 20, weakRivals: 10 } as const;

export function regionParams(region: string): Region {
  return REGIONS[region.toLowerCase()] ?? REGIONS.in;
}

export function regionName(region: string): string {
  return REGION_NAMES[region.toLowerCase()] ?? region.toUpperCase();
}

export function isRegion(region: unknown): region is string {
  return typeof region === "string" && region.toLowerCase() in REGIONS;
}

function int(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const runSearchBudget = (s: Settings) => int(s.RUN_SEARCH_BUDGET, 25);
export const monthlySearchBudget = (s: Settings) => int(s.MONTHLY_SEARCH_BUDGET, 250);
export const hourlyRateGuard = (s: Settings) => int(s.HOURLY_SEARCH_GUARD, 40);
export const cacheTtlHours = (s: Settings) => int(s.CACHE_TTL_HOURS, 24);
export const demoDelayMs = (s: Settings) => int(s.DEMO_DELAY_MS, 320);
export const demoDelayBaseMs = (s: Settings) => int(s.DEMO_DELAY_BASE_MS, 120);

/** "live" or "replay". A Worker has no disk to record fixtures into, so "record" means live. */
export function serpapiMode(s: Settings): "live" | "replay" {
  const value = (s.SERPAPI_MODE ?? "replay").toLowerCase();
  return value === "live" || value === "record" ? "live" : "replay";
}

export const serpapiKey = (s: Settings) => s.SERPAPI_API_KEY ?? "";
export const llmProvider = (s: Settings) => (s.LLM_PROVIDER ?? "demo").toLowerCase();

/** LLM_API_KEY wins; provider-specific names are accepted as fallbacks. */
export function llmApiKey(s: Settings): string {
  if (s.LLM_API_KEY) return s.LLM_API_KEY;
  if (llmProvider(s) === "gemini") return s.GEMINI_API_KEY ?? "";
  if (llmProvider(s) === "openai") return s.OPENAI_API_KEY ?? "";
  return "";
}

export function llmModel(s: Settings): string {
  if (s.LLM_MODEL) return s.LLM_MODEL;
  return llmProvider(s) === "openai" ? "gpt-4o-mini" : "gemini-2.0-flash";
}

/** Reasoning models (gpt-oss…) spend hidden tokens thinking; 'low' keeps free-tier token budgets usable. */
export function llmReasoningEffort(s: Settings): string {
  const value = (s.LLM_REASONING_EFFORT ?? "").toLowerCase();
  return value === "low" || value === "medium" || value === "high" ? value : "";
}

/** Some compatible gateways reject response_format; LLM_JSON_MODE=off drops it (output is still validated). */
export function llmJsonMode(s: Settings): boolean {
  return !["off", "0", "false", "no"].includes((s.LLM_JSON_MODE ?? "on").toLowerCase());
}

/** OpenAI-compatible gateways (Groq, OpenRouter, a local server…) set LLM_BASE_URL, e.g. https://host/v1. */
export function llmBaseUrl(s: Settings): string {
  return (s.LLM_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
}

const WHERE = "Locally these go in worker/.dev.vars; on Cloudflare, in the Worker's Settings → Variables and Secrets.";

/** Can a fresh (non-demo) question be researched with the current settings? */
export function pipelineReadiness(s: Settings): [boolean, string | null] {
  const mode = serpapiMode(s);
  if (mode !== "replay" && !serpapiKey(s)) return [false, `SERPAPI_MODE=${mode} needs SERPAPI_API_KEY. ${WHERE}`];
  const provider = llmProvider(s);
  if (provider === "demo") {
    return [false, "LLM_PROVIDER=demo can only replay recorded demo runs. Set SERPAPI_MODE=live, SERPAPI_API_KEY, "
      + "LLM_PROVIDER (gemini or openai) and LLM_API_KEY to research a new question. " + WHERE];
  }
  if (provider !== "gemini" && provider !== "openai") return [false, `Unsupported LLM_PROVIDER "${provider}". Use gemini or openai.`];
  if (!llmApiKey(s)) return [false, "LLM_API_KEY is missing. " + WHERE];
  if (provider === "openai" && s.LLM_BASE_URL && !s.LLM_MODEL) {
    return [false, "LLM_BASE_URL is set, so LLM_MODEL must name a model that gateway serves."];
  }
  return [true, null];
}
