import { regionParams } from "./config";
import type { Params } from "./types";

const FULL_REGION = new Set(["google", "google_news", "google_shopping", "google_jobs"]);
const GL_HL = new Set(["google_autocomplete", "google_maps", "google_play_product", "apple_reviews", "youtube"]);

/** Flat query params seeded with region defaults; explicit params always win. */
export function toRawParams(engine: string, params: Params, region: string): Params {
  const r = regionParams(region);
  const p: Params = { ...params };
  let defaults: Params;
  if (engine === "google_trends") defaults = { geo: r.geo, hl: r.hl, date: "today 12-m" };
  else if (FULL_REGION.has(engine)) defaults = { gl: r.gl, hl: r.hl, google_domain: r.google_domain, location: r.location };
  else if (GL_HL.has(engine)) defaults = { gl: r.gl, hl: r.hl };
  else defaults = {};
  for (const [k, v] of Object.entries(defaults)) {
    if (p[k] === undefined || p[k] === null) p[k] = v;
  }
  return p;
}

/** Python's str() for the values that reach a query string: booleans lower-case, numbers plain. */
export function fmt(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(v);
  return String(v);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** sha256(engine + sorted params) per ARCH §3. The api key and internal keys never influence it. */
export async function hashParams(engine: string, params: Params): Promise<string> {
  const keys = Object.keys(params)
    .filter((k) => k !== "api_key" && !k.startsWith("__") && params[k] !== null && params[k] !== undefined && fmt(params[k]) !== "")
    .sort();
  const joined = keys.map((k) => `${k}=${fmt(params[k])}`).join("&");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${engine}?${joined}`));
  return hex(digest).slice(0, 16);
}

export function redact(params: Params): Params {
  const out: Params = {};
  for (const [k, v] of Object.entries(params)) if (k !== "api_key") out[k] = v;
  return out;
}
