"""
Fixed research pipeline: plan → discover → extract+validate → cluster → trends →
competitors → gap hypothesis → gap verification → score → copy → sceptic.
SerpApi supplies every fact; the LLM only plans searches and structures evidence.
"""
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

from . import config, prompts
from .citations import verify_quote
from .llm import LlmClient
from .score import compute_score
from .serpapi import SerpApiService
from .store import Store
from .utils import keep_known_citations, key_terms, normalise_query, now_ms, parse_serp_date

# engines the planner may address with a plain text query
QUERY_ENGINES = ["google", "google_news", "google_shopping", "google_jobs", "google_maps", "youtube"]
# rows that are not user voice and must not be mined for signals
NON_SIGNAL_BLOCKS = {"suggestion", "trend_point", "rising_query", "related_search"}
SIGNAL_TYPES = {"pain", "workaround", "request", "trend", "complaint_about_competitor"}
QUESTION_TYPES = set(config.ROUTING)
# voice-of-customer first (ARCH §1 #3); ≤3 extractor batches keeps a run near the ≤10 LLM calls of ARCH §9
EXTRACT_PRIORITY = ["forum", "related_question", "review", "organic", "news", "place", "product", "job", "app", "ad"]
MAX_EXTRACT_ROWS = 120
# planners sometimes describe a search ("Reddit discussion on X") instead of writing it
_QUERY_LABEL = re.compile(r"^\s*(google\s+news|google|news|reddit|quora|forum|youtube)\b[^:]{0,40}:\s*", re.I)
_QUERY_LEADIN = re.compile(r"^\s*(reddit|quora|forum)\s+(discussion|thread|question|post)s?\s+(on|about|for)\s+", re.I)


def clean_query(q: str) -> str:
    """'Quora question: best X' → 'best X quora'; typographic dashes/quotes → plain ASCII."""
    q = q.replace("\u2011", "-").replace("\u2013", "-").replace("\u2014", "-")
    q = q.replace("\u201c", '"').replace("\u201d", '"').replace("\u2019", "'")
    site = None
    m = _QUERY_LABEL.match(q) or _QUERY_LEADIN.match(q)
    if m:
        word = m.group(1).lower()
        site = word if word in ("reddit", "quora", "forum") else None
        q = q[m.end():]
    q = re.sub(r"\s+", " ", q).strip(" .\"'")
    if site and site not in q.lower():
        q = "%s %s" % (q, site)
    return q[:150]


def select_for_extraction(evidence: List[dict]) -> List[dict]:
    """Best rows for the extractor: user-voice block types first, round-robin across searches."""
    rank = {b: i for i, b in enumerate(EXTRACT_PRIORITY)}
    ordered = sorted(evidence, key=lambda e: (rank.get(e["blockType"], 99), e.get("position", 0)))
    return ordered[:MAX_EXTRACT_ROWS]
CATEGORIES = {"direct", "adjacent", "generic-substitute"}
GAP_STATUSES = {"open", "partially-served", "served"}


class Ctx:
    def __init__(self, store: Store, run_id: str, question: str, region: str,
                 serp: Optional[SerpApiService] = None, llm: Optional[LlmClient] = None) -> None:
        self.store, self.run_id, self.question, self.region = store, run_id, question, region
        emit = lambda e: store.append_events(run_id, [e])  # noqa: E731
        self.serp = serp or SerpApiService(store, emit)
        self.llm = llm or LlmClient(emit)
        self.serp.on_event = self.serp.on_event or emit
        self.llm.on_event = self.llm.on_event or emit
        self.order = 0
        # searches each stage may still spend; the sum equals the run budget
        self.allowance = {"discovery": config.DISCOVERY_SHARE, "trends": config.TRENDS_SHARE,
                          "competitors": config.COMPETITORS_SHARE, "verify": config.GAP_VERIFY_SHARE}

    def stage(self, stage: str, message: str, level: str = "info") -> None:
        self.store.append_events(self.run_id, [{"type": "stage", "stage": stage, "message": message, "level": level}])

    def search(self, bucket: str, stage: str, engine: str, params: Dict[str, Any]) -> List[dict]:
        """One budgeted search. A failure is logged to the trace and the run continues."""
        if self.allowance[bucket] <= 0:
            return []
        self.allowance[bucket] -= 1
        self.order += 1
        try:
            return self.serp.search(engine, params, self.run_id, stage, self.order, self.region)["evidence"]
        except Exception as err:  # the client already recorded the failed/skipped call
            self.stage(stage, str(err)[:200], "warn")
            return []


