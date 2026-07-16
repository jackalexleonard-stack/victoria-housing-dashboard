from datetime import date
from pathlib import Path

from pipeline.sources import news

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 7, 16)
ALLOWED_KEYS = {"title", "url", "source", "published", "tags"}


def test_tag_text_is_housing_anchored():
    # Bare "prices" on an unrelated story must NOT tag as housing.
    assert news.tag_text("Foxtel ups prices 10 days after record") == []
    assert news.tag_text("Melbourne house prices rise as rental vacancy tightens") == ["prices", "rents"]
    assert news.tag_text("Iron ore price lifts on Chinese economy") == ["international"]
    assert "policy" in news.tag_text("Government unveils negative gearing changes")


def test_canonical_url_strips_tracking_and_fragment():
    u = news.canonical_url("https://Example.com/A/b/?utm_source=x&id=5&fbclid=z#frag")
    assert u == "https://example.com/A/b?id=5"


def test_norm_title_strips_publisher_suffix():
    assert news.norm_title("Melbourne home prices surge - The Age") == "melbourne home prices surge"
    assert news.norm_title("Melbourne home prices surge!") == "melbourne home prices surge"


def test_parse_rss_offline():
    items = news.parse_feed("Synthetic RSS", (FIX / "news_rss_sample.xml").read_bytes(), today=TODAY)
    # 6 items in feed; the non-housing "grand final" one is filtered out.
    assert len(items) == 5
    assert all(set(it) == ALLOWED_KEYS for it in items)           # no article text stored
    assert all(it["tags"] for it in items)                        # every kept item is tagged
    assert not any("grand final" in it["title"].lower() for it in items)

    by_title = {it["title"]: it for it in items}
    prices = next(it for it in items if it["tags"] == ["prices"])
    assert "utm" not in prices["url"] and "#" not in prices["url"]
    assert prices["url"].endswith("melbourne-house-prices-june?id=101")

    undated = next(it for it in items if "Undated" in it["title"])
    assert undated["published"] == "2026-07-16"                   # date fallback -> today
    assert undated["tags"] == ["policy"]


def test_parse_atom_offline():
    items = news.parse_feed("Synthetic Atom", (FIX / "news_atom_sample.atom").read_bytes(), today=TODAY)
    assert len(items) == 3
    tags = {it["title"][:20]: it["tags"] for it in items}
    assert any("international" in t for t in tags.values())
    assert any("supply_construction" in t for t in tags.values())


def test_merge_dedup_across_feeds():
    rss = news.parse_feed("Synthetic RSS", (FIX / "news_rss_sample.xml").read_bytes(), today=TODAY)
    atom = news.parse_feed("Synthetic Atom", (FIX / "news_atom_sample.atom").read_bytes(), today=TODAY)
    merged = news.merge_items([], rss + atom, today=TODAY)
    # 5 + 3 = 8 tagged, minus the one duplicated headline = 7.
    assert len(merged) == 7
    melb = [it for it in merged if news.norm_title(it["title"]) == "melbourne house prices rise 2 per cent in the june quarter"]
    assert len(melb) == 1
    # Sorted newest first.
    assert merged == sorted(merged, key=lambda d: d["published"], reverse=True)


def test_merge_drops_items_older_than_window():
    old = {"title": "Old housing story", "url": "https://x.test/old", "source": "s",
           "published": "2026-01-01", "tags": ["prices"]}
    new = {"title": "Fresh housing story", "url": "https://x.test/new", "source": "s",
           "published": "2026-07-15", "tags": ["prices"]}
    merged = news.merge_items([old], [new], today=TODAY)   # cutoff = 2026-04-17
    urls = {it["url"] for it in merged}
    assert "https://x.test/new" in urls
    assert "https://x.test/old" not in urls
