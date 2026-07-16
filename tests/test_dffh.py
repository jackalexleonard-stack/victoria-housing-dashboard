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
        "rent_growth_annual", "affordable_share", "median_rent",
        "rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
        "rent_2br_house", "rent_3br_house", "rent_4br_house",
    }
    assert set(df.metric) == expected_metrics

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
    assert snap[("melbourne", "median_rent")] == 580
    assert snap[("regional_vic", "median_rent")] == 470
    assert snap[("melbourne", "rent_2br_flat")] == 600
    assert snap[("regional_vic", "rent_1br_flat")] == 300
    assert snap[("melbourne", "affordable_share")] == pytest.approx(9.7, abs=0.05)
    assert snap[("regional_vic", "affordable_share")] == pytest.approx(36.4, abs=0.05)
    assert snap[("melbourne", "rent_growth_annual")] == pytest.approx(3.53, abs=0.02)

    # Sanity ranges.
    assert df[df.metric == "affordable_share"].value.between(0, 100).all()
    assert dollars.value.between(100, 2000).all()
    assert df[df.metric == "rent_growth_annual"].value.between(-20, 30).all()