def _params_for(engine: str, q: str) -> Dict[str, Any]:
    if engine == "youtube":
        return {"search_query": q}
    if engine == "google_maps":
        return {"q": q, "type": "search"}
    return {"q": q}


def _row(e: dict) -> str:
    text = " — ".join(x for x in (e.get("title"), e.get("snippet")) if x)
    date = " · %s" % e["date"][:10] if e.get("date") else ""
    return "[%s] (%s · %s%s) %s" % (e["id"], e["blockType"], e.get("domain") or "n/a", date, text)


def _core_phrase(q: str) -> str:
    return " ".join(q.strip().split()[:8])


def _s(v: Any) -> str:
    return v.strip() if isinstance(v, str) else ""


def _str_list(v: Any) -> List[str]:
    return [x for x in v if isinstance(x, str)] if isinstance(v, list) else []


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None and not isinstance(v, bool) else None
    except (TypeError, ValueError):
        return None


def _need(d: Any, key: str) -> Any:
    if not isinstance(d, dict) or key not in d:
        raise ValueError("missing field %r" % key)
    return d[key]


def run_pipeline(store: Store, run_id: str, question: str, region: str,
                 serp: Optional[SerpApiService] = None, llm: Optional[LlmClient] = None) -> None:
    ctx = Ctx(store, run_id, question, region, serp, llm)
    started = time.time()

    def finish(status: str) -> None:
        run = store.get_run(run_id) or {}
        store.append_events(run_id, [{"type": "status", "status": status},
                                     {"type": "done", "runId": run_id, "searchesUsed": run.get("searchesUsed", 0)}])

    try:
        ctx.stage("planner", "Planning research — classifying market type, seeding from autocomplete")

        def v_type(v: Any) -> str:
            t = _need(v, "type")
            if t not in QUESTION_TYPES:
                raise ValueError("type must be one of %s" % sorted(QUESTION_TYPES))
            return t

        question_type = ctx.llm.complete("planner", "Classifying market type", prompts.classify_prompt(question), v_type)
        store.update_run(run_id, {"questionType": question_type})

        suggestions = _seed_autocomplete(ctx)
        queries = _plan_queries(ctx, question_type, suggestions)

        ctx.stage("discovery", "Discovery pass — %d queries" % len(queries))
        with ThreadPoolExecutor(max_workers=3) as pool:
            jobs = []
            for q in queries:
                # allowance and order are claimed here, on one thread, so they stay deterministic
                if ctx.allowance["discovery"] <= 0:
                    break
                ctx.allowance["discovery"] -= 1
                ctx.order += 1
                jobs.append(pool.submit(_safe_search, ctx, "discovery", q["engine"], _params_for(q["engine"], q["q"]), ctx.order))
            for j in jobs:
                j.result()

        discovered = [e for e in store.evidence_for(run_id) if e["blockType"] not in NON_SIGNAL_BLOCKS]
        if len(discovered) < config.MIN_DISCOVERY_EVIDENCE:
            # say the real reason: a quota guard, not the user's question
            skipped = [c for c in store.search_calls_for(run_id) if c.get("status") == "skipped"]
            if skipped and len(skipped) >= len(store.search_calls_for(run_id)) // 2:
                raise RuntimeError(store.quota_block() or skipped[0].get("error") or "Searches were skipped by a budget guard.")
            raise RuntimeError("Discovery yielded only %d evidence rows (< %d). Try a broader question."
                               % (len(discovered), config.MIN_DISCOVERY_EVIDENCE))

        signals = _extract_signals(ctx, select_for_extraction(discovered))
        if not signals:
            raise RuntimeError("No signal survived the citation validator. Try a broader question.")
        store.add_signals(signals)

        clusters = _cluster(ctx, signals)
        store.set_clusters(run_id, clusters)
        _trends(ctx, clusters, signals)
        competitors = _competitors(ctx, clusters, signals)
        store.add_competitors(competitors)
        gaps = _gap_hypothesis(ctx, clusters, signals, competitors)
        store.set_gaps(run_id, gaps)
        _verify(ctx, gaps, clusters, signals)
        _opportunities(ctx, clusters, signals, competitors, gaps)

        ctx.stage("done", "Run complete in %.1fs" % (time.time() - started), "ok")
        store.update_run(run_id, {"status": "complete", "finishedAt": now_ms()})
        finish("complete")
    except Exception as err:
        store.update_run(run_id, {"status": "failed", "error": str(err), "finishedAt": now_ms()})
        ctx.stage("error", str(err)[:300], "error")
        finish("failed")


