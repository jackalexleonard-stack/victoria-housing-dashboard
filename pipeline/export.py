"""Build the static JSON bundle the Dashboard 2.0 front-end consumes.

Run after the daily pipeline:  .venv\\Scripts\\python.exe -m pipeline.export
Validates before writing — a malformed export raises and writes nothing, so
the deploy job fails instead of shipping a broken bundle.
"""
from __future__ import annotations

import json
import sys
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import pandas as pd

from pipeline import scoring
from pipeline.findings import (CHARTS, SECTIONS, build_findings,
                               build_metric_labels, build_section_summaries)

SCHEMA_VERSION = 1
DATA = Path("data")
OUT = Path("web/public/data")
ACCORD_START = "2024-07-01"
META_KEYS = ("source_name", "source_url", "frequency", "last_fetched",
             "last_changed", "last_data_date", "error")
EMPTY_TILE = {"key": "empty", "label": "—", "value": None,
              "delta": None, "delta_color": "normal", "last_date": None}

Loader = Callable[[str], object]


def load_series(sid: str) -> pd.DataFrame:
    p = DATA / "series" / f"{sid}.csv"
    if not p.exists():
        return pd.DataFrame(columns=["date", "region", "metric", "value", "unit"])
    return pd.read_csv(p)


def load_meta(sid: str) -> dict:
    p = DATA / "meta" / f"{sid}.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def repo_series_ids() -> list[str]:
    return sorted(p.stem for p in (DATA / "meta").glob("*.json")
                  if p.stem != "news")


def _series_entry(sid: str, ls: Loader, lm: Loader) -> dict:
    meta = lm(sid) or {}
    df = ls(sid)
    points, units = [], {}
    if df is not None and len(df):
        df = df.dropna(subset=["value"])
        units = {str(m): str(u) for m, u in
                 df.groupby("metric")["unit"].first().items()}
        points = [{"date": str(r.date), "region": str(r.region),
                   "metric": str(r.metric), "value": float(r.value)}
                  for r in df.itertuples()]
    status = meta.get("status", "ok" if points else "failed")
    out_meta = {k: meta.get(k) for k in META_KEYS}
    out_meta["cadence_days"] = scoring.NORMAL_CADENCE.get(
        meta.get("frequency", "monthly"), 31)
    return {"status": status, "meta": out_meta, "units": units, "points": points}


def _machine_tile(key: str, ls: Loader, changed_at: Optional[str] = None) -> Optional[dict]:
    v, d, last_date = scoring.tile_value(key, ls)
    if v is None:
        return None
    spec = scoring.REGISTRY[key]
    tile = {"key": key, "label": spec["label"], "value": float(v),
            "delta": float(d) if d is not None else None,
            "delta_color": spec["delta_color"],
            "last_date": last_date.date().isoformat() if last_date is not None else None}
    if changed_at is not None:
        tile["changed_at"] = changed_at
    return tile


def _hero(ls: Loader, lm: Loader, today: date) -> list[dict]:
    tiles = []
    for t in scoring.pick_hero(ls, lm, today):
        mt = None if t["key"] == "empty" else _machine_tile(t["key"], ls)
        tiles.append(mt if mt is not None else dict(EMPTY_TILE))
    return tiles


def _whats_new(ls: Loader, lm: Loader, today: date, window_days: int = 7) -> list[dict]:
    hits = []
    for sid, key in scoring.WHATS_NEW_TILE.items():
        lc = (lm(sid) or {}).get("last_changed")
        if not lc:
            continue
        try:
            age = (pd.Timestamp(today) -
                   pd.Timestamp(lc).tz_localize(None).normalize()).days
        except (ValueError, TypeError):
            continue
        if 0 <= age <= window_days:
            hits.append((str(lc), key))
    hits.sort(reverse=True)
    out = []
    for lc, key in hits:
        tile = _machine_tile(key, ls, changed_at=lc)
        if tile:
            out.append(tile)
    return out


def _erp_tile(ls: Loader) -> Optional[dict]:
    """Population level (ERP) stat tile — split out of the 'population' chart
    card (design review P0-5: mixed-scale with NOM/natural increase flattened
    the section's own finding to invisible). No REGISTRY key covers a
    population level metric, so this is the small dedicated field the task
    calls for rather than registry-style scoring machinery."""
    df = ls("au_population")
    if df is None or len(df) == 0:
        return None
    df = df[(df["metric"] == "population_erp") & (df["region"] == "australia")]
    df = df.dropna(subset=["value"]).copy()
    if df.empty:
        return None
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    v = float(df["value"].iloc[-1])
    d = float(v - df["value"].iloc[-2]) if len(df) > 1 else None
    last_date = df["date"].iloc[-1]
    return {"key": "erp", "label": "Resident population", "value": v,
            "delta": d, "delta_color": "off",
            "last_date": last_date.date().isoformat(), "chart": "population"}


