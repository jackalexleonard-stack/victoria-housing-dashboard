from pathlib import Path

from pipeline import common
from pipeline.sources import rba

FIX = Path(__file__).parent / "fixtures"


def test_parse_cash_rate_offline():
    raw = (FIX / "rba_f11_cash_rate.csv").read_text(encoding="utf-8")
    df = rba.parse_cash_rate(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"australia"}
    assert set(df.metric) == {"cash_rate"}
    assert (df.unit == "percent").all()
    assert df.value.between(0, 20).all()  # sane cash-rate range

    latest = df.sort_values("date").iloc[-1]
    assert latest.date == "2026-06-30"
    assert latest.value == 4.35
