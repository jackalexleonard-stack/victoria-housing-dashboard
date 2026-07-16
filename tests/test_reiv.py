from datetime import date
from pathlib import Path

import pytest

from pipeline import common
from pipeline.sources import reiv

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 7, 16)


def test_parse_reiv_offline():
    html = (FIX / "reiv_sample.html").read_text(encoding="utf-8")
    df = reiv.parse_reiv(html, today=TODAY)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne", "regional_vic"}
    assert set(df.metric) == {"median_house_price", "median_unit_price"}
    assert (df.unit == "AUD").all()
    assert (df.date == "2026-06-30").all()   # parsed from "June Quarter 2026"

    v = df.set_index(["region", "metric"])["value"]
    assert v[("melbourne", "median_house_price")] == 1_050_000
    assert v[("melbourne", "median_unit_price")] == 620_000
    assert v[("regional_vic", "median_house_price")] == 565_000


def test_report_quarter_falls_back_to_last_completed_quarter():
    # No quarter text -> most recently completed quarter before 2026-07-16 is Q2 (Jun).
    assert reiv._report_quarter("<html>no quarter</html>", TODAY) == "2026-06-30"
    assert reiv._report_quarter("<html>no quarter</html>", date(2026, 2, 5)) == "2025-12-31"


def test_parse_reiv_no_table_raises():
    with pytest.raises(ValueError):
        reiv.parse_reiv("<html><body>Members only. Please log in.</body></html>", today=TODAY)