def _safe_search(ctx: Ctx, stage: str, engine: str, params: dict, order: int) -> None:
    try:
        ctx.serp.search(engine, params, ctx.run_id, stage, order, ctx.region)
    except Exception as err:
        ctx.stage(stage, str(err)[:200], "warn")


# ---- planner ---------------------------------------------------------------

def _seed_autocomplete(ctx: Ctx) -> List[str]:
    phrases = list(dict.fromkeys(p for p in (_core_phrase(ctx.question), ctx.question.strip()) if p))
    out: List[str] = []
    for phrase in phrases[: config.AUTOCOMPLETE_SEEDS]:
        ev = ctx.search("discovery", "autocomplete-seed", "google_autocomplete", {"q": phrase[:80]})
        out.extend([e["title"] for e in ev if e.get("title")][:8])
    return list(dict.fromkeys(out))


def _plan_queries(ctx: Ctx, question_type: str, suggestions: List[str]) -> List[dict]:
    n = ctx.allowance["discovery"]
    allowed = [e for e in config.ROUTING[question_type] if e in QUERY_ENGINES]  # routing is code, not LLM
    domain_terms = set(key_terms(ctx.question))
    for s in suggestions:
        domain_terms.update(key_terms(s))

    def v_plan(v: Any) -> List[dict]:
        out = []
        for q in _need(v, "queries"):
            text = clean_query(_s(q.get("q"))) if isinstance(q, dict) else ""
            if text:
                engine = q.get("engine")
                out.append({"q": text, "engine": engine if engine in allowed else "google"})  # unknown engine → google
        if not out:
            raise ValueError("queries must contain at least one query")
        return out

    planned: List[dict] = []
    try:
        planned = ctx.llm.complete("planner", "Building discovery queries", prompts.plan_prompt(
            ctx.question, config.region_name(ctx.region), question_type, ", ".join(allowed),
            "; ".join(suggestions) or "(none)", n), v_plan)
    except Exception as err:
        ctx.stage("planner", "Planner failed, using template queries: %s" % str(err)[:120], "warn")

    seen = set()

    def dedupe(items: List[dict]) -> List[dict]:
        out = []
        for q in items:
            key = "%s:%s" % (q["engine"], normalise_query(q["q"]))
            if normalise_query(q["q"]) and key not in seen:
                seen.add(key)
                out.append(q)
        return out

    # guardrail: a query must share a domain term with the question or its autocomplete phrasing
    on_topic = [q for q in dedupe(planned) if any(t in domain_terms for t in key_terms(q["q"]))]
    core = _core_phrase(ctx.question)
    templates = [{"q": "%s problems" % core, "engine": "google"}, {"q": "%s reddit" % core, "engine": "google"},
                 {"q": "%s complaints review" % core, "engine": "google"}, {"q": "why is %s so hard" % core, "engine": "google"},
                 {"q": "%s alternatives" % core, "engine": "google"},
                 {"q": core, "engine": "google_news" if "google_news" in allowed else "google"}]
    return (on_topic + dedupe(templates))[:n]


# ---- extract + validate ----------------------------------------------------

