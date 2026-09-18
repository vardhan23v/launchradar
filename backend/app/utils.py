import re
import time
from datetime import datetime, timezone
from typing import List, Optional

_STOPWORDS = {
    "the", "and", "for", "with", "that", "this", "from", "are", "was", "how", "why", "what",
    "who", "can", "not", "you", "your", "best", "top", "new", "app", "apps", "tool", "tools",
}
_UNIT_MS = {
    "minute": 60_000, "min": 60_000, "hour": 3_600_000, "day": 86_400_000,
    "week": 7 * 86_400_000, "month": 30 * 86_400_000, "year": 365 * 86_400_000,
}
_REL = re.compile(r"^(an?|\d+)\s+(minute|min|hour|day|week|month|year)s?\s+ago$", re.I)
_NEWS = re.compile(r"^(\d{2})/(\d{2})/(\d{4}),\s*(\d{1,2}):(\d{2})\s*(AM|PM)", re.I)
_CITE = re.compile(r"\[(E\d+(?:,E\d+)*)\]")


def now_ms() -> int:
    return int(time.time() * 1000)


def normalise_query(q: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9\s]", " ", q.lower())).strip()


def key_terms(text: str) -> List[str]:
    """Significant lowercase tokens (the planner's domain-term guard)."""
    return [w for w in normalise_query(text).split(" ") if len(w) > 2 and w not in _STOPWORDS]


def parse_serp_date(value: Optional[str], now: Optional[int] = None) -> Optional[int]:
    """ISO, 'Mar 5, 2026', '3 days ago', and Google News' '01/02/2026, 10:30 PM, +0700 +07' → epoch ms."""
    if not value:
        return None
    s = value.strip()
    if not s:
        return None
    now = now if now is not None else now_ms()
    rel = _REL.match(s)
    if rel:
        n = 1 if rel.group(1).lower() in ("a", "an") else int(rel.group(1))
        return now - n * _UNIT_MS[rel.group(2).lower()]
    if s.lower() == "yesterday":
        return now - 86_400_000
    news = _NEWS.match(s)
    if news:
        hour = int(news.group(4)) % 12 + (12 if news.group(6).upper() == "PM" else 0)
        dt = datetime(int(news.group(3)), int(news.group(1)), int(news.group(2)), hour, int(news.group(5)), tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp() * 1000)
    except ValueError:
        pass
    for fmt in ("%b %d, %Y", "%B %d, %Y", "%d %b %Y"):
        try:
            return int(datetime.strptime(s, fmt).replace(tzinfo=timezone.utc).timestamp() * 1000)
        except ValueError:
            continue
    return None


def cite_groups(text: str) -> List[dict]:
    """[E1,E2] → groups of ids with their position in the text."""
    return [{"ids": m.group(1).split(","), "index": m.start(), "length": len(m.group(0))} for m in _CITE.finditer(text)]


def keep_known_citations(text: str, known: set) -> str:
    """Drop citation ids the run does not contain, so every rendered [E..] resolves."""
    out = text
    for g in reversed(cite_groups(text)):
        ids = [i for i in g["ids"] if i in known]
        repl = "[%s]" % ",".join(ids) if ids else ""
        out = out[: g["index"]] + repl + out[g["index"] + g["length"]:]
    out = re.sub(r"\s+([.,;])", r"\1", out)
    return re.sub(r"\s{2,}", " ", out).strip()
