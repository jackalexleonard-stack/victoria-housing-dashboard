import json
from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from pipeline import export


def _df(rows):
    return pd.DataFrame(rows, columns=["date", "region", "metric", "value", "unit"])


FRAMES = {
    "au_cash_rate": _df([
        ("2026-05-31", "australia", "cash_rate", 3.85, "percent"),
        ("2026-06-30", "australia", "cash_rate", 3.85, "percent"),
    ]),
    "vic_hvi": _df([
        ("2026-06-30", "melbourne", "hvi_index", 183.4, "index"),
        ("2026-06-30", "melbourne", "hvi_change_mom", -1.0, "percent"),
        ("2026-06-30", "melbourne", "hvi_change_yoy", -0.9, "percent"),
    ]),
}
METAS = {
    "au_cash_rate": {"series_id": "au_cash_rate", "source_name": "RBA F1.1",
                     "source_url": "https://rba.gov.au", "frequency": "monthly",
                     "status": "ok", "last_fetched": "2026-07-17T06:00:00Z",
                     "last_changed": "2026-07-15T00:00:00Z",
                     "last_data_date": "2026-06-30", "error": None},
    "vic_hvi": {"series_id": "vic_hvi", "source_name": "Cotality",
                "source_url": "https://cotality.com", "frequency": "daily",
                "status": "ok", "last_fetched": "2026-07-17T06:00:00Z",
                "last_changed": "2026-07-17T00:00:00Z",
                "last_data_date": "2026-06-30", "error": None},
    "vic_auctions": {"series_id": "vic_auctions", "source_name": "Domain",
                     "source_url": "https://domain.com.au", "frequency": "weekly",
                     "status": "failed", "last_fetched": "2026-07-17T06:00:00Z",
                     "error": "HTTPError"},
}


def _loaders():
    return (lambda sid: FRAMES.get(sid, _df([])),
            lambda sid: METAS.get(sid, {}))


def test_site_shape_and_failed_series():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)
    assert site["schema_version"] == 1
    assert site["series"]["vic_auctions"]["status"] == "failed"
    assert site["series"]["vic_auctions"]["points"] == []
    assert site["series"]["vic_auctions"]["meta"]["cadence_days"] == 8
    cr = site["series"]["au_cash_rate"]
    assert cr["points"][0] == {"date": "2026-05-31", "region": "australia",
                               "metric": "cash_rate", "value": 3.85}
    assert cr["units"] == {"cash_rate": "percent"}
    assert len(site["hero"]) == 5
    assert all(isinstance(t["value"], (int, float)) or t["value"] is None
               for t in site["hero"])


def test_new_scan_batch_fields_present_and_typed():
    """Contract check for the scan-batch export additions: all optional on
    the TS side, but always emitted and well-typed by the pipeline."""
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)
    assert isinstance(site["hero_lead"], str) and site["hero_lead"]
    assert isinstance(site["metric_labels"], dict)
    assert isinstance(site["extra_tiles"], list)
    assert isinstance(site["section_summaries"], dict)
    charts_by_id = {c["id"]: c for c in site["charts"]}
    # source_name (design review d2: per-chart FRED provenance override) is
    # exported for every chart (None for charts happy with their series'
    # shared meta.source_name), not silently dropped.
    assert charts_by_id["cash_rate"]["source_name"] is None
    assert charts_by_id["brent"]["source_name"] == "FRED — Brent crude (DCOILBRENTEU)"
    assert charts_by_id["cash_rate"]["modal_metrics"] is None
    assert charts_by_id["credit"]["modal_metrics"] == [
        "credit_housing_yoy", "credit_investor_yoy", "credit_owner_occupier_yoy",
        "credit_housing_mom", "credit_investor_mom", "credit_owner_occupier_mom"]
    assert charts_by_id["accord"]["metrics"] == \
        ["accord_cumulative_actual", "accord_cumulative_target"]
    encoded = json.loads(export.dumps(site))
    assert encoded["hero_lead"] == site["hero_lead"]


