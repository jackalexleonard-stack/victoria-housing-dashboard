from pathlib import Path

import pytest

from pipeline import common
from pipeline.sources import dffh

FIX = Path(__file__).parent / "fixtures"


def test_discover_tables_url_picks_tables_workbook():
    html = (
        '<a href="/quarterly-median-rents-local-government-area-september-quarter-2025-excel">lga</a>'
        '<a href="/tables-rental-report-september-quarter-2025-excel">tables</a>'
        '<a href="/moving-annual-rent-suburb-september-quarter-2025-excel">suburb</a>'
    )
    url = dffh.discover_tables_url(html)
    assert url == "https://www.dffh.vic.gov.au/tables-rental-report-september-quarter-2025-excel"


def test_discover_tables_url_missing_raises():
    with pytest.raises(ValueError):
        dffh.discover_tables_url("<a href='/something-else'>x</a>")


def test_parse_tables_offline():
    raw = (FIX / "dffh_rental_report.xlsx").read_bytes()
    df = dffh.parse_tables(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne", "regional_vic"}
    assert set(df.unit) == {"percent"}
    # This workbook now supplies only the two genuine time series. The
    # overall median-rent snapshot (Table 1) and the dwelling-type snapshot
    # (Table 3) are no longer read at all — both are superseded by full
    # history from the LGA-medians workbook (see test_parse_lga_medians_offline),
    # so this parser can't produce a second, competing source for either.
    assert set(df.metric) == {"rent_growth_annual", "affordable_share"}
    for m in ("median_rent", "rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
              "rent_2br_house", "rent_3br_house", "rent_4br_house"):
        assert m not in set(df.metric)

    # Time series span (period-end, quarterly).
    assert df.date.min() == "2000-06-30"
    assert df.date.max() == "2025-09-30"
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()
    # Affordable-share series only starts 2020Q3.
    assert df[df.metric == "affordable_share"].date.min() == "2020-09-30"

    # Current-quarter snapshot (September Quarter 2025).
    snap = df[df.date == "2025-09-30"].set_index(["region", "metric"])["value"]
    assert snap[("melbourne", "affordable_share")] == pytest.approx(9.7, abs=0.05)
    assert snap[("regional_vic", "affordable_share")] == pytest.approx(36.4, abs=0.05)
    assert snap[("melbourne", "rent_growth_annual")] == pytest.approx(3.53, abs=0.02)

    # Sanity ranges.
    assert df[df.metric == "affordable_share"].value.between(0, 100).all()
    assert df[df.metric == "rent_growth_annual"].value.between(-20, 30).all()


def test_discover_lga_medians_url_picks_lga_workbook():
    html = (
        '<a href="/quarterly-median-rents-local-government-area-september-quarter-2025-excel">lga</a>'
        '<a href="/tables-rental-report-september-quarter-2025-excel">tables</a>'
        '<a href="/moving-annual-rent-suburb-september-quarter-2025-excel">suburb</a>'
    )
    url = dffh.discover_lga_medians_url(html)
    assert url == (
        "https://www.dffh.vic.gov.au/"
        "quarterly-median-rents-local-government-area-september-quarter-2025-excel"
    )


def test_discover_lga_medians_url_missing_raises():
    with pytest.raises(ValueError):
        dffh.discover_lga_medians_url("<a href='/something-else'>x</a>")


def test_parse_lga_medians_offline():
    raw = (FIX / "dffh_lga_medians.xlsx").read_bytes()
    df = dffh.parse_lga_medians(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne", "regional_vic"}
    expected_metrics = {
        "median_rent", "rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
        "rent_2br_house", "rent_3br_house", "rent_4br_house",
    }
    assert set(df.metric) == expected_metrics
    assert set(df.unit) == {"AUD/week"}
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()

    counts = df.groupby(["metric", "region"]).size()
    for m in expected_metrics:
        assert counts[(m, "melbourne")] >= 100
        assert counts[(m, "regional_vic")] >= 100

    # Full 26-year span: Jun 1999 (period-end) -> Sep 2025 (period-end),
    # for every metric, not just the overall median_rent.
    assert df.date.min() == "1999-06-30"
    assert df.date.max() == "2025-09-30"
    for m in expected_metrics:
        sub = df[df.metric == m]
        assert sub.date.min() == "1999-06-30"
        assert sub.date.max() == "2025-09-30"

    snap = df.set_index(["date", "region", "metric"])["value"]
    # First quarter in the sheet — overall + two dwelling types.
    assert snap[("1999-06-30", "melbourne", "median_rent")] == 170
    assert snap[("1999-06-30", "regional_vic", "median_rent")] == 125
    assert snap[("1999-06-30", "melbourne", "rent_1br_flat")] == 130
    assert snap[("1999-06-30", "regional_vic", "rent_1br_flat")] == 80
    assert snap[("1999-06-30", "melbourne", "rent_3br_house")] == 180
    assert snap[("1999-06-30", "regional_vic", "rent_3br_house")] == 140

    # Latest quarter in the sheet (Metro/Non-Metro LGA aggregate — distinct
    # from Table 1's differently-grouped statistical-region snapshot).
    assert snap[("2025-09-30", "melbourne", "median_rent")] == 575
    assert snap[("2025-09-30", "regional_vic", "median_rent")] == 470
    assert snap[("2025-09-30", "melbourne", "rent_1br_flat")] == 500
    assert snap[("2025-09-30", "regional_vic", "rent_1br_flat")] == 300
    assert snap[("2025-09-30", "melbourne", "rent_2br_flat")] == 600
    assert snap[("2025-09-30", "regional_vic", "rent_2br_flat")] == 390
    assert snap[("2025-09-30", "melbourne", "rent_3br_flat")] == 690
    assert snap[("2025-09-30", "regional_vic", "rent_3br_flat")] == 470
    assert snap[("2025-09-30", "melbourne", "rent_2br_house")] == 575
    assert snap[("2025-09-30", "regional_vic", "rent_2br_house")] == 400
    assert snap[("2025-09-30", "melbourne", "rent_3br_house")] == 550
    assert snap[("2025-09-30", "regional_vic", "rent_3br_house")] == 480
    assert snap[("2025-09-30", "melbourne", "rent_4br_house")] == 595
    assert snap[("2025-09-30", "regional_vic", "rent_4br_house")] == 550

    # Sanity range: wide enough to cover an entry-level 1br flat in 1999
    # (regional_vic was $80/wk) through a 4br house in 2025.
    assert df.value.between(50, 2000).all()
