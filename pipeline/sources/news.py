"""Housing-news layer — RSS/Atom aggregation (``data/news/items.jsonl``).

Not a tidy series: this collects housing-relevant headlines from a fixed set of
feeds, keyword-tags them, dedupes, and keeps a rolling ~90-day window. Per the
working rules we **never store article text** — only headline, link, date, source
and tags.

Feeds (each URL verified live 2026-07-16). Five sources expose native RSS/Atom;
The Urban Developer, Cotality and the Premier of Victoria have no usable public
feed, so we read them through Google News (``site:``/brand-scoped) — still
headline-only. Plus the two Google News catch-alls from the brief.

Relevance + tagging: an item is kept only if its headline/summary matches at least
one housing topic (prices · rents · supply_construction · policy ·
construction_costs · international); the matched topics become its tags. Keywords
are word-boundary matched and housing-anchored so unrelated general-feed items
(e.g. "Foxtel ups prices") are not swept in.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import feedparser
import requests

from pipeline import common

NEWS_FILE = common.NEWS_DIR / "items.jsonl"
NEWS_META = common.META_DIR / "news.json"
DIGEST_FILE = common.NEWS_DIR / "digest.md"
ROLLING_DAYS = 90

# Optional Claude digest (Phase 3) — only runs when ANTHROPIC_API_KEY is present.
DIGEST_MODEL = "claude-haiku-4-5-20251001"
ANTHROPIC_URL = "https://api.anthropic.com/v1/messages"
DIGEST_HEADLINES = 30


@dataclass(frozen=True)
class Feed:
    source: str
    url: str


_GN = "https://news.google.com/rss/search?q={q}&hl=en-AU&gl=AU&ceid=AU:en"
FEEDS: list[Feed] = [
    # Native RSS / Atom
    Feed("The Age", "https://www.theage.com.au/rss/business.xml"),
    Feed("The Age", "https://www.theage.com.au/rss/national.xml"),
    Feed("ABC News", "https://www.abc.net.au/news/feed/51120/rss.xml"),
    Feed("Guardian Australia", "https://www.theguardian.com/australia-news/rss"),
    Feed("The Conversation", "https://theconversation.com/au/business/articles.atom"),
    Feed("RBA", "https://www.rba.gov.au/rss/rss-cb-media-releases.xml"),
    # No native feed -> Google News (headline-only)
    Feed("The Urban Developer", _GN.format(q="site:theurbandeveloper.com")),
    Feed("Cotality", _GN.format(q="Cotality+OR+CoreLogic+Australia+housing")),
    Feed("Premier of Victoria", _GN.format(q="site:premier.vic.gov.au+housing+OR+planning+OR+homes")),
    # Brief's catch-alls
    Feed("Google News", _GN.format(q="housing+victoria+melbourne")),
    Feed("Google News", _GN.format(q="construction+costs+australia")),
]

# Housing-anchored keywords per topic tag (word-boundary matched, case-insensitive).
TAG_KEYWORDS: dict[str, list[str]] = {
    "prices": [
        "house price", "house prices", "home price", "home prices", "property price",
        "property prices", "dwelling value", "dwelling values", "home value", "home values",
        "property value", "property values", "median price", "median house price",
        "housing market", "property market", "house values", "price growth", "housing values",
    ],
    "rents": [
        "rent", "rents", "rental", "rentals", "renter", "renters", "tenant", "tenants",
        "vacancy rate", "rental market", "weekly rent", "rental vacancy", "tenancy",
    ],
    "supply_construction": [
        "dwelling approval", "dwelling approvals", "building approval", "building approvals",
        "housing construction", "home building", "homebuilding", "new homes", "housing supply",
        "land supply", "greenfield", "subdivision", "housing target", "housing accord",
        "dwelling commencement", "dwelling completions", "new dwellings", "housing development",
        "land release", "lots titled", "construction activity", "housing estate",
    ],
    "policy": [
        "housing policy", "planning reform", "planning system", "zoning", "rezoning",
        "stamp duty", "negative gearing", "social housing", "public housing", "affordable housing",
        "housing minister", "planning minister", "cash rate", "interest rate", "interest rates",
        "rate cut", "rate rise", "rate hike", "housing affordability", "first home buyer",
        "first home buyers", "housing crisis", "big housing build",
    ],
    "construction_costs": [
        "construction cost", "construction costs", "building cost", "building costs",
        "material cost", "material costs", "input cost", "input costs", "cost of construction",
        "tender price", "cost escalation", "labour cost", "labour costs", "building materials",
    ],
    "international": [
        "global economy", "world economy", "federal reserve", "treasury yield", "bond yield",
        "iron ore", "commodity price", "commodity prices", "oil price", "oil prices",
        "brent crude", "global markets", "chinese economy", "us economy",
    ],
}
_TAG_PATTERNS = {
    tag: re.compile(r"\b(?:" + "|".join(re.escape(k) for k in kws) + r")\b", re.I)
    for tag, kws in TAG_KEYWORDS.items()
}
_TRACKING_PREFIXES = ("utm_", "fbclid", "gclid", "ocid", "cmpid", "mc_cid", "mc_eid", "spm")


# --------------------------------------------------------------------------
# Tagging / canonicalisation
# --------------------------------------------------------------------------
def tag_text(text: str) -> list[str]:
    """Return the sorted housing topic tags whose keywords appear in ``text``."""
    return sorted(tag for tag, pat in _TAG_PATTERNS.items() if pat.search(text or ""))


def canonical_url(url: str) -> str:
    """Drop fragments and tracking query params; normalise host/trailing slash."""
    p = urlsplit(url.strip())
    q = [(k, v) for k, v in parse_qsl(p.query)
         if not k.lower().startswith(_TRACKING_PREFIXES)]
    path = p.path.rstrip("/") or "/"
    return urlunsplit((p.scheme or "https", p.netloc.lower(), path, urlencode(q), ""))


def norm_title(title: str) -> str:
    """Normalise a headline for cross-feed dedup (strips Google's ' - Publisher')."""
    t = re.sub(r"\s+-\s+[^-]+$", "", title.strip())
    t = re.sub(r"[^\w\s]", " ", t.lower())
    return re.sub(r"\s+", " ", t).strip()


def _entry_date(entry) -> Optional[str]:
    for key in ("published_parsed", "updated_parsed"):
        tt = entry.get(key)
        if tt:
            return datetime(*tt[:6], tzinfo=timezone.utc).strftime("%Y-%m-%d")
    return None


# --------------------------------------------------------------------------
# Parse one feed (offline-testable against a fixture)
# --------------------------------------------------------------------------
def parse_feed(source: str, raw: bytes, *, today: Optional[date] = None) -> list[dict]:
    """Parse feed bytes into tagged, housing-relevant news items (no article text)."""
    today = today or date.today()
    fp = feedparser.parse(raw)
    out = []
    for e in fp.entries:
        title = (e.get("title") or "").strip()
        link = (e.get("link") or "").strip()
        if not title or not link:
            continue
        # Tag on headline + summary (transient); summary is never stored.
        tags = tag_text(f"{title} {e.get('summary', '')}")
        if not tags:
            continue
        out.append({
            "title": title,
            "url": canonical_url(link),
            "source": source,
            "published": _entry_date(e) or today.strftime("%Y-%m-%d"),
            "tags": tags,
        })
    return out


# --------------------------------------------------------------------------
# Merge / dedupe / rolling window
# --------------------------------------------------------------------------
def merge_items(existing: list[dict], fresh: list[dict], *, today: Optional[date] = None) -> list[dict]:
    """Combine, dedupe (canonical URL then normalised title), keep ~90 days, sort
    newest first."""
    today = today or date.today()
    cutoff = (today - timedelta(days=ROLLING_DAYS)).strftime("%Y-%m-%d")

    merged: list[dict] = []
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    # Existing first so previously-stored items win ties (stable history).
    for item in existing + fresh:
        url = item.get("url", "")
        nt = norm_title(item.get("title", ""))
        if url in seen_urls or nt in seen_titles:
            continue
        if item.get("published", "") < cutoff:
            continue
        seen_urls.add(url)
        seen_titles.add(nt)
        merged.append(item)
    merged.sort(key=lambda d: d.get("published", ""), reverse=True)
    return merged


def load_items() -> list[dict]:
    if not NEWS_FILE.exists():
        return []
    items = []
    for line in NEWS_FILE.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            items.append(json.loads(line))
    return items


def write_items(items: list[dict]) -> None:
    common.NEWS_DIR.mkdir(parents=True, exist_ok=True)
    with NEWS_FILE.open("w", encoding="utf-8") as fh:
        for item in items:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")


def _write_meta(status: str, feeds_ok: int, feeds_failed: int, n_items: int,
                latest: Optional[str], error: Optional[str]) -> None:
    common.META_DIR.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    NEWS_META.write_text(json.dumps({
        "series_id": "news",
        "source_name": "Housing news (RSS/Atom aggregation)",
        "source_url": "multiple feeds — see pipeline/sources/news.py",
        "frequency": "daily",
        "status": status,
        "last_fetched": now,
        "feeds_ok": feeds_ok,
        "feeds_failed": feeds_failed,
        "item_count": n_items,
        "last_item_date": latest,
        "error": error,
    }, indent=2) + "\n", encoding="utf-8")


# --------------------------------------------------------------------------
# Optional Claude daily digest (Phase 3) — headlines only, never article text
# --------------------------------------------------------------------------
def build_digest_prompt(items: list[dict], *, today: date) -> str:
    """A prompt built only from headlines/sources/tags (no article text)."""
    lines = [f"- {it['title']} ({it['source']}; {', '.join(it['tags'])})"
             for it in items[:DIGEST_HEADLINES]]
    return (
        f"You are writing a brief daily digest ({today}) for a Victorian (Melbourne) "
        "housing dashboard. Using ONLY the headlines below, write 2-3 neutral, factual "
        "sentences summarising the day's key housing themes for Victoria and Australia. "
        "Do not invent specifics that are not in the headlines.\n\nHeadlines:\n"
        + "\n".join(lines)
    )


def maybe_write_digest(items: list[dict], *, today: Optional[date] = None) -> Optional[str]:
    """Generate data/news/digest.md via Claude iff ANTHROPIC_API_KEY is set.
    Returns the digest text, or None (silent degrade to tags-only)."""
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key or not items:
        return None
    today = today or date.today()
    resp = requests.post(
        ANTHROPIC_URL,
        headers={"x-api-key": key, "anthropic-version": "2023-06-01",
                 "content-type": "application/json"},
        json={"model": DIGEST_MODEL, "max_tokens": 320,
              "messages": [{"role": "user", "content": build_digest_prompt(items, today=today)}]},
        timeout=60,
    )
    resp.raise_for_status()
    text = "".join(b.get("text", "") for b in resp.json().get("content", [])).strip()
    if not text:
        return None
    common.NEWS_DIR.mkdir(parents=True, exist_ok=True)
    DIGEST_FILE.write_text(
        f"_Auto-generated {today} from {len(items)} tagged headlines "
        f"(no article text stored)._\n\n{text}\n", encoding="utf-8")
    return text


# --------------------------------------------------------------------------
# Orchestrator entry point (own isolation; one bad feed never blocks the rest)
# --------------------------------------------------------------------------
def run_news(*, today: Optional[date] = None) -> dict:
    today = today or date.today()
    fresh: list[dict] = []
    ok = failed = 0
    errors: list[str] = []
    for feed in FEEDS:
        try:
            raw = common.fetch(feed.url).content
            fresh.extend(parse_feed(feed.source, raw, today=today))
            ok += 1
        except Exception as exc:  # noqa: BLE001 — feed isolation
            failed += 1
            errors.append(f"{feed.source}: {type(exc).__name__}")

    merged = merge_items(load_items(), fresh, today=today)
    write_items(merged)
    latest = merged[0]["published"] if merged else None
    status = "ok" if ok else "failed"

    # Optional Claude digest — isolated; never affects the news run's status.
    digest = False
    try:
        digest = maybe_write_digest(merged, today=today) is not None
    except Exception as exc:  # noqa: BLE001
        errors.append(f"digest: {type(exc).__name__}")

    _write_meta(status, ok, failed, len(merged), latest, "; ".join(errors) or None)
    return {"status": status, "feeds_ok": ok, "feeds_failed": failed,
            "items": len(merged), "digest": digest}