def _extract_signals(ctx: Ctx, evidence: List[dict]) -> List[dict]:
    ctx.stage("signals", "Extracting market signals from evidence")
    by_id = {e["id"]: e for e in evidence}
    out: List[dict] = []
    seen = set()
    rejected = 0

    def v_signals(v: Any) -> List[dict]:
        good = []
        for s in _need(v, "signals"):  # tolerate individually malformed signals, keep the batch
            if not isinstance(s, dict):
                continue
            intensity = _num(s.get("intensity"))
            ids = _str_list(s.get("evidenceIds"))
            if s.get("type") in SIGNAL_TYPES and _s(s.get("statement")) and _s(s.get("quote")) and ids \
                    and intensity is not None and 1 <= int(intensity) <= 5:
                good.append(dict(s, intensity=int(intensity), evidenceIds=ids))
        return good

    for offset in range(0, len(evidence), 40):
        batch = evidence[offset: offset + 40]
        try:
            raw = ctx.llm.complete("extract", "Extracting signals (%d rows)" % len(batch),
                                   prompts.extract_prompt(ctx.question, "\n".join(_row(e) for e in batch)), v_signals)
        except Exception as err:
            ctx.stage("signals", "Batch skipped: %s" % str(err)[:140], "warn")
            continue
        for s in raw:
            # the validator is the gate: unknown id or non-verbatim quote → dropped and counted
            if not verify_quote(s["evidenceIds"], s["quote"], batch)[0]:
                rejected += 1
                continue
            key = normalise_query(s["statement"])
            if key in seen:
                continue
            seen.add(key)
            signal = {
                "id": "S%d" % (len(out) + 1),  # assigned after validation: dense and unique
                "runId": ctx.run_id, "type": s["type"], "statement": s["statement"].strip(), "intensity": s["intensity"],
                "evidenceIds": s["evidenceIds"], "quote": s["quote"],
                "domains": list(dict.fromkeys(d for d in (by_id[i].get("domain", "") for i in s["evidenceIds"] if i in by_id) if d)),
            }
            if _s(s.get("who")):
                signal["who"] = _s(s.get("who"))
            out.append(signal)

    prev = (ctx.store.get_run(ctx.run_id) or {}).get("rejectedSignals", 0)
    ctx.store.update_run(ctx.run_id, {"rejectedSignals": prev + rejected})
    ctx.stage("signals", "%d signals kept, %d rejected by the citation validator" % (len(out), rejected), "ok")
    return out


# ---- cluster ---------------------------------------------------------------

def _cluster(ctx: Ctx, signals: List[dict]) -> List[dict]:
    ctx.stage("cluster", "Clustering signals into problem clusters")
    lines = "\n".join("[%s] (%s, intensity %d, %s) %s" % (s["id"], s["type"], s["intensity"], s.get("who", "?"), s["statement"]) for s in signals)

    def v_clusters(v: Any) -> List[dict]:
        out = []
        for c in _need(v, "clusters"):
            if isinstance(c, dict) and _s(c.get("name")) and _s(c.get("jobToBeDone")) and _s(c.get("searchKeyword")):
                out.append(c)
        if not out:
            raise ValueError("clusters must contain at least one valid cluster")
        return out

    raw = ctx.llm.complete("cluster", "Grouping signals", prompts.cluster_prompt(lines), v_clusters)
    by_id = {s["id"]: s for s in signals}
    taken: set = set()
    clusters: List[dict] = []
    for c in raw[:7]:
        # every signal in at most one cluster; unknown ids are discarded
        ids = [i for i in dict.fromkeys(_str_list(c.get("signalIds"))) if i in by_id and i not in taken]
        if not ids:
            continue
        taken.update(ids)
        domains = {d for i in ids for d in by_id[i]["domains"]}
        clusters.append({"id": "C%d" % (len(clusters) + 1), "runId": ctx.run_id, "name": _s(c["name"]),
                         "jobToBeDone": _s(c["jobToBeDone"]), "searchKeyword": _s(c["searchKeyword"]).replace(",", " ")[:80],
                         "signalIds": ids, "weak": len(ids) < 2 or len(domains) < 2})
    if not clusters:
        raise RuntimeError("Clustering produced no usable cluster.")
    ctx.stage("cluster", "%d clusters (%d weak)" % (len(clusters), sum(1 for c in clusters if c["weak"])), "ok")
    return clusters


def _by_strength(clusters: List[dict], signals: List[dict]) -> List[dict]:
    def total(c: dict) -> int:
        return sum(s["intensity"] for s in signals if s["id"] in c["signalIds"])
    return sorted(clusters, key=total, reverse=True)


# ---- trends ----------------------------------------------------------------

def _trends(ctx: Ctx, clusters: List[dict], signals: List[dict]) -> None:
    ordered = _by_strength(clusters, signals)
    if not ordered:
        return
    ctx.stage("trends", "Google Trends — 12-month interest and rising queries")
    # one TIMESERIES call compares up to 5 cluster keywords; RELATED_QUERIES takes exactly one
    keywords = list(dict.fromkeys(c["searchKeyword"].lower() for c in ordered))[:5]
    ctx.search("trends", "trends", "google_trends", {"q": ",".join(keywords), "data_type": "TIMESERIES", "date": "today 12-m"})
    ctx.search("trends", "trends", "google_trends", {"q": keywords[0], "data_type": "RELATED_QUERIES", "date": "today 12-m"})


