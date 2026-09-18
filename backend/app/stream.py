"""
Server-sent events for a run: persisted events first, then new ones as the pipeline
writes them, until the run is terminal. `from_index` (Last-Event-ID + 1) resumes
without duplicates, so a refresh mid-run is safe.

Demo runs have their whole trace recorded up front: they are paced so the trace
animates, and the stream itself completes them. Live runs are completed only by
the pipeline — never by a viewer.
"""
import asyncio
import json
import time
from typing import AsyncIterator, Awaitable, Callable, Optional, Tuple

from . import config
from .store import Store
from .utils import now_ms

POLL_S = 0.3
MAX_FOLLOW_S = 15 * 60


def _delay_s(event: dict) -> float:
    if event.get("type") == "search_call":
        return (config.demo_delay_ms() + event["call"].get("latencyMs", 0) % 180) / 1000
    if event.get("type") == "llm":
        return config.demo_delay_ms() * 0.6 / 1000
    return config.demo_delay_base_ms() / 1000


async def follow_run_events(store: Store, run_id: str, from_index: int = 0,
                            is_cancelled: Optional[Callable[[], Awaitable[bool]]] = None) -> AsyncIterator[Tuple[int, dict]]:
    first = store.get_run(run_id)
    if first is None:
        return
    cursor = max(0, from_index)
    paced = bool(first.get("demo")) and first["status"] == "running"
    deadline = time.time() + MAX_FOLLOW_S

    async def cancelled() -> bool:
        return bool(is_cancelled and await is_cancelled())

    while not await cancelled():
        events = store.events_for(run_id)
        while cursor < len(events):
            event = events[cursor]
            yield cursor, event
            cursor += 1
            if paced:
                await asyncio.sleep(_delay_s(event))
            if await cancelled():
                return

        run = store.get_run(run_id)
        if run is None:
            return
        if run.get("demo") and run["status"] == "running":
            store.update_run(run_id, {"status": "complete", "finishedAt": now_ms()})
            store.append_events(run_id, [{"type": "status", "status": "complete"},
                                         {"type": "done", "runId": run_id, "searchesUsed": run["searchesUsed"]}])
            continue  # loop once more to deliver the two events just written

        if run["status"] in ("complete", "failed") and cursor >= len(store.events_for(run_id)):
            # runs persisted before terminal events existed still close cleanly
            if not events or events[-1].get("type") != "done":
                yield cursor, {"type": "status", "status": run["status"]}
                yield cursor + 1, {"type": "done", "runId": run_id, "searchesUsed": run["searchesUsed"]}
            return
        if time.time() > deadline:
            return
        await asyncio.sleep(POLL_S)


def encode_event(index: int, event: dict) -> str:
    return "id: %d\ndata: %s\n\n" % (index, json.dumps(event, ensure_ascii=False))