def _extra_tiles(ls: Loader) -> list[dict]:
    return [t for t in (_erp_tile(ls),) if t is not None]


# Tag -> display label, in the priority order used to pick which one "leads"
# a news section summary (matches scoring.TAG_VALUE's own emphasis).
_NEWS_TAG_LABEL = [
    ("policy", "Policy"), ("prices", "Prices"), ("rents", "Rents"),
    ("supply_construction", "Supply"), ("construction_costs", "Costs"),
    ("international", "International"),
]


def _news_section_summary(items: list[dict], today: date) -> str:
    """News summary = top story count ('148 stories this week — Policy
    leads') — the tag is the top-ranked story's, so it names what's actually
    driving today's front page rather than the busiest tag overall."""
    n = len(items)
    if n == 0:
        return "No stories this week."
    top = scoring.top_stories(items, today, n=4)
    if not top:
        return f"{n} stories this week"
    tags = top[0].get("tags") or []
    for tag, label in _NEWS_TAG_LABEL:
        if tag in tags:
            return f"{n} stories this week — {label} leads"
    return f"{n} stories this week"


def _cash_rate_moves(ls: Loader) -> list[dict]:
    df = ls("au_cash_rate")
    if df is None or len(df) == 0:
        return []
    df = df[df["metric"] == "cash_rate"].dropna(subset=["value"]).copy()
    df["date"] = pd.to_datetime(df["date"])
    df = df.sort_values("date")
    df = df[df["date"] >= pd.Timestamp("2015-01-01")]
    out = []
    prev = None
    for r in df.itertuples():
        if prev is not None and r.value != prev:
            out.append({"date": r.date.date().isoformat(),
                        "delta": round(float(r.value - prev), 2)})
        prev = r.value
    return out


def build_site(ls: Loader, lm: Loader, today: date,
               series_ids: Optional[list[str]] = None,
               news_items: Optional[list[dict]] = None) -> dict:
    sids = series_ids if series_ids is not None else repo_series_ids()
    section_summaries = build_section_summaries(ls, lm, today)
    section_summaries["news"] = _news_section_summary(news_items or [], today)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sections": [list(s) for s in SECTIONS],
        "charts": [{k: c[k] for k in ("id", "section", "title", "series_id",
                                      "metrics", "region_mode", "percent",
                                      "markers", "annotate", "note",
                                      "modal_metrics")} for c in CHARTS],
        "findings": build_findings(ls, lm),
        "series": {sid: _series_entry(sid, ls, lm) for sid in sids},
        "hero": _hero(ls, lm, today),
        "hero_lead": scoring.pick_lead(ls, lm, today),
        "whats_new": _whats_new(ls, lm, today),
        "annotations": {"cash_rate_moves": _cash_rate_moves(ls),
                        "accord_start": ACCORD_START},
        "extra_tiles": _extra_tiles(ls),
        "metric_labels": build_metric_labels(ls),
        "section_summaries": section_summaries,
    }


def _news_health(meta: dict) -> Optional[dict]:
    """{feeds_ok, feeds_total, last_fetched}, or None when meta has no feed
    counts to report (e.g. missing data/meta/news.json — keeps old fixtures
    without this key valid, since the field is optional)."""
    ok = meta.get("feeds_ok")
    if ok is None:
        return None
    failed = meta.get("feeds_failed") or 0
    return {"feeds_ok": ok, "feeds_total": ok + failed,
            "last_fetched": meta.get("last_fetched")}


def build_news(items: list[dict], today: date, digest: Optional[str],
               meta: Optional[dict] = None) -> dict:
    ranked = scoring.rank_news(items, today)
    top = scoring.top_stories(items, today, n=4)
    out_items = []
    for it in ranked:
        out_items.append({
            "title": it.get("title", ""), "url": it.get("url", ""),
            "source": it.get("source", ""), "published": it.get("published", ""),
            "tags": it.get("tags") or [], "image": it.get("image"),
            "dup_sources": it.get("dup_sources") or [],
            "score": round(scoring.score_news(it, today), 3),
        })
    out = {"schema_version": SCHEMA_VERSION,
           "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "items": out_items,
           "top_story_urls": [t.get("url", "") for t in top],
           "digest": digest}
    health = _news_health(meta or {})
    if health is not None:
        out["health"] = health
    return out


