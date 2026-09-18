"""JSON file store. One process-wide instance; every mutation is persisted."""
import json
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from . import config
from .utils import now_ms

_FIELDS = ["runs", "searchCalls", "evidence", "signals", "clusters", "competitors", "gaps", "opportunities"]


def _empty() -> Dict[str, Any]:
    data: Dict[str, Any] = {f: [] for f in _FIELDS}
    data["events"] = {}
    return data


class Store:
    def __init__(self, path: Optional[Path] = None) -> None:
        self.path = Path(path) if path else config.store_path()
        self._lock = threading.RLock()
        self._read_only = False
        self.mem = self._read()

    def _read(self) -> Dict[str, Any]:
        try:
            if self.path.exists():
                # merge over empty so a store from an older build never lacks a field
                return {**_empty(), **json.loads(self.path.read_text(encoding="utf-8"))}
        except (OSError, ValueError):
            pass
        return _empty()

    def _persist(self) -> None:
        """A read-only app directory must not take every request down: temp dir, then memory only."""
        if self._read_only:
            return
        try:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.mem, ensure_ascii=False), encoding="utf-8")
            tmp.replace(self.path)  # atomic: a crash never leaves a half-written store
        except OSError as err:
            fallback = Path(tempfile.gettempdir()) / "launchradar" / "store.json"
            if self.path == fallback:
                self._read_only = True
                print("[store] cannot persist (%s); continuing in memory only" % err)
                return
            print("[store] %s is not writable; using %s. Set STORE_PATH to choose a location." % (self.path, fallback))
            self.path = fallback
            self._persist()

    def _for(self, field: str, run_id: str) -> List[dict]:
        return [x for x in self.mem[field] if x.get("runId") == run_id]

    def _set(self, field: str, run_id: str, rows: List[dict]) -> None:
        with self._lock:
            self.mem[field] = [x for x in self.mem[field] if x.get("runId") != run_id] + rows
            self._persist()

    def _add(self, field: str, rows: List[dict]) -> None:
        with self._lock:
            self.mem[field].extend(rows)
            self._persist()

    # ---- runs
    def create_run(self, run: dict) -> None:
        with self._lock:
            self.mem["runs"].append(run)
            self.mem["events"].setdefault(run["id"], [])
            self._persist()

    def update_run(self, run_id: str, patch: dict) -> dict:
        with self._lock:
            run = self.get_run(run_id)
            if run is None:
                raise KeyError("run not found: %s" % run_id)
            run.update(patch)
            self._persist()
            return run

    def fail_interrupted_runs(self) -> int:
        """Pipelines live in this process; after a restart nothing will ever finish a 'running' live run."""
        with self._lock:
            stale = [r for r in self.mem["runs"] if r.get("status") == "running" and not r.get("demo")]
            for r in stale:
                r.update({"status": "failed", "finishedAt": now_ms(),
                          "error": "Interrupted: the API restarted while this run was in progress. Start it again; saved searches replay from cache."})
                self.mem["events"].setdefault(r["id"], []).extend([
                    {"type": "stage", "stage": "error", "message": r["error"], "level": "error"},
                    {"type": "status", "status": "failed"},
                    {"type": "done", "runId": r["id"], "searchesUsed": r.get("searchesUsed", 0)}])
            if stale:
                self._persist()
            return len(stale)

    def get_run(self, run_id: str) -> Optional[dict]:
        return next((r for r in self.mem["runs"] if r["id"] == run_id), None)

    def list_runs(self) -> List[dict]:
        return sorted(self.mem["runs"], key=lambda r: r["createdAt"], reverse=True)

    # ---- search calls, cache and quota
    def add_search_calls(self, calls: List[dict]) -> None:
        self._add("searchCalls", calls)

    def search_calls_for(self, run_id: str) -> List[dict]:
        return self._for("searchCalls", run_id)

    def find_cached_call(self, params_hash: str, max_age_ms: int, now: Optional[int] = None) -> Optional[dict]:
        """Newest successful call with the same param hash, no older than the TTL."""
        now = now if now is not None else now_ms()
        for c in reversed(self.mem["searchCalls"]):
            if c.get("paramsHash") != params_hash or c.get("status") != "ok":
                continue
            created = c.get("createdAt")
            if created is None or now - created > max_age_ms:
                continue
            if not isinstance(c.get("params", {}).get("__rows"), list):
                continue
            return c
        return None

    def billed_searches_since(self, since_ms: int) -> int:
        """Searches that cost SerpApi quota (cache hits and fixtures excluded)."""
        return sum(1 for c in self.mem["searchCalls"] if c.get("billed") is True and (c.get("createdAt") or 0) >= since_ms)

    def quota_block(self, now: Optional[int] = None) -> Optional[str]:
        """Why a billed search cannot run right now, in words a person can act on. None when it can."""
        now = now if now is not None else now_ms()
        month = self.billed_searches_this_month(now)
        if month >= config.monthly_search_budget():
            return "This month's search budget is used up (%d of %d). It resets on the 1st." % (month, config.monthly_search_budget())
        recent = sorted(c["createdAt"] for c in self.mem["searchCalls"]
                        if c.get("billed") is True and (c.get("createdAt") or 0) >= now - 3_600_000)
        limit = config.hourly_rate_guard()
        if len(recent) >= limit:
            # the slot frees when the oldest search inside the window turns an hour old
            frees_at = recent[len(recent) - limit] + 3_600_000
            minutes = max(1, -(-(frees_at - now) // 60_000))
            return ("The hourly search limit is reached (%d of %d in the last hour). "
                    "Try again in about %d minute%s." % (len(recent), limit, minutes, "" if minutes == 1 else "s"))
        return None

    def billed_searches_this_month(self, now: Optional[int] = None) -> int:
        d = datetime.fromtimestamp((now if now is not None else now_ms()) / 1000, tz=timezone.utc)
        start = datetime(d.year, d.month, 1, tzinfo=timezone.utc)
        return self.billed_searches_since(int(start.timestamp() * 1000))

    # ---- entities
    def add_evidence(self, rows: List[dict]) -> None:
        self._add("evidence", rows)

    def evidence_for(self, run_id: str) -> List[dict]:
        return self._for("evidence", run_id)

    def add_signals(self, rows: List[dict]) -> None:
        self._add("signals", rows)

    def add_competitors(self, rows: List[dict]) -> None:
        self._add("competitors", rows)

    def set_clusters(self, run_id: str, rows: List[dict]) -> None:
        self._set("clusters", run_id, rows)

    def set_gaps(self, run_id: str, rows: List[dict]) -> None:
        self._set("gaps", run_id, rows)

    def set_opportunities(self, run_id: str, rows: List[dict]) -> None:
        self._set("opportunities", run_id, rows)

    # ---- step events
    def set_events(self, run_id: str, events: List[dict]) -> None:
        with self._lock:
            self.mem["events"][run_id] = list(events)
            self._persist()

    def append_events(self, run_id: str, events: List[dict]) -> None:
        with self._lock:
            self.mem["events"].setdefault(run_id, []).extend(events)
            self._persist()

    def events_for(self, run_id: str) -> List[dict]:
        return self.mem["events"].get(run_id, [])

    def view(self, run_id: str) -> dict:
        run = self.get_run(run_id)
        if run is None:
            raise KeyError("run not found: %s" % run_id)
        view = {"run": run}
        for f in _FIELDS[1:]:
            view[f] = self._for(f, run_id)
        return view
