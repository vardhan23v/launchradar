export const ALL_ENGINES = [
  "google",
  "google_news",
  "google_autocomplete",
  "google_trends",
  "google_maps",
  "google_maps_reviews",
  "google_play_product",
  "apple_reviews",
  "google_shopping",
  "google_jobs",
  "youtube",
] as const;

export type Engine = (typeof ALL_ENGINES)[number];

export type QuestionType =
  | "consumer_app"
  | "physical_product"
  | "local_service"
  | "b2b";

export interface RegionParams {
  gl: string;
  hl: string;
  google_domain: string;
  location?: string;
  geo?: string;
  ll?: string;
}

const REGION_DEFAULTS: Record<string, RegionParams> = {
  in: {
    gl: "in",
    hl: "en",
    google_domain: "google.co.in",
    location: "India",
    geo: "IN",
  },
  us: {
    gl: "us",
    hl: "en",
    google_domain: "google.com",
    location: "United States",
    geo: "US",
  },
  uk: {
    gl: "uk",
    hl: "en",
    google_domain: "google.co.uk",
    location: "United Kingdom",
    geo: "UK",
  },
};

export function regionParams(region: string): RegionParams {
  return REGION_DEFAULTS[region.toLowerCase()] ?? REGION_DEFAULTS.in;
}

export function regionName(region: string): string {
  return { in: "India", us: "United States", uk: "United Kingdom" }[
    region.toLowerCase()
  ] ?? region.toUpperCase();
}

function int(name: string, fallback: number): number {
  const v = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

export const CONFIG = {
  runSearchBudget: int("RUN_SEARCH_BUDGET", 25),
  monthlySearchBudget: int("MONTHLY_SEARCH_BUDGET", 250),
  hourlyRateGuard: int("HOURLY_SEARCH_GUARD", 40),

  discoveryShare: 12,
  competitorsShare: 6,
  gapVerifyShare: 5,
  trendsShare: 2,

  cacheTtlHours: int("CACHE_TTL_HOURS", 24),
  searchTimeoutMs: 20_000,
  retriesOn5xx: 1,

  demoDelayBaseMs: int("DEMO_DELAY_BASE_MS", 120),
  demoDelayMs: int("DEMO_DELAY_MS", 320),

  score: {
    pain: 30,
    momentum: 20,
    commercial: 20,
    whitespace: 20,
    weakRivals: 10,
    sourcesForHighConfidence: 3,
    distinctDomainsForHighConfidence: 4,
  },

  serpapiMode: (process.env.SERPAPI_MODE ?? "replay") as
    | "live"
    | "record"
    | "replay",
  effectiveMode(): "live" | "demo" {
    if (this.serpapiMode === "live" && this.hasSerpapiKey()) return "live";
    return "demo";
  },
  hasSerpapiKey(): boolean {
    return Boolean(process.env.SERPAPI_API_KEY);
  },
  get serpapiKey(): string {
    return process.env.SERPAPI_API_KEY ?? "";
  },
  get llmProvider(): string {
    return process.env.LLM_PROVIDER ?? "demo";
  },
  get llmApiKey(): string {
    return process.env.LLM_API_KEY ?? "";
  },
  get llmModel(): string {
    return process.env.LLM_MODEL ?? "gemini-2.0-flash";
  },
} as const;

export const ROUTING: Record<QuestionType, Engine[]> = {
  consumer_app: [
    "google",
    "google_autocomplete",
    "google_news",
    "google_trends",
    "google_play_product",
    "apple_reviews",
  ],
  physical_product: ["google", "google_shopping", "google_trends", "google_news"],
  local_service: ["google", "google_maps", "google_maps_reviews", "google_trends"],
  b2b: ["google", "google_news", "google_jobs", "google_trends"],
};