from pathlib import Path

import pandas as pd
import pytest

from pipeline import common
from pipeline.sources import homes_vic as hv

FIX = Path(__file__).parent / "fixtures"


def test_quarter_to_iso():
    assert hv._quarter_to_iso("Mar-25") == "2025-03-31"
    assert hv._quarter_to_iso("Dec-25") == "2025-12-31"
    assert hv._quarter_to_iso("Mar-26") == "2026-03-31"


def test_parse_vhr_offline():
    raw = (FIX / "homes_vic_vhr.html").read_text(encoding="utf-8")
    df = hv.parse_vhr(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"vic"}
    assert set(df.metric) == {"vhr_priority", "vhr_register_of_interest", "vhr_total"}
    assert (df.unit == "applications").all()

    # Rolling 5-quarter window, period-end dates.
    assert sorted(df.date.unique()) == [
        "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31",
    ]

    latest = df[df.date == "2026-03-31"].set_index("metric")["value"]
    assert latest["vhr_total"] == 57372
    assert latest["vhr_priority"] == 32591
    assert latest["vhr_register_of_interest"] == 24781

    # Priority + Register of Interest == Total, every quarter.
    wide = df.pivot_table(index="date", columns="metric", values="value")
    assert (wide["vhr_priority"] + wide["vhr_register_of_interest"] == wide["vhr_total"]).all()

    # Waitlist is large and positive.
    assert (df.value > 1000).all()


def test_find_summary_missing_raises():
    with pytest.raises(ValueError):
        hv._find_summary([pd.DataFrame({0: ["something", "else"], 1: [1, 2]})])