def trend_slope(evidence: List[dict], keyword: str) -> Optional[float]:
    """(mean of last 3 months − mean of first 3 months) / mean of first 3 months, per keyword."""
    key = keyword.lower()
    points = []
    for e in evidence:
        if e.get("blockType") != "trend_point":
            continue
        t = parse_serp_date(e.get("date"))
        v = ((e.get("meta") or {}).get("values") or {}).get(key)
        if t is not None and isinstance(v, (int, float)):
            points.append((t, v))
    if len(points) < 8:
        return None
    points.sort()
    quarter = max(1, round(len(points) / 4))
    first = sum(v for _, v in points[:quarter]) / quarter
    last = sum(v for _, v in points[-quarter:]) / quarter
    if first <= 0:
        return 1.0 if last > 0 else None
    return (last - first) / first


# ---- competitors -----------------------------------------------------------

def _competitors(ctx: Ctx, clusters: List[dict], signals: List[dict]) -> List[dict]:
    ctx.stage("competitors", "Competitor pass — searching for existing products")
    by_name: Dict[str, dict] = {}

    def v_comps(v: Any) -> List[dict]:
        return [c for c in _need(v, "competitors") if isinstance(c, dict) and _s(c.get("name"))]

    for cluster in _by_strength(clusters, signals)[:3]:
        # cluster keywords often already start with "best" or end with "app"
        kw = re.sub(r"^(best|top)\s+|\s+apps?$", "", cluster["searchKeyword"].strip(), flags=re.I)
        ev = ctx.search("competitors", "competitors", "google", {"q": "best %s app" % kw})
        ev = ev + ctx.search("competitors", "competitors", "google", {"q": "%s alternatives" % kw})
        ev = [e for e in ev if e["blockType"] not in NON_SIGNAL_BLOCKS]
        if not ev:
            continue
        needs = "; ".join(s["statement"] for s in signals if s["id"] in cluster["signalIds"])
        try:
            raw = ctx.llm.complete("competitors", 'Competitors for "%s"' % cluster["name"], prompts.competitor_prompt(
                cluster["name"], cluster["jobToBeDone"], needs, "\n".join(_row(e) for e in ev)), v_comps)
        except Exception as err:
            ctx.stage("competitors", 'Skipped "%s": %s' % (cluster["name"], str(err)[:120]), "warn")
            continue

        ev_by_id = {e["id"]: e for e in ev}
        for c in raw:
            # a competitor must originate from an evidence row, never from LLM memory:
            # its name has to literally appear in one of the rows it cites
            name = _s(c["name"])
            needle = name.lower()
            cited = [i for i in _str_list(c.get("evidenceIds")) if i in ev_by_id]
            if not any(needle in ("%s %s %s" % (ev_by_id[i].get("title", ""), ev_by_id[i].get("snippet", ""), ev_by_id[i].get("url", ""))).lower() for i in cited):
                continue
            complaints = []
            for x in c.get("complaints") if isinstance(c.get("complaints"), list) else []:
                if isinstance(x, dict) and _s(x.get("text")) and verify_quote([x.get("evidenceId", "")], x.get("quote", ""), ev)[0]:
                    complaints.append({"text": _s(x["text"]), "evidenceId": x["evidenceId"], "quote": x["quote"]})
            rating, reviews = _num(c.get("rating")), _num(c.get("reviewCount"))
            rating = rating if rating is not None and 0 <= rating <= 5 else None
            reviews = int(round(reviews)) if reviews is not None and reviews >= 0 else None
            url = c.get("url") if isinstance(c.get("url"), str) and c["url"].startswith(("http://", "https://")) else None
            pricing = _s(c.get("pricing")) or None
            category = c.get("category") if c.get("category") in CATEGORIES else "adjacent"

            existing = by_name.get(needle)
            if existing:
                existing["evidenceIds"] = list(dict.fromkeys(existing["evidenceIds"] + cited))
                existing["clusterIds"] = list(dict.fromkeys(existing["clusterIds"] + [cluster["id"]]))
                existing["coveredNeeds"] = list(dict.fromkeys(existing["coveredNeeds"] + _str_list(c.get("coveredNeeds"))))
                # the same page resurfaces under other searches with a new evidence id;
                # one verbatim quote is one complaint, however often it is found
                known = {normalise_query(y["quote"]) for y in existing["complaints"]}
                existing["complaints"] += [x for x in complaints if normalise_query(x["quote"]) not in known]
                existing["pricing"] = existing["pricing"] or pricing
                existing["rating"] = existing["rating"] if existing["rating"] is not None else rating
                existing["reviewCount"] = existing["reviewCount"] if existing["reviewCount"] is not None else reviews
                continue
            by_name[needle] = {"id": "CO%d" % (len(by_name) + 1), "runId": ctx.run_id, "name": name, "url": url,
                               "category": category, "pricing": pricing, "rating": rating, "reviewCount": reviews,
                               "coveredNeeds": _str_list(c.get("coveredNeeds")), "complaints": complaints,
                               "evidenceIds": cited, "clusterIds": [cluster["id"]]}
    out = list(by_name.values())
    ctx.stage("competitors", "%d competitors, each traced to an evidence row" % len(out), "ok")
    return out