def test_extra_tiles_carries_the_erp_population_stat_tile():
    frames = dict(FRAMES)
    frames["au_population"] = _df([
        ("2025-09-30", "australia", "population_erp", 27722400.0, "persons"),
        ("2025-12-31", "australia", "population_erp", 27801000.0, "persons"),
    ])
    ls = lambda sid: frames.get(sid, _df([]))
    site = export.build_site(ls, lambda sid: METAS.get(sid, {}),
                             date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)
    assert site["extra_tiles"] == [{
        "key": "erp", "label": "Resident population", "value": 27801000.0,
        "delta": pytest.approx(78600.0), "delta_color": "off",
        "last_date": "2025-12-31", "chart": "population",
    }]


def test_whats_new_tiles_carry_export_time_notability_scores():
    """P0-2 (complete): the change strip needs a rank signal beyond recency
    — export the same score_metric notability pick_hero already uses."""
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)
    whats_new = {t["key"]: t for t in site["whats_new"]}
    assert "cash_rate" in whats_new
    tile = whats_new["cash_rate"]
    assert isinstance(tile["score"], float)
    expected = export.scoring.score_metric("cash_rate", ls, lm, date(2026, 7, 18))["n"]
    assert tile["score"] == pytest.approx(expected)
    # Hero tiles (no changed_at) never carry a score field at all.
    assert all("score" not in t for t in site["hero"])


def test_whats_new_tile_score_is_none_when_unscoreable():
    frames = {"vic_approvals": _df([
        ("2026-06-30", "vic", "approvals_dwellings_total", 4400, "dwellings"),
    ])}
    metas = {"vic_approvals": {
        "series_id": "vic_approvals", "source_name": "ABS",
        "source_url": "https://abs.gov.au", "frequency": "monthly",
        "status": "ok", "last_fetched": "2026-07-17T06:00:00Z",
        "last_changed": "2026-07-16T00:00:00Z",
        "last_data_date": "2026-06-30", "error": None,
    }}
    ls = lambda sid: frames.get(sid, _df([]))
    lm = lambda sid: metas.get(sid, {})
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(metas))
    export.validate_site(site)
    whats_new = {t["key"]: t for t in site["whats_new"]}
    # A single data point renders a tile (value present, delta absent) but
    # score_metric can't compute notability from one point -> null score,
    # not a dropped field or a fabricated number.
    assert "vic_approvals" in whats_new
    assert whats_new["vic_approvals"]["score"] is None


def test_section_summary_quiet_present_and_news_always_false():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)
    quiet = site["section_summary_quiet"]
    assert set(quiet) >= {"prices", "rents", "supply", "money",
                         "people", "social", "world", "news"}
    assert quiet["news"] is False
    # au_cash_rate has real (if quiet-flavoured) data in this fixture -> the
    # section's own mover chart scores and its summary is a real finding.
    assert quiet["money"] is False
    # No people-section series data at all in this fixture -> quiet.
    assert quiet["people"] is True


def test_validate_rejects_non_bool_section_summary_quiet():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    site["section_summary_quiet"]["money"] = "no"
    with pytest.raises(ValueError, match="section_summary_quiet"):
        export.validate_site(site)


def test_section_summaries_news_uses_top_story_tag_and_count():
    ls, lm = _loaders()
    items = [
        {"title": "RBA cuts cash rate", "url": "https://a/1", "source": "RBA",
         "published": "2026-07-17", "tags": ["policy"]},
        {"title": "Other market wrap", "url": "https://a/2", "source": "Google News",
         "published": "2026-07-17", "tags": ["prices"]},
    ]
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS),
                             news_items=items)
    export.validate_site(site)
    assert site["section_summaries"]["news"] == "2 stories this week — Policy leads"


def test_section_summaries_news_no_stories():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    assert site["section_summaries"]["news"] == "No stories this week."


def test_nan_is_rejected_not_serialized():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    site["series"]["au_cash_rate"]["points"][0]["value"] = float("nan")
    with pytest.raises(ValueError):
        export.dumps(site)


