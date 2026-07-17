from datetime import date
from pathlib import Path

from pipeline.sources import news

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 7, 16)
BASE_KEYS = {"title", "url", "source", "published", "tags"}
OPTIONAL_KEYS = {"image"}  # parse_feed output; merge may also add dup_sources


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
    # No article text stored — only the base keys plus an optional image URL.
    assert all(BASE_KEYS <= set(it) <= BASE_KEYS | OPTIONAL_KEYS for it in items)
    assert all(it["tags"] for it in items)                        # every kept item is tagged
    assert not any("grand final" in it["title"].lower() for it in items)

    prices = next(it for it in items if it["tags"] == ["prices"])
    assert "utm" not in prices["url"] and "#" not in prices["url"]
    assert prices["url"].endswith("melbourne-house-prices-june?id=101")
    # Image via enclosure; its utm tracking param is stripped too.
    assert prices["image"] == "https://img.example-news.test/prices.jpg"

    rents = next(it for it in items if "vacancy tightens" in it["title"])
    assert rents["image"] == "https://img.example-news.test/rents-thumb.jpg"  # media:thumbnail

    costs = next(it for it in items if "Construction costs" in it["title"])
    assert costs["image"].endswith("costs-460.jpg")               # widest media:content wins

    policy = next(it for it in items if "Premier announces" in it["title"])
    assert "image" not in policy                                  # http:// image rejected

    undated = next(it for it in items if "Undated" in it["title"])
    assert undated["published"] == "2026-07-16"                   # date fallback -> today
    assert undated["tags"] == ["policy"]
    assert "image" not in undated


def test_parse_atom_offline():
    items = news.parse_feed("Synthetic Atom", (FIX / "news_atom_sample.atom").read_bytes(), today=TODAY)
    assert len(items) == 3
    tags = {it["title"][:20]: it["tags"] for it in items}
    assert any("international" in t for t in tags.values())
    assert any("supply_construction" in t for t in tags.values())

    supply = next(it for it in items if "Housing supply lags" in it["title"])
    assert supply["image"] == "https://images.example-atom.test/supply.png"  # <img> in summary


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


def test_digest_prompt_is_headlines_only():
    items = [
        {"title": "Melbourne house prices fall", "url": "https://x.test/a", "source": "The Age",
         "published": "2026-07-15", "tags": ["prices"]},
        {"title": "Rents keep rising", "url": "https://x.test/b", "source": "Cotality",
         "published": "2026-07-14", "tags": ["rents"]},
    ]
    prompt = news.build_digest_prompt(items, today=date(2026, 7, 16))
    assert "Melbourne house prices fall" in prompt
    assert "The Age" in prompt and "prices" in prompt
    # URLs are not needed in the prompt (headlines/source/tags only).
    assert "https://x.test" not in prompt


def test_digest_silent_without_key(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    items = [{"title": "t", "url": "u", "source": "s", "published": "2026-07-16", "tags": ["prices"]}]
    assert news.maybe_write_digest(items, today=date(2026, 7, 16)) is None


def test_merge_drops_items_older_than_window():
    old = {"title": "Old housing story", "url": "https://x.test/old", "source": "s",
           "published": "2026-01-01", "tags": ["prices"]}
    new = {"title": "Fresh housing story", "url": "https://x.test/new", "source": "s",
           "published": "2026-07-15", "tags": ["prices"]}
    merged = news.merge_items([old], [new], today=TODAY)   # cutoff = 2026-04-17
    urls = {it["url"] for it in merged}
    assert "https://x.test/new" in urls
    assert "https://x.test/old" not in urls


def _item(title, url, source, image=None, **extra):
    it = {"title": title, "url": url, "source": source,
          "published": "2026-07-14", "tags": ["prices"], **extra}
    if image:
        it["image"] = image
    return it


def test_merge_backfills_image_from_duplicate():
    existing = [_item("Melbourne house prices fall", "https://x.test/a", "Google News")]
    fresh = [_item("Melbourne house prices fall - The Age", "https://x.test/b", "The Age",
                   image="https://img.x.test/a.jpg")]
    merged = news.merge_items(existing, fresh, today=TODAY)
    assert len(merged) == 1
    assert merged[0]["url"] == "https://x.test/a"              # existing item still wins
    assert merged[0]["image"] == "https://img.x.test/a.jpg"    # image donated by the dup


def test_merge_never_overwrites_existing_image():
    existing = [_item("Story", "https://x.test/a", "s", image="https://img.x.test/keep.jpg")]
    fresh = [_item("Story", "https://x.test/a", "s2", image="https://img.x.test/other.jpg")]
    merged = news.merge_items(existing, fresh, today=TODAY)
    assert merged[0]["image"] == "https://img.x.test/keep.jpg"


def test_merge_records_cross_source_duplicates():
    existing = [_item("Rates on hold", "https://x.test/a", "Google News")]
    fresh = [_item("Rates on hold - The Age", "https://x.test/b", "The Age"),
             _item("Rates on hold", "https://x.test/c", "ABC News")]
    merged = news.merge_items(existing, fresh, today=TODAY)
    assert len(merged) == 1
    assert merged[0]["dup_sources"] == ["ABC News", "The Age"]  # sorted, distinct


def test_merge_same_source_duplicate_not_recorded():
    a = _item("Rates on hold", "https://x.test/a", "The Age")
    b = _item("Rates on hold", "https://x.test/b", "The Age")   # same outlet, two feeds
    merged = news.merge_items([a], [b], today=TODAY)
    assert "dup_sources" not in merged[0]


def test_merge_dup_capture_is_idempotent_and_extends():
    kept = _item("Rates on hold", "https://x.test/a", "Google News",
                 dup_sources=["The Age"])
    again = _item("Rates on hold - The Age", "https://x.test/b", "The Age")
    guardian = _item("Rates on hold", "https://x.test/d", "Guardian Australia")
    merged = news.merge_items([kept], [again, guardian], today=TODAY)
    assert merged[0]["dup_sources"] == ["Guardian Australia", "The Age"]
    # Callers' objects are never mutated.
    assert kept["dup_sources"] == ["The Age"]