# ---- gaps ------------------------------------------------------------------

def _gap_hypothesis(ctx: Ctx, clusters: List[dict], signals: List[dict], competitors: List[dict]) -> List[dict]:
    ctx.stage("gaps", "Hypothesising gaps and the searches most likely to disprove them")
    cluster_lines = []
    for c in clusters:
        sigs = [s for s in signals if s["id"] in c["signalIds"]]
        domains = {d for s in sigs for d in s["domains"]}
        body = "\n".join("    - %s [%s]" % (s["statement"], ",".join(s["evidenceIds"])) for s in sigs)
        cluster_lines.append("[%s] %s — %s (%d signals, %d domains%s)\n%s" % (
            c["id"], c["name"], c["jobToBeDone"], len(sigs), len(domains), ", WEAK" if c["weak"] else "", body))
    comp_lines = "\n".join(
        "%s (%s; clusters %s) [%s] covers: %s | complaints: %s" % (
            c["name"], c["category"], ",".join(c["clusterIds"]), ",".join(c["evidenceIds"]),
            "; ".join(c["coveredNeeds"]) or "unknown",
            "; ".join("%s [%s]" % (x["text"], x["evidenceId"]) for x in c["complaints"]) or "none found")
        for c in competitors) or "(no competitors found in evidence)"

    def v_gaps(v: Any) -> List[dict]:
        return [g for g in _need(v, "gaps") if isinstance(g, dict) and _s(g.get("unmetNeed")) and _s(g.get("whyExistingFail"))]

    raw = ctx.llm.complete("gaps", "Proposing candidate gaps", prompts.gap_prompt("\n".join(cluster_lines), comp_lines), v_gaps)
    known = {e["id"] for e in ctx.store.evidence_for(ctx.run_id)}
    cluster_ids = {c["id"] for c in clusters}
    gaps: List[dict] = []
    for g in raw:
        cluster_id = _s(g.get("clusterId")).strip("[]")
        kill = [q.strip() for q in _str_list(g.get("killQueries")) if q.strip()][:3]
        if cluster_id not in cluster_ids or not kill:
            continue
        gaps.append({"id": "G%d" % (len(gaps) + 1), "runId": ctx.run_id, "clusterId": cluster_id,
                     "unmetNeed": _s(g["unmetNeed"]), "whyExistingFail": _s(g["whyExistingFail"]), "status": "open",
                     "killQueries": kill, "foundProducts": [], "remainingWedge": None,
                     "evidenceIds": [i for i in _str_list(g.get("evidenceIds")) if i in known]})
        if len(gaps) == 5:
            break
    ctx.stage("gaps", "%d candidate gaps" % len(gaps), "ok")
    return gaps


def _segment_of(cluster: Optional[dict], signals: List[dict]) -> str:
    counts: Dict[str, int] = {}
    for s in signals:
        if cluster and s["id"] in cluster["signalIds"] and s.get("who"):
            counts[s["who"]] = counts.get(s["who"], 0) + 1
    return max(counts, key=counts.get) if counts else "people asking this question"


