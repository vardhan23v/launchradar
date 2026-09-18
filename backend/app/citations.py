"""Citation validator: the gate every Signal, complaint and found product passes before it is persisted."""
import re
from typing import Dict, Iterable, List, Tuple


def _norm(s: str) -> str:
    return re.sub(r"[”\"“]", "", re.sub(r"\s+", " ", s.lower())).strip()


def _source_text(e: dict) -> str:
    return _norm(" ".join([e.get("title", ""), e.get("snippet", ""), e.get("text") or ""]))


def verify_quote(evidence_ids: Iterable[str], quote: str, all_evidence: List[dict]) -> Tuple[bool, str]:
    """Ids must exist in this run, and the quote must be a verbatim (case/whitespace-normalised) substring."""
    by_id: Dict[str, dict] = {e["id"]: e for e in all_evidence}
    q = _norm(quote or "")
    if not q:
        return False, "empty quote"
    ids = list(evidence_ids)
    for i in ids:
        ev = by_id.get(i)
        if ev is None:
            return False, "unknown evidence id %s" % i
        if q in _source_text(ev):
            return True, ""
    if not ids:
        return False, "no evidence id given"
    return False, "quote is not a substring of any cited row"


def validate_signals(signals: List[dict], all_evidence: List[dict]) -> Tuple[List[dict], int]:
    valid = [s for s in signals if verify_quote(s.get("evidenceIds", []), s.get("quote", ""), all_evidence)[0]]
    return valid, len(signals) - len(valid)
