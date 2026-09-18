import type { Engine } from "../config";
import type { BlockType, Evidence } from "../schemas";

interface RawResult {
  blockType: BlockType;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  text?: string;
  date?: string;
  position: number;
  meta: Record<string, unknown>;
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function obj(v: unknown): Record<string, unknown> {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
}

function arr(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x): x is Record<string, unknown> => typeof x === "object" && x !== null)
    .map((x) => ({ ...x }));
}

function strOf(o: unknown, keys: string[]): string {
  const rec = obj(o);
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return "";
}

function numOf(o: unknown, key: string): number {
  const v = obj(o)[key];
  const n = typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : 0;
}

/** Normalise one engine's raw SerpApi JSON into Evidence rows. Every block is optional. */
export function normalise(engine: Engine, raw: Record<string, unknown>): RawResult[] {
  const out: RawResult[] = [];
  switch (engine) {
    case "google": {
      arr(raw.organic_results).forEach((o, i) => {
        const url = strOf(o, ["link", "website_link"]);
        out.push({
          blockType: "organic",
          title: strOf(o, ["title"]),
          url,
          domain: domainOf(url),
          snippet:
            strOf(o, ["snippet", "snippet_highlighted_words_snippet", "link"]) ||
            strOf(obj(o.rich_snippet).top, ["extensions"]),
          date:
            strOf(o, ["date"]) ||
            strOf(obj(o.publication_info).summary, ["summary", "source"]) ||
            strOf(obj(obj(o.about_this_result).source).description, ["description", "source"]),
          position: typeof o.position === "number" ? (o.position as number) : i + 1,
          meta: { sourceSpecific: o },
        });
      });
      arr(raw.related_questions).forEach((o, i) => {
        const url = strOf(o, ["link"]) || strOf(obj(arr(obj(o).snippet_links)[0]).link, ["link"]);
        const q = strOf(o, ["question"]);
        const snip = strOf(o, ["snippet"]);
        out.push({
          blockType: "related_question",
          title: q,
          url,
          domain: domainOf(url),
          snippet: q && snip ? `${q} — ${snip}` : (q || snip),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      arr(raw.discussions_and_forums).forEach((o, i) => {
        const url = strOf(o, ["link"]);
        out.push({
          blockType: "forum",
          title: strOf(o, ["title"]),
          url,
          domain: domainOf(url),
          snippet: strOf(o, ["title"]) || strOf(obj(o.source).name, ["name"]),
          date: strOf(o, ["date"]),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      arr(raw.related_searches).forEach((o, i) => {
        const q = strOf(o, ["query"]);
        out.push({
          blockType: "related_search",
          title: q,
          url: "",
          domain: "",
          snippet: q,
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      arr(raw.ads).forEach((o, i) => {
        const url = strOf(o, ["link", "displayed_link"]);
        out.push({
          blockType: "ad",
          title: strOf(o, ["title"]),
          url,
          domain: domainOf(url),
          snippet: strOf(o, ["snippet"]),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      break;
    }
    case "google_news": {
      arr(raw.news_results).forEach((o, i) => {
        const url = strOf(o, ["link"]);
        const title = strOf(o, ["title"]);
        const sources = arr(o.sources);
        const pub = obj(o.publication_info);
        out.push({
          blockType: "news",
          title,
          url,
          domain: domainOf(url),
          snippet: strOf(o, ["snippet"]) || title,
          date:
            strOf(o, ["date"]) ||
            strOf(pub.published_time, ["basic"]) ||
            strOf(obj(sources[0]).title, ["title"]),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      break;
    }
    case "google_autocomplete": {
      const s = arr(raw.suggestions);
      const list: unknown[] = s.length > 0 ? [...s] : (raw.suggestions as unknown[]);
      if (!Array.isArray(list)) break;
      list.forEach((v, i) => {
        const text = typeof v === "string" ? (v as string) : strOf(v, ["value"]);
        out.push({
          blockType: "suggestion",
          title: text,
          url: "",
          domain: "",
          snippet: text,
          position: i + 1,
          meta: {},
        });
      });
      break;
    }
    case "google_trends": {
      const data = arr(obj(raw.interest_over_time).timeline_data);
      data.forEach((point, i) => {
        const t = strOf(point, ["formattedTime", "time"]);
        const val = numOf(point, "value");
        out.push({
          blockType: "trend_point",
          title: `Interest ${t}`,
          url: "",
          domain: "trends",
          snippet: `${t}: ${val}`,
          text: String(val),
          position: i + 1,
          meta: { sourceSpecific: point },
        });
      });
      arr(raw.rising_related_queries).slice(0, 10).forEach((o, i) => {
        const q = strOf(o, ["query"]);
        out.push({
          blockType: "rising_query",
          title: q,
          url: "",
          domain: "trends",
          snippet: `Rising: ${q}`,
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      break;
    }
    case "google_shopping": {
      arr(raw.shopping_results).forEach((o, i) => {
        const url = strOf(o, ["link", "product_link"]);
        out.push({
          blockType: "product",
          title: strOf(o, ["title"]),
          url,
          domain: domainOf(url),
          snippet: [strOf(o, ["price"]), strOf(o, ["rating"]), strOf(o, ["reviews"]), strOf(o, ["source_name"])]
            .filter(Boolean)
            .join(" · "),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      break;
    }
    case "google_play_product": {
      arr(raw.reviews).forEach((o, i) => {
        const url = strOf(o, ["link"]);
        out.push({
          blockType: "review",
          title: strOf(o, ["title", "user.name"]),
          url,
          domain: "play.google.com",
          snippet: strOf(o, ["snippet"]),
          date: strOf(o, ["date", "user.name"]),
          text: strOf(o, ["snippet"]),
          position: i + 1,
          meta: { rating: numOf(o, "rating"), sourceSpecific: o },
        });
      });
      break;
    }
    case "apple_reviews": {
      arr(raw.reviews).forEach((o, i) => {
        const url = strOf(o, ["link"]);
        out.push({
          blockType: "review",
          title: strOf(o, ["user.name"]),
          url,
          domain: "apps.apple.com",
          snippet: strOf(o, ["review"]),
          date: strOf(o, ["date", "user.name"]),
          text: strOf(o, ["review"]),
          position: i + 1,
          meta: { rating: numOf(o, "rating"), sourceSpecific: o },
        });
      });
      break;
    }
    case "google_maps": {
      arr(raw.local_results).forEach((o, i) => {
        out.push({
          blockType: "place",
          title: strOf(o, ["title"]),
          url: "",
          domain: strOf(o, ["domain"]),
          snippet: [strOf(o, ["rating"]), strOf(o, ["reviews"]), strOf(o, ["address"])]
            .filter(Boolean)
            .join(" · "),
          position: i + 1,
          meta: { rating: numOf(o, "rating"), dataId: strOf(o, ["data_id"]), sourceSpecific: o },
        });
      });
      break;
    }
    case "google_maps_reviews": {
      arr(raw.reviews).forEach((o, i) => {
        const snip = strOf(o, ["snippet", "text"]);
        out.push({
          blockType: "review",
          title: strOf(o, ["user.name"]),
          url: "",
          domain: "google.com/maps",
          snippet: snip,
          date: strOf(o, ["date"]),
          text: snip,
          position: i + 1,
          meta: { rating: numOf(o, "rating"), sourceSpecific: o },
        });
      });
      break;
    }
    case "google_jobs": {
      arr(raw.jobs_results).forEach((o, i) => {
        const rl = arr(obj(o).related_links);
        out.push({
          blockType: "job",
          title: strOf(o, ["title"]),
          url: strOf(rl[0], ["link"]),
          domain: "jobs",
          snippet: [strOf(o, ["company_name"]), strOf(o, ["location"]), strOf(o, ["description"])]
            .filter(Boolean)
            .join(" · "),
          date: strOf(obj(o).detected_extensions, ["posted_at"]),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      break;
    }
    case "youtube": {
      arr(raw.video_results).forEach((o, i) => {
        const url = strOf(o, ["link"]);
        out.push({
          blockType: "organic",
          title: strOf(o, ["title"]),
          url,
          domain: domainOf(url),
          snippet: [strOf(obj(o).channel, ["name"]), strOf(o, ["length"]), strOf(o, ["published_time"])]
            .filter(Boolean)
            .join(" · "),
          date: strOf(o, ["published_time"]),
          position: i + 1,
          meta: { sourceSpecific: o },
        });
      });
      break;
    }
  }
  return out;
}

/** Wrap normalised rows into persisted Evidence entities for a run. */
export function toEvidence(
  runId: string,
  searchCallId: string,
  _engine: Engine,
  rows: RawResult[],
  startIndex: number,
): Evidence[] {
  return rows.map((r, i) => ({
    id: `E${startIndex + i + 1}`,
    runId,
    searchCallId,
    blockType: r.blockType,
    title: r.title,
    url: r.url,
    domain: r.domain,
    snippet: r.snippet,
    text: r.text,
    date: r.date,
    position: r.position,
    meta: r.meta,
  }));
}

export type { RawResult };