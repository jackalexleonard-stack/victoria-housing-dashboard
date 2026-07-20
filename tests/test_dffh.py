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


def test_report_quarter_end():
    assert dffh._report_quarter_end("Homes Victoria Rental Report - September Quarter 2025") == "2025-09-30"
    assert dffh._report_quarter_end("... March Quarter 2024") == "2024-03-31"
    with pytest.raises(ValueError):
        dffh._report_quarter_end("no quarter here")


def test_parse_tables_offline():
    raw = (FIX / "dffh_rental_report.xlsx").read_bytes()
    df = dffh.parse_tables(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne", "regional_vic"}
    assert set(df.unit) == {"AUD/week", "percent"}
    expected_metrics = {
        "rent_growth_annual", "affordable_share",
        "rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
        "rent_2br_house", "rent_3br_house", "rent_4br_house",
    }
    assert set(df.metric) == expected_metrics
    # median_rent is no longer sourced from this snapshot workbook (Table 1) —
    # it now comes entirely from the LGA-medians workbook's full history, so
    # this parser can't produce two competing sources for the same metric.
    assert "median_rent" not in set(df.metric)

    # Unit discipline: percents vs dollar rents.
    pct = df[df.metric.isin({"rent_growth_annual", "affordable_share"})]
    assert (pct.unit == "percent").all()
    dollars = df[~df.metric.isin({"rent_growth_annual", "affordable_share"})]
    assert (dollars.unit == "AUD/week").all()

    # Time series span (period-end, quarterly).
    assert df.date.min() == "2000-06-30"
    assert df.date.max() == "2025-09-30"
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()
    # Affordable-share series only starts 2020Q3.
    assert df[df.metric == "affordable_share"].date.min() == "2020-09-30"

    # Current-quarter snapshot (September Quarter 2025).
    snap = df[df.date == "2025-09-30"].set_index(["region", "metric"])["value"]
    assert snap[("melbourne", "rent_2br_flat")] == 600
    assert snap[("regional_vic", "rent_1br_flat")] == 300
    assert snap[("melbourne", "affordable_share")] == pytest.approx(9.7, abs=0.05)
    assert snap[("regional_vic", "affordable_share")] == pytest.approx(36.4, abs=0.05)
    assert snap[("melbourne", "rent_growth_annual")] == pytest.approx(3.53, abs=0.02)

    # Sanity ranges.
    assert df[df.metric == "affordable_share"].value.between(0, 100).all()
    assert dollars.value.between(100, 2000).all()
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
    assert set(df.metric) == {"median_rent"}
    assert set(df.unit) == {"AUD/week"}
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()

    counts = df.groupby("region").size()
    assert counts["melbourne"] >= 100
    assert counts["regional_vic"] >= 100

    # Full 26-year span: Jun 1999 (period-end) -> Sep 2025 (period-end).
    assert df.date.min() == "1999-06-30"
    assert df.date.max() == "2025-09-30"

    snap = df.set_index(["date", "region"])["value"]
    # First quarter in the sheet.
    assert snap[("1999-06-30", "melbourne")] == 170
    assert snap[("1999-06-30", "regional_vic")] == 125
    # Latest quarter in the sheet (Metro/Non-Metro LGA aggregate — distinct
    # from Table 1's differently-grouped statistical-region snapshot).
    assert snap[("2025-09-30", "melbourne")] == 575
    assert snap[("2025-09-30", "regional_vic")] == 470

    assert df.value.between(100, 2000).all()