def test_cash_rate_annotations_extracted():
    frames = {"au_cash_rate": _df([
        ("2026-03-31", "australia", "cash_rate", 4.10, "percent"),
        ("2026-04-30", "australia", "cash_rate", 3.85, "percent"),
        ("2026-05-31", "australia", "cash_rate", 3.85, "percent"),
    ])}
    ls = lambda sid: frames.get(sid, _df([]))
    site = export.build_site(ls, lambda sid: METAS.get(sid, {}),
                             date(2026, 7, 18), series_ids=["au_cash_rate"])
    assert site["annotations"]["cash_rate_moves"] == \
        [{"date": "2026-04-30", "delta": -0.25}]
    assert site["annotations"]["accord_start"] == "2024-07-01"


def test_news_ranked_with_scores_and_digest():
    items = [
        {"title": "Melbourne auction market wrap", "url": "https://a/1",
         "source": "Cotality", "published": "2026-07-17", "tags": ["prices"]},
        {"title": "Random offshore piece", "url": "https://a/2",
         "source": "Google News", "published": "2026-07-01", "tags": []},
    ]
    news = export.build_news(items, date(2026, 7, 18), digest="Digest text")
    export.validate_news(news)
    assert news["items"][0]["url"] == "https://a/1"
    assert news["items"][0]["score"] > news["items"][1]["score"]
    assert news["top_story_urls"] == ["https://a/1"]
    assert news["digest"] == "Digest text"


def test_news_health_passthrough_from_meta():
    items = [{"title": "A", "url": "https://a/1", "source": "S",
              "published": "2026-07-17", "tags": []}]
    meta = {"feeds_ok": 11, "feeds_failed": 0, "item_count": 147,
            "last_item_date": "2026-07-20", "last_fetched": "2026-07-20T06:23:14Z"}
    news = export.build_news(items, date(2026, 7, 18), digest=None, meta=meta)
    export.validate_news(news)
    assert news["health"] == {"feeds_ok": 11, "feeds_total": 11,
                               "last_fetched": "2026-07-20T06:23:14Z"}


def test_news_health_absent_when_meta_has_no_feed_counts():
    items = [{"title": "A", "url": "https://a/1", "source": "S",
              "published": "2026-07-17", "tags": []}]
    news = export.build_news(items, date(2026, 7, 18), digest=None)
    export.validate_news(news)
    assert "health" not in news
    # Old-shape meta (present but no feeds_ok, e.g. a series meta file) must
    # also produce no health key rather than raising.
    news2 = export.build_news(items, date(2026, 7, 18), digest=None, meta={"status": "ok"})
    assert "health" not in news2


def test_news_health_counts_failed_feeds_into_total():
    items = []
    meta = {"feeds_ok": 9, "feeds_failed": 2, "last_fetched": "2026-07-20T06:23:14Z"}
    news = export.build_news(items, date(2026, 7, 18), digest=None, meta=meta)
    assert news["health"] == {"feeds_ok": 9, "feeds_total": 11,
                               "last_fetched": "2026-07-20T06:23:14Z"}


def test_validate_news_rejects_health_feeds_ok_exceeding_total():
    bad = {"schema_version": 1, "items": [], "top_story_urls": [], "digest": None,
           "health": {"feeds_ok": 5, "feeds_total": 3, "last_fetched": None}}
    with pytest.raises(ValueError, match="health"):
        export.validate_news(bad)


def test_note_passes_through_charts_and_serialises_as_null_when_absent():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)
    charts_by_id = {c["id"]: c for c in site["charts"]}
    assert charts_by_id["hvi_melbourne"]["note"] == (
        "Daily index — the free Cotality feed covers a rolling year; "
        "history accumulates from Jul 2025.")
    assert charts_by_id["cash_rate"]["note"] is None
    # A None note must serialise as JSON null, not be dropped or raise.
    encoded = export.dumps(site)
    assert '"cash_rate"' in encoded
    decoded = json.loads(encoded)
    decoded_by_id = {c["id"]: c for c in decoded["charts"]}
    assert decoded_by_id["cash_rate"]["note"] is None
    assert decoded_by_id["hvi_melbourne"]["note"] == charts_by_id["hvi_melbourne"]["note"]