def _verify(ctx: Ctx, gaps: List[dict], clusters: List[dict], signals: List[dict]) -> None:
    if not gaps:
        return
    ctx.stage("verify", "Gap verification — running kill queries")
    # most decisive kill query per gap first; spare budget goes to second queries
    found: Dict[str, List[dict]] = {}
    for rnd in (0, 1):
        for gap in gaps:
            if rnd < len(gap["killQueries"]) and ctx.allowance["verify"] > 0:
                found.setdefault(gap["id"], []).extend(ctx.search("verify", "verify", "google", {"q": gap["killQueries"][rnd]}))

    def v_verdict(v: Any) -> dict:
        if _need(v, "status") not in GAP_STATUSES:
            raise ValueError("status must be one of %s" % sorted(GAP_STATUSES))
        return v

    for gap in gaps:
        ev = [e for e in found.get(gap["id"], []) if e["blockType"] not in NON_SIGNAL_BLOCKS]
        if not ev:
            # an unverified gap must never be presented as open whitespace
            gap["status"], gap["remainingWedge"] = "partially-served", "Not verified — the kill query returned no evidence."
            continue
        try:
            cluster = next((c for c in clusters if c["id"] == gap["clusterId"]), None)
            raw = ctx.llm.complete("verify", "Judging gap %s" % gap["id"], prompts.verify_prompt(
                gap["unmetNeed"], _segment_of(cluster, signals), config.region_name(ctx.region), "\n".join(_row(e) for e in ev)), v_verdict)
            ids = {e["id"] for e in ev}
            products = raw.get("foundProducts") if isinstance(raw.get("foundProducts"), list) else []
            gap["foundProducts"] = [{"name": _s(p["name"]), "evidenceId": p["evidenceId"], "match": _s(p.get("match")) or "found by kill query"}
                                    for p in products if isinstance(p, dict) and _s(p.get("name")) and p.get("evidenceId") in ids]
            # "served" needs at least one product that resolves to kill-query evidence
            gap["status"] = "partially-served" if raw["status"] == "served" and not gap["foundProducts"] else raw["status"]
            gap["remainingWedge"] = _s(raw.get("remainingWedge")) or None
        except Exception as err:
            gap["status"], gap["remainingWedge"] = "partially-served", "Not verified — the verifier failed."
            ctx.stage("verify", "Gap %s: %s" % (gap["id"], str(err)[:140]), "warn")
    ctx.store.set_gaps(ctx.run_id, gaps)
    tally = {s: sum(1 for g in gaps if g["status"] == s) for s in GAP_STATUSES}
    ctx.stage("verify", "%d open, %d partially served, %d served (crowded)" % (tally["open"], tally["partially-served"], tally["served"]), "ok")


# ---- score + copy + sceptic ------------------------------------------------

