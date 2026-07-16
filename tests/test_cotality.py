from pathlib import Path

import pytest

from pipeline import common
from pipeline.sources import cotality

FIX = Path(__file__).parent / "fixtures"


def _raw():
    return (FIX / "cotality_asx.json").read_bytes()


def test_parse_vic_hvi_offline():
    df = cotality.parse_vic_hvi(_raw())
    common.validate_tidy(df)
    assert set(df.region) == {"melbourne"}
    assert set(df.metric) == {"hvi_index", "hvi_change_mom", "hvi_change_yoy"}

    idx = df[df.metric == "hvi_index"].sort_values("date")
    assert len(idx) >= 300                      # ~365-day daily worm series
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()
    assert idx.iloc[-1].date == "2026-07-16"
    assert idx.iloc[-1].value == pytest.approx(180.3, abs=0.05)
    assert (df[df.metric == "hvi_index"].unit == "index").all()

    ch = df[df.metric != "hvi_index"].set_index("metric")["value"]
    assert ch["hvi_change_mom"] == pytest.approx(-1.00, abs=0.01)
    assert ch["hvi_change_yoy"] == pytest.approx(-0.89, abs=0.01)
    assert (df[df.metric.str.startswith("hvi_change")].date == "2026-06-30").all()
    assert (df[df.metric.str.startswith("hvi_change")].unit == "percent").all()


def test_parse_au_hvi_offline():
    df = cotality.parse_au_hvi(_raw())
    common.validate_tidy(df)
    assert set(df.region) == {"australia"}
    idx = df[df.metric == "hvi_index"].sort_values("date")
    assert idx.iloc[-1].value == pytest.approx(222.16, abs=0.05)
    ch = df[df.metric != "hvi_index"].set_index("metric")["value"]
    assert ch["hvi_change_mom"] == pytest.approx(-0.58, abs=0.01)
    assert ch["hvi_change_yoy"] == pytest.approx(6.13, abs=0.01)


def test_missing_location_raises():
    # A feed with no matching code should fail (so the orchestrator records it).
    with pytest.raises(ValueError):
        cotality._parse(b'{"monthName":"30 June 2026","worm":[],"monthly":[]}',
                        code="205", region="melbourne")
