import type { Engine } from "../config";
import { regionParams, type RegionParams } from "../config";

export interface TypedParams {
  google: {
    q: string;
    gl?: string;
    hl?: string;
    google_domain?: string;
    location?: string;
    tbs?: string;
    start?: number;
    num?: number;
  };
  google_news: { q: string; gl?: string; hl?: string; google_domain?: string };
  google_autocomplete: { q: string; gl?: string; hl?: string };
  google_trends: {
    q: string;
    data_type?: "TIMESERIES" | "RELATED_QUERIES";
    geo?: string;
    date?: string;
    hl?: string;
  };
  google_maps: {
    q: string;
    type?: "search";
    ll?: string;
    gl?: string;
    hl?: string;
  };
  google_maps_reviews: { data_id: string; sort_by?: "lowestRating" };
  google_play_product: {
    product_id: string;
    store?: "apps";
    all_reviews?: boolean;
    hl?: string;
    gl?: string;
  };
  apple_reviews: { product_id: string; sort?: string; hl?: string };
  google_shopping: { q: string; gl?: string; hl?: string; location?: string };
  google_jobs: { q: string; gl?: string; hl?: string; location?: string };
  youtube: { search_query: string; gl?: string; hl?: string };
}

export type ParamsFor<E extends Engine> = TypedParams[E];



export type RawParams = Record<string, string | number | boolean | undefined>;

/** Turn typed engine params into a flat query object, seeded with region defaults. */
export function toRawParams<E extends Engine>(
  engine: E,
  params: ParamsFor<E>,
  region: string,
): RawParams {
  const r = regionParams(region);
  const p = (params as Record<string, string | number | boolean | undefined>);

  if (engine === "google_autocomplete") {
    return { ...p, gl: p.gl ?? r.gl, hl: p.hl ?? r.hl };
  }
  if (engine === "google_trends") {
    return { ...p, geo: p.geo ?? r.geo, hl: p.hl ?? r.hl, date: p.date ?? "today 12-m" };
  }
  if (
    engine === "google" ||
    engine === "google_news" ||
    engine === "google_shopping" ||
    engine === "google_jobs" ||
    engine === "youtube"
  ) {
    return {
      ...p,
      gl: p.gl ?? r.gl,
      hl: p.hl ?? r.hl,
      google_domain: p.google_domain ?? r.google_domain,
      location: p.location ?? r.location,
    };
  }
  if (engine === "google_maps") {
    return { ...p, gl: p.gl ?? r.gl, hl: p.hl ?? r.hl };
  }
  if (engine === "google_play_product" || engine === "apple_reviews") {
    return { ...p, hl: p.hl ?? r.hl, gl: p.gl ?? r.gl };
  }
  if (engine === "google_maps_reviews") {
    return { ...p };
  }
  return { ...p };
}

export function hashParams(engine: Engine, params: RawParams): string {
  const keys = Object.keys(params).filter((k) => {
    const v = params[k];
    return k !== "api_key" && v !== undefined && String(v).length > 0;
  });
  const sorted = keys
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  let h = 0x811c9dc5;
  const s = `${engine}?${sorted}`;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Redact secrets from anything that will be persisted or logged. */
export function redact(params: RawParams): RawParams {
  const out: RawParams = {};
  for (const [k, v] of Object.entries(params)) {
    if (k === "api_key") continue;
    out[k] = v;
  }
  return out;
}

export type { RegionParams };