def _opportunities(ctx: Ctx, clusters: List[dict], signals: List[dict], competitors: List[dict], gaps: List[dict]) -> None:
    ctx.stage("score", "Scoring opportunities (deterministic, no LLM)")
    evidence = ctx.store.evidence_for(ctx.run_id)
    ev_by_id = {e["id"]: e for e in evidence}
    known = set(ev_by_id)
    now = now_ms()
    ads = sum(1 for e in evidence if e["blockType"] == "ad")
    jobs = sum(1 for e in evidence if e["blockType"] == "job")
    news = sum(1 for e in evidence if e["blockType"] == "news" and (parse_serp_date(e.get("date"), now) or 0) > now - 90 * 86_400_000)
    distinct_domains = len({e["domain"] for e in evidence if e.get("domain")})
    block_types = len({e["blockType"] for e in evidence})
    fields = ("title", "target", "problem", "existingSolutions", "gap", "pitch", "firstValidationStep")

    def v_card(v: Any) -> dict:
        for f in fields:
            if not _s(_need(v, f)):
                raise ValueError("%s must be a non-empty string" % f)
        return v

    def cite(ids: List[str]) -> str:
        ids = list(dict.fromkeys(ids))[:4]
        return " [%s]" % ",".join(ids) if ids else ""

    opps: List[dict] = []
    rows_by_gap: Dict[str, str] = {}
    for gap in gaps:
        if gap["status"] == "served":  # kept and shown as "crowded", never an opportunity card
            continue
        cluster = next((c for c in clusters if c["id"] == gap["clusterId"]), None)
        if cluster is None:
            continue
        sigs = [s for s in signals if s["id"] in cluster["signalIds"]]
        relevant = [c for c in competitors if cluster["id"] in c["clusterIds"]]
        direct = [c for c in relevant if c["category"] == "direct"]
        weak = (sum(1 for c in relevant if (c["rating"] is not None and c["rating"] < 4) or len(c["complaints"]) >= 3) / len(relevant)) if relevant else 0
        slope = trend_slope(evidence, cluster["searchKeyword"])
        scored = compute_score(
            signals=[{"intensity": s["intensity"], "domains": s["domains"]} for s in sigs], trend_slope=slope,
            recent_news_count=news, ads_count=ads, has_priced_competitors=any(c["pricing"] for c in relevant),
            jobs_count=jobs, gap_status=gap["status"], direct_competitors=len(direct) + len(gap["foundProducts"]),
            weak_competitor_share=weak, evidence_count=len(evidence), distinct_domains=distinct_domains, block_type_count=block_types)

        cited = list(dict.fromkeys([i for s in sigs for i in s["evidenceIds"]] + [i for c in relevant for i in c["evidenceIds"]]
                                   + gap["evidenceIds"] + [p["evidenceId"] for p in gap["foundProducts"]]))
        rows = "\n".join([_row(ev_by_id[i]) for i in cited if i in ev_by_id][:40])
        target = _segment_of(cluster, signals)
        copy: dict = {}
        try:
            copy = ctx.llm.complete("opportunity", 'Writing opportunity card for "%s"' % cluster["name"], prompts.opportunity_prompt(json.dumps({
                "cluster": {"name": cluster["name"], "jobToBeDone": cluster["jobToBeDone"]}, "segment": target,
                "signals": [{"statement": s["statement"], "quote": s["quote"], "evidenceIds": s["evidenceIds"]} for s in sigs],
                "competitors": [{"name": c["name"], "category": c["category"], "pricing": c["pricing"], "rating": c["rating"],
                                 "complaints": [x["text"] for x in c["complaints"]], "evidenceIds": c["evidenceIds"]} for c in relevant],
                "gap": {k: gap[k] for k in ("unmetNeed", "whyExistingFail", "status", "foundProducts", "remainingWedge")},
                "trendSlope12m": slope}, ensure_ascii=False), rows), v_card)
        except Exception as err:
            ctx.stage("opportunity", "Card copy fell back to evidence summary: %s" % str(err)[:120], "warn")

        existing_fallback = ", ".join("%s%s" % (c["name"], cite(c["evidenceIds"])) for c in relevant) or "No competitor surfaced in the evidence."
        opp = {"id": "O0", "runId": ctx.run_id, "gapId": gap["id"], "clusterId": cluster["id"],
               "title": _s(copy.get("title")) or cluster["name"], "target": _s(copy.get("target")) or target,
               "problem": keep_known_citations(_s(copy.get("problem")) or " ".join("%s%s" % (s["statement"], cite(s["evidenceIds"])) for s in sigs), known),
               "existingSolutions": keep_known_citations(_s(copy.get("existingSolutions")) or existing_fallback, known),
               "gap": keep_known_citations(_s(copy.get("gap")) or "%s%s" % (gap["unmetNeed"], cite(gap["evidenceIds"])), known),
               "pitch": _s(copy.get("pitch")) or "Validate this gap with target users before building.",
               "mvpScope": _str_list(copy.get("mvpScope")),
               "firstValidationStep": _s(copy.get("firstValidationStep")) or "Interview five people from the target segment this week.",
               "score": scored["total"], "subScores": scored["subScores"], "confidence": scored["confidence"], "skeptic": []}
        opps.append(opp)
        rows_by_gap[gap["id"]] = rows

    opps.sort(key=lambda o: o["score"], reverse=True)
    for i, o in enumerate(opps):
        o["id"] = "O%d" % (i + 1)

    def v_objections(v: Any) -> List[dict]:
        return [x for x in _need(v, "objections") if isinstance(x, dict) and _s(x.get("objection")) and _s(x.get("basis")) and _s(x.get("wouldChangeMind"))]

    for o in opps[:3]:
        try:
            raw = ctx.llm.complete("skeptic", 'Sceptic review of "%s"' % o["title"], prompts.skeptic_prompt(json.dumps(
                {k: o[k] for k in ("title", "target", "problem", "existingSolutions", "gap", "score", "subScores", "confidence")},
                ensure_ascii=False), rows_by_gap[o["gapId"]]), v_objections)
            o["skeptic"] = [{"objection": _s(x["objection"]), "basis": _s(x["basis"]), "wouldChangeMind": _s(x["wouldChangeMind"]),
                             "evidenceIds": [i for i in _str_list(x.get("evidenceIds")) if i in known]} for x in raw[:3]]
        except Exception as err:
            ctx.stage("skeptic", "Skipped: %s" % str(err)[:120], "warn")

    ctx.store.set_opportunities(ctx.run_id, opps)
    ctx.stage("score", "%d opportunities ranked" % len(opps), "ok")
