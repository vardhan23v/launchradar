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
  CONCURRENT_RUN_LIMIT?: string;
  DEMO_RUNS_PER_HOUR?: string;
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

// own keys only: "constructor" or "__proto__" must never pass as a region
const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

export function regionParams(region: string): Region {
  const k = region.toLowerCase();
  return has(REGIONS, k) ? REGIONS[k] : REGIONS.in;
}

export function regionName(region: string): string {
  const k = region.toLowerCase();
  return has(REGION_NAMES, k) ? REGION_NAMES[k] : region.toUpperCase();
}

export function isRegion(region: unknown): region is string {
  return typeof region === "string" && has(REGIONS, region.toLowerCase());
}

function int(value: string | undefined, fallback: number, min = 1): number {
  if (value === undefined || value.trim() === "") return fallback;
  const n = Number(value.trim());
  return Number.isSafeInteger(n) && n >= min ? n : fallback;
}

export const runSearchBudget = (s: Settings) => int(s.RUN_SEARCH_BUDGET, 25);
// 0 is a real setting for the spend guards: it stops all billed searches
export const monthlySearchBudget = (s: Settings) => int(s.MONTHLY_SEARCH_BUDGET, 250, 0);
export const hourlyRateGuard = (s: Settings) => int(s.HOURLY_SEARCH_GUARD, 40, 0);
/** How many live research runs may be in progress at once, across all visitors. */
export const concurrentRunLimit = (s: Settings) => int(s.CONCURRENT_RUN_LIMIT, 1);
/** How many fresh copies of the recorded example may be written per hour; beyond that the newest is reused. */
export const demoRunsPerHour = (s: Settings) => int(s.DEMO_RUNS_PER_HOUR, 6);
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

/**
 * LLM_API_KEY wins; provider-specific names are accepted as fallbacks. OPENAI_API_KEY is used only
 * against OpenAI itself, so a real OpenAI key is never sent as a bearer to another gateway.
 */
export function llmApiKey(s: Settings): string {
  if (s.LLM_API_KEY) return s.LLM_API_KEY;
  if (llmProvider(s) === "gemini") return s.GEMINI_API_KEY ?? "";
  if (llmProvider(s) === "openai" && llmBaseUrl(s) === "https://api.openai.com/v1") return s.OPENAI_API_KEY ?? "";
  return "";
}

/** Every key this Worker holds, for scrubbing text that came back from an upstream. */
export function secretValues(s: Settings): string[] {
  return [s.SERPAPI_API_KEY, s.LLM_API_KEY, s.GEMINI_API_KEY, s.OPENAI_API_KEY].filter((v): v is string => typeof v === "string" && v.length >= 6);
}

/** Removes every key and anything that looks like a credential from text before it is stored or logged. */
export function scrubSecrets(text: string, s: Settings): string {
  let out = text;
  for (const v of secretValues(s)) out = out.split(v).join("[redacted]");
  return out
    .replace(/api_key=[^&\s"]+/gi, "api_key=[redacted]")
    .replace(/bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/\b(sk|gsk|AIza)[A-Za-z0-9_-]{12,}/g, "[redacted]");
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

/** The bearer key may only travel over https (plain http is allowed for a model on this machine). */
function llmBaseUrlIsSafe(s: Settings): boolean {
  try {
    const u = new URL(llmBaseUrl(s));
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]");
  } catch {
    return false;
  }
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
  // fixed sentences only: these answers go to anonymous visitors, so no setting value is echoed
  if (provider !== "gemini" && provider !== "openai") return [false, "LLM_PROVIDER is not supported. Use gemini or openai."];
  if (!llmApiKey(s)) return [false, "LLM_API_KEY is missing. " + WHERE];
  if (provider === "openai" && s.LLM_BASE_URL && !s.LLM_MODEL) {
    return [false, "LLM_BASE_URL is set, so LLM_MODEL must name a model that gateway serves."];
  }
  if (provider === "openai" && !llmBaseUrlIsSafe(s)) return [false, "LLM_BASE_URL must be an https:// address."];
  return [true, null];
}
