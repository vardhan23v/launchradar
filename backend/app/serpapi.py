"""
The only module allowed to reach SerpApi. Every search passes through:
budget guard → cache lookup → call → normalise → persist → emit step event.
"""
import json
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

import httpx

from . import config
from .engines import hash_params, redact, to_raw_params
from .normalise import normalise, to_evidence
from .store import Store
from .utils import now_ms

HOUR_MS = 3_600_000
Emitter = Callable[[dict], None]


class BudgetExceeded(Exception):
    pass


class SerpApiHttpError(Exception):
    """A non-2xx answer from SerpApi. 4xx is final; 5xx may be retried once."""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__("SerpApi %d: %s" % (status, detail))
        self.status = status


def scrub(text: str) -> str:
    """Secrets never reach logs, the store or the browser — even inside error text."""
    key = config.serpapi_key()
    if key:
        text = text.replace(key, "[redacted]")
    return re.sub(r"api_key=[^&\s\"]+", "api_key=[redacted]", text, flags=re.I)


def _query_of(params: Dict[str, Any]) -> str:
    for k in ("q", "search_query", "product_id", "data_id"):
        if params.get(k):
            return str(params[k])
    return ""


class SerpApiService:
    def __init__(self, store: Store, on_event: Optional[Emitter] = None, fixture_dir: Optional[Path] = None,
                 transport: Optional[httpx.BaseTransport] = None) -> None:
        self.store = store
        self.on_event = on_event
        self.fixture_dir = Path(fixture_dir) if fixture_dir else config.FIXTURES / "serpapi"
        self.transport = transport
        # discovery runs searches concurrently; guards + bookkeeping must be atomic
        self._lock = threading.RLock()

    def search(self, engine: str, params: Dict[str, Any], run_id: str, stage: str, order: int,
               region: Optional[str] = None) -> Dict[str, Any]:
        run = self.store.get_run(run_id)
        if run is None:
            raise BudgetExceeded("Run not found, cannot charge searches.")
        raw_params = to_raw_params(engine, params, region or run["region"])
        phash = hash_params(engine, raw_params)
        ctx = {"runId": run_id, "stage": stage, "order": order}
        try:
            with self._lock:
                # 1. per-run budget — always, and before any cost
                if run["searchesUsed"] >= run["budget"]:
                    raise BudgetExceeded("Run budget exceeded (%d/%d)." % (run["searchesUsed"], run["budget"]))
                mode = config.serpapi_mode()
                if mode == "replay":
                    return self._from_fixture(engine, raw_params, phash, ctx)
                # 2. cache — an identical search inside the TTL is free
                cached = self.store.find_cached_call(phash, config.cache_ttl_hours() * HOUR_MS)
                if cached is not None:
                    return self._replay_cached(cached, ctx)
                # 3. quota guards apply only to searches that will be billed
                self._assert_quota()
            started = time.time()
            body = self._call_network(engine, raw_params)
            if config.serpapi_mode() == "record":
                self.fixture_dir.mkdir(parents=True, exist_ok=True)
                (self.fixture_dir / ("%s.json" % phash)).write_text(json.dumps(body, indent=2), encoding="utf-8")
            with self._lock:
                return self._persist_raw(ctx, engine, raw_params, phash, body, cached=False, billed=True, started=started)
        except Exception as err:
            self._record_failure(engine, raw_params, phash, ctx, err)
            raise

    def _assert_quota(self) -> None:
        now = now_ms()
        month = self.store.billed_searches_this_month(now)
        if month >= config.monthly_search_budget():
            raise BudgetExceeded("Monthly budget reached (%d/%d) — no live searches left." % (month, config.monthly_search_budget()))
        hour = self.store.billed_searches_since(now - HOUR_MS)
        if hour >= config.hourly_rate_guard():
            raise BudgetExceeded("Hourly rate guard reached (%d/%d) — wait before searching again." % (hour, config.hourly_rate_guard()))

    def _emit(self, call: dict, ctx: dict, result_count: int) -> None:
        if self.on_event:
            self.on_event({"type": "search_call", "call": {
                "stage": ctx["stage"], "engine": call["engine"], "query": _query_of(call["params"]),
                "resultCount": result_count, "cached": call["cached"], "latencyMs": call["latencyMs"], "status": call["status"],
            }})

    def _record_failure(self, engine: str, params: dict, phash: str, ctx: dict, err: Exception) -> None:
        """A failed or skipped search still appears in the research trace; the run continues."""
        call = {
            "id": "sc_%s_%d" % (ctx["runId"], ctx["order"]), "runId": ctx["runId"], "stage": ctx["stage"], "engine": engine,
            "params": redact(params), "paramsHash": phash, "cached": False,
            "status": "skipped" if isinstance(err, BudgetExceeded) else "failed",
            "latencyMs": 0, "resultCount": 0, "createdAt": now_ms(), "billed": False, "error": scrub(str(err))[:300],
        }
        self.store.add_search_calls([call])
        self._emit(call, ctx, 0)

    def _record_call(self, call: dict, rows: List[dict], ctx: dict) -> Dict[str, Any]:
        self.store.add_search_calls([call])
        base = len(self.store.evidence_for(ctx["runId"]))
        evidence = to_evidence(ctx["runId"], call["id"], rows, base)
        self.store.add_evidence(evidence)
        self._emit(call, ctx, len(evidence))
        return {"call": call, "evidence": evidence, "cached": call["cached"]}

    def _replay_cached(self, cached: dict, ctx: dict) -> Dict[str, Any]:
        call = dict(cached, id="sc_%s_%d" % (ctx["runId"], ctx["order"]), runId=ctx["runId"], stage=ctx["stage"],
                    cached=True, billed=False, latencyMs=0, createdAt=now_ms())
        return self._record_call(call, cached["params"].get("__rows", []), ctx)

    def _from_fixture(self, engine: str, params: dict, phash: str, ctx: dict) -> Dict[str, Any]:
        path = self.fixture_dir / ("%s.json" % phash)
        if not path.exists():
            raise FileNotFoundError(
                "[replay] missing fixture %s for engine=%s params=%s. Record it once with SERPAPI_MODE=record, or load a demo run."
                % (phash, engine, json.dumps(redact(params)))
            )
        started = time.time()
        raw = json.loads(path.read_text(encoding="utf-8"))
        return self._persist_raw(ctx, engine, params, phash, raw, cached=True, billed=False, started=started)

    def _call_network(self, engine: str, params: dict) -> Dict[str, Any]:
        """20 s timeout · one retry on 5xx, timeout or network failure · never on 4xx."""
        key = config.serpapi_key()
        if not key:
            raise RuntimeError("SERPAPI_API_KEY is required for SERPAPI_MODE=%s." % config.serpapi_mode())
        query = {k: (str(v).lower() if isinstance(v, bool) else v) for k, v in params.items() if v is not None and k != "api_key"}
        query.update({"engine": engine, "api_key": key})
        last: Exception = RuntimeError("SerpApi call failed")
        for _ in range(config.RETRIES_ON_5XX + 1):
            try:
                with httpx.Client(timeout=config.SEARCH_TIMEOUT_S, transport=self.transport) as client:
                    res = client.get("https://serpapi.com/search.json", params=query)
                if res.status_code >= 400:
                    raise SerpApiHttpError(res.status_code, scrub(res.text)[:200])
                return res.json()
            except SerpApiHttpError as err:
                last = err
                if err.status < 500:
                    break
            except (httpx.HTTPError, ValueError) as err:
                last = err
        raise RuntimeError(scrub(str(last))) from last

    def _persist_raw(self, ctx: dict, engine: str, params: dict, phash: str, raw: dict,
                     cached: bool, billed: bool, started: float) -> Dict[str, Any]:
        meta = raw.get("search_metadata") if isinstance(raw, dict) else None
        search_id = meta.get("id") if isinstance(meta, dict) and isinstance(meta.get("id"), str) else None
        try:
            rows = normalise(engine, raw if isinstance(raw, dict) else {})
        except Exception:  # an "empty results" or odd body is a valid zero-row answer
            rows = []
        call = {
            "id": "sc_%s_%d" % (ctx["runId"], ctx["order"]), "runId": ctx["runId"], "stage": ctx["stage"], "engine": engine,
            "params": dict(redact(params), __rows=rows), "paramsHash": phash, "cached": cached, "status": "ok",
            "latencyMs": int((time.time() - started) * 1000), "resultCount": len(rows),
            "createdAt": now_ms(), "billed": billed,
        }
        if search_id:
            call["serpapiSearchId"] = search_id
        run = self.store.get_run(ctx["runId"])
        if run is not None:
            self.store.update_run(ctx["runId"], {"searchesUsed": run["searchesUsed"] + 1})
        return self._record_call(call, rows, ctx)
