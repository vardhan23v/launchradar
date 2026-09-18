"""Raw SerpApi JSON → evidence rows. Every block is optional; unknown shapes yield no rows, never an error."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


MAX_NEWS_ROWS = 15


def _obj(v: Any) -> Dict[str, Any]:
    return v if isinstance(v, dict) else {}


def _arr(v: Any) -> List[Dict[str, Any]]:
    return [x for x in v if isinstance(x, dict)] if isinstance(v, list) else []


def _str(o: Any, *keys: str) -> str:
    """First non-empty value; dotted keys walk nested objects ('user.name')."""
    for k in keys:
        v: Any = o
        for part in k.split("."):
            v = _obj(v).get(part)
        if isinstance(v, str) and v:
            return v
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return str(v)
    return ""


def _num(o: Any, key: str) -> float:
    try:
        return float(_obj(o).get(key))
    except (TypeError, ValueError):
        return 0.0


def _domain(url: str) -> str:
    try:
        host = urlparse(url).hostname or ""
    except ValueError:
        return ""
    return host[4:] if host.startswith("www.") else host


def _row(block: str, title: str, url: str, domain: str, snippet: str, position: int,
         date: Optional[str] = None, text: Optional[str] = None, meta: Optional[dict] = None) -> dict:
    row = {"blockType": block, "title": title, "url": url, "domain": domain, "snippet": snippet,
           "position": position, "meta": meta or {}}
    if date:
        row["date"] = date
    if text:
        row["text"] = text
    return row


def normalise(engine: str, raw: Dict[str, Any]) -> List[dict]:
    out: List[dict] = []
    if engine == "google":
        for i, o in enumerate(_arr(raw.get("organic_results"))):
            url = _str(o, "link")
            pos = o.get("position") if isinstance(o.get("position"), int) else i + 1
            out.append(_row("organic", _str(o, "title"), url, _domain(url), _str(o, "snippet") or _str(o, "title"), pos, _str(o, "date")))
        for i, o in enumerate(_arr(raw.get("related_questions"))):
            url, q, snip = _str(o, "link"), _str(o, "question"), _str(o, "snippet")
            out.append(_row("related_question", q, url, _domain(url), "%s — %s" % (q, snip) if q and snip else q or snip, i + 1))
        for i, o in enumerate(_arr(raw.get("discussions_and_forums"))):
            url = _str(o, "link")
            # the answers carry the actual user voice
            answers = " | ".join(a for a in (_str(x, "snippet") for x in _arr(o.get("answers"))[:3]) if a)
            out.append(_row("forum", _str(o, "title"), url, _domain(url), answers or _str(o, "title"), i + 1, _str(o, "date")))
        for i, o in enumerate(_arr(raw.get("related_searches"))):
            q = _str(o, "query")
            out.append(_row("related_search", q, "", "", q, i + 1))
        for i, o in enumerate(_arr(raw.get("ads"))):
            url = _str(o, "link", "displayed_link")
            out.append(_row("ad", _str(o, "title"), url, _domain(url), _str(o, "snippet"), i + 1))

    elif engine == "google_news":
        # a result is either one article or a cluster carrying `stories`
        items: List[dict] = []
        for o in _arr(raw.get("news_results")):
            items.extend(_arr(o.get("stories")) or [o])
        # Google News returns 80+ headlines per call; the top ones carry the signal and the
        # rest would drown user-voice rows (forums, People Also Ask) in the extractor
        for i, o in enumerate(items[:MAX_NEWS_ROWS]):
            url, title = _str(o, "link"), _str(o, "title")
            out.append(_row("news", title, url, _domain(url), _str(o, "snippet") or title, i + 1,
                            _str(o, "iso_date", "date"), meta={"source": _str(o, "source.name")}))

    elif engine == "google_autocomplete":
        for i, v in enumerate(raw.get("suggestions") if isinstance(raw.get("suggestions"), list) else []):
            text = v if isinstance(v, str) else _str(v, "value")
            if text:
                out.append(_row("suggestion", text, "", "", text, i + 1))

    elif engine == "google_trends":
        # TIMESERIES: timeline_data[] = {date, timestamp, values[{query, extracted_value}]}
        for i, point in enumerate(_arr(_obj(raw.get("interest_over_time")).get("timeline_data"))):
            label = _str(point, "date")
            values = {_str(v, "query").lower(): _num(v, "extracted_value") for v in _arr(point.get("values")) if _str(v, "query")}
            date = None
            try:
                date = datetime.fromtimestamp(int(_str(point, "timestamp")), tz=timezone.utc).isoformat()
            except ValueError:
                pass
            summary = ", ".join("%s: %g" % kv for kv in values.items())
            out.append(_row("trend_point", "Search interest %s" % label, "", "trends.google.com",
                            "%s — %s" % (label, summary), i + 1, date, meta={"values": values}))
        # RELATED_QUERIES: related_queries.rising[] = {query, value, extracted_value}
        for i, o in enumerate(_arr(_obj(raw.get("related_queries")).get("rising"))[:10]):
            q = _str(o, "query")
            out.append(_row("rising_query", q, _str(o, "link"), "trends.google.com",
                            "Rising search: %s (%s)" % (q, _str(o, "value") or "n/a"), i + 1,
                            meta={"value": _num(o, "extracted_value")}))

    elif engine == "google_shopping":
        for i, o in enumerate(_arr(raw.get("shopping_results"))):
            url = _str(o, "link", "product_link")
            bits = [_str(o, "price"), _str(o, "rating") and "%s★" % _str(o, "rating"),
                    _str(o, "reviews") and "%s reviews" % _str(o, "reviews"), _str(o, "source")]
            out.append(_row("product", _str(o, "title"), url, _domain(url), " · ".join(b for b in bits if b), i + 1,
                            meta={"price": _num(o, "extracted_price"), "rating": _num(o, "rating")}))

    elif engine == "google_play_product":
        for i, o in enumerate(_arr(raw.get("reviews"))):
            snip = _str(o, "snippet")
            out.append(_row("review", _str(o, "title", "user.name"), _str(o, "link"), "play.google.com", snip, i + 1,
                            _str(o, "iso_date", "date"), snip, {"rating": _num(o, "rating")}))

    elif engine == "apple_reviews":
        for i, o in enumerate(_arr(raw.get("reviews"))):
            snip = _str(o, "text", "review")
            out.append(_row("review", _str(o, "title", "user.name"), _str(o, "link"), "apps.apple.com", snip, i + 1,
                            _str(o, "review_date", "date"), snip, {"rating": _num(o, "rating")}))

    elif engine == "google_maps":
        for i, o in enumerate(_arr(raw.get("local_results"))):
            bits = [_str(o, "rating") and "%s★" % _str(o, "rating"), _str(o, "reviews") and "%s reviews" % _str(o, "reviews"),
                    _str(o, "type"), _str(o, "address")]
            out.append(_row("place", _str(o, "title"), "", _domain(_str(o, "website")) or "google.com/maps",
                            " · ".join(b for b in bits if b), i + 1, meta={"rating": _num(o, "rating"), "dataId": _str(o, "data_id")}))

    elif engine == "google_maps_reviews":
        for i, o in enumerate(_arr(raw.get("reviews"))):
            snip = _str(o, "snippet", "text")
            out.append(_row("review", _str(o, "user.name"), "", "google.com/maps", snip, i + 1,
                            _str(o, "iso_date", "date"), snip, {"rating": _num(o, "rating")}))

    elif engine == "google_jobs":
        for i, o in enumerate(_arr(raw.get("jobs_results"))):
            links = _arr(o.get("apply_options")) + _arr(o.get("related_links"))
            link = _str(links[0], "link") if links else ""
            bits = [_str(o, "company_name"), _str(o, "location"), _str(o, "description")[:300]]
            out.append(_row("job", _str(o, "title"), link or _str(o, "share_link"), _domain(link) or "google.com/jobs",
                            " · ".join(b for b in bits if b), i + 1, _str(o, "detected_extensions.posted_at")))

    elif engine == "youtube":
        for i, o in enumerate(_arr(raw.get("video_results"))):
            url = _str(o, "link")
            bits = [_str(o, "channel.name"), _str(o, "length"), _str(o, "published_date")]
            out.append(_row("organic", _str(o, "title"), url, _domain(url), " · ".join(b for b in bits if b), i + 1, _str(o, "published_date")))
    return out


def to_evidence(run_id: str, search_call_id: str, rows: List[dict], start_index: int) -> List[dict]:
    return [dict(r, id="E%d" % (start_index + i + 1), runId=run_id, searchCallId=search_call_id) for i, r in enumerate(rows)]
