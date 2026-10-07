/** Raw SerpApi JSON → evidence rows. Every block is optional; unknown shapes yield no rows, never an error. */
import type { Evidence, Row } from "./types";

export const MAX_NEWS_ROWS = 15;

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x)) : []);

/** First non-empty value; dotted keys walk nested objects ('user.name'). */
function str(o: unknown, ...keys: string[]): string {
  for (const k of keys) {
    let v: unknown = o;
    for (const part of k.split(".")) v = obj(v)[part];
    if (typeof v === "string" && v) return v;
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function num(o: unknown, key: string): number {
  const v = obj(o)[key];
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function domain(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

/** Python's "%g": up to six significant digits, no trailing zeros. */
function g(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
}

/** Only absolute http(s) links are kept: a result's link becomes a clickable href in the browser. */
function safeLink(url: string): string {
  return /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 2000) : "";
}

const clip = (v: string, n: number) => (v.length > n ? v.slice(0, n) : v);

function row(block: string, title: string, url: string, dom: string, snippet: string, position: number,
  date?: string, text?: string, meta?: Record<string, unknown>): Row {
  const r: Row = { blockType: block, title: clip(title, 500), url: safeLink(url), domain: clip(dom, 253), snippet: clip(snippet, 2000), position, meta: meta ?? {} };
  if (date) r.date = clip(date, 64);
  if (text) r.text = clip(text, 2000);
  return r;
}

const join = (bits: string[]) => bits.filter(Boolean).join(" · ");

export function normalise(engine: string, raw: unknown): Row[] {
  const out: Row[] = [];
  const r = obj(raw);
  if (engine === "google") {
    arr(r.organic_results).forEach((o, i) => {
      const url = str(o, "link");
      const pos = Number.isInteger(o.position) ? (o.position as number) : i + 1;
      out.push(row("organic", str(o, "title"), url, domain(url), str(o, "snippet") || str(o, "title"), pos, str(o, "date")));
    });
    arr(r.related_questions).forEach((o, i) => {
      const url = str(o, "link"), q = str(o, "question"), snip = str(o, "snippet");
      out.push(row("related_question", q, url, domain(url), q && snip ? `${q} — ${snip}` : q || snip, i + 1));
    });
    arr(r.discussions_and_forums).forEach((o, i) => {
      const url = str(o, "link");
      // the answers carry the actual user voice
      const answers = arr(o.answers).slice(0, 3).map((x) => str(x, "snippet")).filter(Boolean).join(" | ");
      out.push(row("forum", str(o, "title"), url, domain(url), answers || str(o, "title"), i + 1, str(o, "date")));
    });
    arr(r.related_searches).forEach((o, i) => {
      const q = str(o, "query");
      out.push(row("related_search", q, "", "", q, i + 1));
    });
    arr(r.ads).forEach((o, i) => {
      const url = str(o, "link", "displayed_link");
      out.push(row("ad", str(o, "title"), url, domain(url), str(o, "snippet"), i + 1));
    });
  } else if (engine === "google_news") {
    // a result is either one article or a cluster carrying `stories`
    const items: Obj[] = [];
    for (const o of arr(r.news_results)) {
      const stories = arr(o.stories);
      items.push(...(stories.length ? stories : [o]));
    }
    // Google News returns 80+ headlines per call; the top ones carry the signal and the
    // rest would drown user-voice rows (forums, People Also Ask) in the extractor
    items.slice(0, MAX_NEWS_ROWS).forEach((o, i) => {
      const url = str(o, "link"), title = str(o, "title");
      out.push(row("news", title, url, domain(url), str(o, "snippet") || title, i + 1, str(o, "iso_date", "date"), undefined,
        { source: str(o, "source.name") }));
    });
  } else if (engine === "google_autocomplete") {
    const suggestions = Array.isArray(r.suggestions) ? r.suggestions : [];
    suggestions.forEach((v, i) => {
      const text = typeof v === "string" ? v : str(v, "value");
      if (text) out.push(row("suggestion", text, "", "", text, i + 1));
    });
  } else if (engine === "google_trends") {
    // TIMESERIES: timeline_data[] = {date, timestamp, values[{query, extracted_value}]}
    arr(obj(r.interest_over_time).timeline_data).forEach((point, i) => {
      const label = str(point, "date");
      const values: Record<string, number> = {};
      for (const v of arr(point.values)) if (str(v, "query")) values[str(v, "query").toLowerCase()] = num(v, "extracted_value");
      let date: string | undefined;
      const ts = Number.parseInt(str(point, "timestamp"), 10);
      if (Number.isFinite(ts)) date = `${new Date(ts * 1000).toISOString().slice(0, 19)}+00:00`;
      const summary = Object.entries(values).map(([k, v]) => `${k}: ${g(v)}`).join(", ");
      out.push(row("trend_point", `Search interest ${label}`, "", "trends.google.com", `${label} — ${summary}`, i + 1, date, undefined, { values }));
    });
    // RELATED_QUERIES: related_queries.rising[] = {query, value, extracted_value}
    arr(obj(r.related_queries).rising).slice(0, 10).forEach((o, i) => {
      const q = str(o, "query");
      out.push(row("rising_query", q, str(o, "link"), "trends.google.com", `Rising search: ${q} (${str(o, "value") || "n/a"})`, i + 1,
        undefined, undefined, { value: num(o, "extracted_value") }));
    });
  } else if (engine === "google_shopping") {
    arr(r.shopping_results).forEach((o, i) => {
      const url = str(o, "link", "product_link");
      const bits = [str(o, "price"), str(o, "rating") && `${str(o, "rating")}★`, str(o, "reviews") && `${str(o, "reviews")} reviews`, str(o, "source")];
      out.push(row("product", str(o, "title"), url, domain(url), join(bits), i + 1, undefined, undefined,
        { price: num(o, "extracted_price"), rating: num(o, "rating") }));
    });
  } else if (engine === "google_play_product") {
    arr(r.reviews).forEach((o, i) => {
      const snip = str(o, "snippet");
      out.push(row("review", str(o, "title", "user.name"), str(o, "link"), "play.google.com", snip, i + 1, str(o, "iso_date", "date"), snip,
        { rating: num(o, "rating") }));
    });
  } else if (engine === "apple_reviews") {
    arr(r.reviews).forEach((o, i) => {
      const snip = str(o, "text", "review");
      out.push(row("review", str(o, "title", "user.name"), str(o, "link"), "apps.apple.com", snip, i + 1, str(o, "review_date", "date"), snip,
        { rating: num(o, "rating") }));
    });
  } else if (engine === "google_maps") {
    arr(r.local_results).forEach((o, i) => {
      const bits = [str(o, "rating") && `${str(o, "rating")}★`, str(o, "reviews") && `${str(o, "reviews")} reviews`, str(o, "type"), str(o, "address")];
      out.push(row("place", str(o, "title"), "", domain(str(o, "website")) || "google.com/maps", join(bits), i + 1, undefined, undefined,
        { rating: num(o, "rating"), dataId: str(o, "data_id") }));
    });
  } else if (engine === "google_maps_reviews") {
    arr(r.reviews).forEach((o, i) => {
      const snip = str(o, "snippet", "text");
      out.push(row("review", str(o, "user.name"), "", "google.com/maps", snip, i + 1, str(o, "iso_date", "date"), snip, { rating: num(o, "rating") }));
    });
  } else if (engine === "google_jobs") {
    arr(r.jobs_results).forEach((o, i) => {
      const links = [...arr(o.apply_options), ...arr(o.related_links)];
      const link = links.length ? str(links[0], "link") : "";
      const bits = [str(o, "company_name"), str(o, "location"), str(o, "description").slice(0, 300)];
      out.push(row("job", str(o, "title"), link || str(o, "share_link"), domain(link) || "google.com/jobs", join(bits), i + 1,
        str(o, "detected_extensions.posted_at")));
    });
  } else if (engine === "youtube") {
    arr(r.video_results).forEach((o, i) => {
      const url = str(o, "link");
      const bits = [str(o, "channel.name"), str(o, "length"), str(o, "published_date")];
      out.push(row("organic", str(o, "title"), url, domain(url), join(bits), i + 1, str(o, "published_date")));
    });
  }
  return out;
}

export function toEvidence(runId: string, searchCallId: string, rows: Row[], startIndex: number): Evidence[] {
  return rows.map((r, i) => ({ ...r, id: `E${startIndex + i + 1}`, runId, searchCallId }));
}
