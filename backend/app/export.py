"""Markdown report rendered server-side from a run view."""
from datetime import datetime, timezone

from .config import region_name


def export_markdown(view: dict) -> str:
    run = view["run"]
    evidence = view["evidence"]
    day = datetime.fromtimestamp((run.get("finishedAt") or run["createdAt"]) / 1000, tz=timezone.utc).strftime("%Y-%m-%d")
    out = ["# LaunchRadar — %s" % run["question"], "",
           "- Region: %s" % region_name(run["region"]), "- Run: %s · %s" % (run["id"], day),
           "- Searches used: %d / budget %d" % (run["searchesUsed"], run["budget"]),
           "- Evidence: %d rows, %d domains, %d source types" % (
               len(evidence), len({e["domain"] for e in evidence if e.get("domain")}), len({e["blockType"] for e in evidence})), "",
           "## Opportunities (ranked)", ""]
    opps = sorted(view["opportunities"], key=lambda o: o["score"], reverse=True)
    if not opps:
        out += ["_None — every candidate gap is already served._", ""]
    for i, o in enumerate(opps):
        s = o["subScores"]
        out += ["### %d. %s" % (i + 1, o["title"]), "",
                "Score **%s/100** (%s). Pain %s, Momentum %s, Commercial %s, Whitespace %s, Weak rivals %s." % (
                    o["score"], o["confidence"], s["pain"], s["momentum"], s["commercial"], s["whitespace"], s["weakRivals"]), "",
                "**Target:** %s" % o["target"], "", "**Problem:** %s" % o["problem"], "",
                "**Existing solutions:** %s" % o["existingSolutions"], "", "**Gap:** %s" % o["gap"], "",
                "**Pitch:** %s" % o["pitch"], "", "**MVP scope:**"] + ["- %s" % b for b in o["mvpScope"]] + [
                "", "**First validation step:** %s" % o["firstValidationStep"], ""]
        if o.get("skeptic"):
            out += ["**Skeptic objections:**", ""]
            for j, x in enumerate(o["skeptic"]):
                out += ["%d. %s" % (j + 1, x["objection"]), "   Basis: %s" % x["basis"], "   Would change mind: %s" % x["wouldChangeMind"], ""]
        out += ["---", ""]

    out += ["## Gap status", ""]
    for g in view["gaps"]:
        products = ", ".join(p["name"] for p in g.get("foundProducts", [])) or "—"
        wedge = " Wedge: %s" % g["remainingWedge"] if g.get("remainingWedge") else ""
        out.append("- **%s** — %s (cluster %s). Found: %s%s" % (g["status"], g["unmetNeed"], g["clusterId"], products, wedge))
    out += ["", "## Clusters", ""]
    for c in view["clusters"]:
        out.append("- **%s** — %s. Signals: %s%s" % (c["name"], c["jobToBeDone"], ", ".join(c["signalIds"]), " _(weak)_" if c.get("weak") else ""))
    out += ["", "## Competitors", ""]
    for c in view["competitors"]:
        rating = "%s★" % c["rating"] if c.get("rating") is not None else "n/a"
        complaints = "; complaints: %s" % "; ".join(x["text"] for x in c["complaints"]) if c.get("complaints") else ""
        out.append("- **%s** (%s) — %s, %s%s" % (c["name"], c["category"], c.get("pricing") or "pricing n/a", rating, complaints))
    out += ["", "## Signals", ""]
    for s in view["signals"]:
        out.append('- [%s, intensity %s] %s _(%s)_ "%s"' % (s["type"], s["intensity"], s["statement"], ", ".join(s["evidenceIds"]), s["quote"]))
    out += ["", "## Research trace", ""]
    for c in view["searchCalls"]:
        p = c["params"]
        q = p.get("q") or p.get("search_query") or p.get("product_id") or ""
        kind = c["status"] if c.get("status", "ok") != "ok" else ("cached" if c["cached"] else "live")
        out.append("- `%s` — %s · %d rows · %s · %dms" % (c["engine"], q, c.get("resultCount", 0), kind, c["latencyMs"]))
    out += ["", "## Evidence", ""]
    for e in evidence:
        url = " — %s" % e["url"] if e.get("url") else ""
        snip = ' · "%s"' % e["snippet"] if e.get("snippet") else ""
        out.append("- [%s] (%s · %s) %s%s%s" % (e["id"], e["blockType"], e.get("domain", ""), e.get("title", ""), url, snip))
    return "\n".join(out)