def dumps(obj: dict) -> str:
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":"),
                      allow_nan=False)


def _fail(msg: str):
    raise ValueError(f"export validation failed: {msg}")


def validate_site(site: dict) -> None:
    if site.get("schema_version") != SCHEMA_VERSION:
        _fail("schema_version")
    datetime.fromisoformat(site["generated_at"].replace("Z", "+00:00"))
    if not site.get("series"):
        _fail("no series")
    chart_ids = [c["id"] for c in site.get("charts", [])]
    if not chart_ids or len(chart_ids) != len(set(chart_ids)):
        _fail("charts missing or ids not unique")
    for cid in chart_ids:
        if not site.get("findings", {}).get(cid):
            _fail(f"missing finding for chart {cid}")
    for sid, entry in site["series"].items():
        if entry.get("status") not in ("ok", "failed"):
            _fail(f"bad status for {sid}")
        for p in entry.get("points", []):
            v = p.get("value")
            if not isinstance(v, (int, float)) or v != v:
                _fail(f"non-finite value in {sid}")
            date.fromisoformat(str(p["date"]))
        if entry["meta"].get("cadence_days") is None:
            _fail(f"missing cadence for {sid}")
    if len(site.get("hero", [])) != 5:
        _fail("hero must have exactly 5 tiles")
    if not isinstance(site.get("hero_lead"), str) or not site["hero_lead"]:
        _fail("hero_lead")
    if not isinstance(site.get("metric_labels"), dict):
        _fail("metric_labels")
    section_summaries = site.get("section_summaries")
    if not isinstance(section_summaries, dict) or not section_summaries:
        _fail("section_summaries")
    for sec_id, text in section_summaries.items():
        if not isinstance(text, str) or not text:
            _fail(f"empty section_summary for {sec_id}")
    extra_tiles = site.get("extra_tiles")
    if not isinstance(extra_tiles, list):
        _fail("extra_tiles")
    for t in extra_tiles:
        if not isinstance(t.get("key"), str) or not isinstance(t.get("label"), str) \
           or not isinstance(t.get("chart"), str):
            _fail("malformed extra_tile")
        if not isinstance(t.get("value"), (int, float)):
            _fail("extra_tile value must be numeric")


def validate_news(news: dict) -> None:
    if news.get("schema_version") != SCHEMA_VERSION:
        _fail("schema_version")
    for it in news.get("items", []):
        if not it.get("title") or not it.get("url"):
            _fail("news item missing title/url")
        if not isinstance(it.get("tags"), list):
            _fail("news item tags must be a list")
    health = news.get("health")  # optional key — only validated when present
    if health is not None:
        if not isinstance(health.get("feeds_ok"), int) or \
           not isinstance(health.get("feeds_total"), int):
            _fail("health feeds_ok/feeds_total must be ints")
        if health["feeds_ok"] > health["feeds_total"]:
            _fail("health feeds_ok exceeds feeds_total")


def _load_news_items() -> list[dict]:
    p = DATA / "news" / "items.jsonl"
    if not p.exists():
        return []
    return [json.loads(line) for line in
            p.read_text(encoding="utf-8").splitlines() if line.strip()]


def _load_digest() -> Optional[str]:
    p = DATA / "news" / "digest.md"
    return p.read_text(encoding="utf-8") if p.exists() else None


def _load_news_meta() -> dict:
    p = DATA / "meta" / "news.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def export_all(out_dir: Path = OUT, today: Optional[date] = None):
    today = today or datetime.now(timezone.utc).date()
    news_items = _load_news_items()
    site = build_site(load_series, load_meta, today, news_items=news_items)
    news = build_news(news_items, today, _load_digest(), _load_news_meta())
    validate_site(site)
    validate_news(news)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "site.json").write_text(dumps(site), encoding="utf-8")
    (out_dir / "news.json").write_text(dumps(news), encoding="utf-8")
    return site, news


def main() -> int:
    site, news = export_all()
    ok = sum(1 for s in site["series"].values() if s["status"] == "ok")
    failed = len(site["series"]) - ok
    print(f"export: {ok} ok / {failed} failed series, "
          f"{len(news['items'])} news items -> {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
