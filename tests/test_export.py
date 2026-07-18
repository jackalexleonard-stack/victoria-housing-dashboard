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


def test_validate_rejects_bad_status():
    ls, lm = _loaders()
    site = export.build_site(ls, lm, date(2026, 7, 18), series_ids=list(METAS))
    site["series"]["vic_hvi"]["status"] = "banana"
    with pytest.raises(ValueError, match="status"):
        export.validate_site(site)


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