def test_validate_rejects_bad_status():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    site["series"]["vic_hvi"]["status"] = "banana"
    with pytest.raises(ValueError, match="status"):
        export.validate_site(site)


def test_hero_pads_when_a_selected_tile_cannot_be_built(monkeypatch):
    ls, lm = _loaders()
    # pick_hero selects a key, but tile_value yields nothing for it → must not drop below 5
    monkeypatch.setattr(export.scoring, "pick_hero",
                        lambda *a, **k: [{"key": "cash_rate"}, {"key": "cash_rate"},
                                         {"key": "cash_rate"}, {"key": "cash_rate"},
                                         {"key": "cash_rate"}])
    monkeypatch.setattr(export, "_machine_tile", lambda *a, **k: None)
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    export.validate_site(site)               # must not raise
    assert len(site["hero"]) == 5
    assert all(t["key"] == "empty" for t in site["hero"])


def test_end_to_end_against_real_repo_data(tmp_path):
    """Runs the real exporter over the committed data/ directory."""
    site, news = export.export_all(out_dir=tmp_path)
    export.validate_site(site)
    export.validate_news(news)
    assert (tmp_path / "site.json").exists() and (tmp_path / "news.json").exists()
    on_disk = json.loads((tmp_path / "site.json").read_text(encoding="utf-8"))
    assert on_disk["schema_version"] == 1
    assert "vic_hvi" in on_disk["series"]
    assert on_disk["series"]["vic_auctions"]["status"] == "failed"
    # data/meta/news.json (committed) carries feeds_ok, so the real export
    # must surface a health object end-to-end.
    assert news["health"]["feeds_ok"] >= 0
    assert news["health"]["feeds_total"] >= news["health"]["feeds_ok"]


# ---------------------------------------------------------------------------
# chart_geos — Task 1: per-chart scope + data-derived geos
# ---------------------------------------------------------------------------
from pipeline.export import chart_geos

UI_GEOS = ["melbourne", "regional_vic", "vic", "australia"]


def _loader(rows):
    df = pd.DataFrame(rows, columns=["date", "region", "metric", "value", "unit"])
    return lambda _sid: df


def test_geos_are_derived_from_the_regions_actually_present():
    load = _loader([
        ("2026-01-31", "melbourne", "m", 1.0, "n"),
        ("2026-01-31", "regional_vic", "m", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": None}
    assert chart_geos(chart, load) == ["melbourne", "regional_vic"]


def test_geos_preserve_ui_geo_order_not_data_order():
    load = _loader([
        ("2026-01-31", "australia", "m", 1.0, "n"),
        ("2026-01-31", "melbourne", "m", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": None}
    assert chart_geos(chart, load) == ["melbourne", "australia"]


def test_a_fixed_region_chart_reports_only_that_region():
    load = _loader([
        ("2026-01-31", "melbourne", "m", 1.0, "n"),
        ("2026-01-31", "vic", "m", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "fixed:vic", "metrics": None}
    assert chart_geos(chart, load) == ["vic"]


def test_global_regions_never_appear_as_a_ui_geo():
    load = _loader([("2026-01-31", "global", "m", 1.0, "n")])
    chart = {"id": "c", "series_id": "s", "region_mode": "fixed:global", "metrics": None}
    assert chart_geos(chart, load) == []


def test_a_missing_or_empty_series_yields_no_geos():
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": None}
    assert chart_geos(chart, lambda _sid: None) == []


def test_metric_filtering_applies_before_region_derivation():
    # A region that only carries a metric this chart doesn't plot must not
    # count as coverage for the chart.
    load = _loader([
        ("2026-01-31", "melbourne", "wanted", 1.0, "n"),
        ("2026-01-31", "vic", "other", 2.0, "n"),
    ])
    chart = {"id": "c", "series_id": "s", "region_mode": "geo", "metrics": ["wanted"]}
    assert chart_geos(chart, load) == ["melbourne"]


def test_every_registry_chart_declares_a_valid_scope():
    from pipeline.findings import CHARTS
    valid = {"geo", "state", "national", "global"}
    for c in CHARTS:
        assert c["scope"] in valid, f"{c['id']} has invalid scope {c.get('scope')!r}"
