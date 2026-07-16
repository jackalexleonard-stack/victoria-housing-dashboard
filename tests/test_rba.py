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


def test_parse_mortgage_rates_offline():
    raw = (FIX / "rba_f6_mortgage_rates.csv").read_text(encoding="utf-8")
    df = rba.parse_mortgage_rates(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"australia"}
    assert set(df.metric) == {
        "mortgage_new", "mortgage_new_fixed", "mortgage_new_variable",
        "mortgage_outstanding", "mortgage_outstanding_fixed", "mortgage_outstanding_variable",
    }
    assert (df.unit == "percent").all()
    assert df.value.between(0, 15).all()

    latest = df[df.date == "2026-05-31"].set_index("metric")["value"]
    assert latest["mortgage_outstanding"] == 6.2
    assert latest["mortgage_outstanding_fixed"] == 5.5
