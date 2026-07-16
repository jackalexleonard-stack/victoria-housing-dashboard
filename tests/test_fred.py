from pathlib import Path

from pipeline import common
from pipeline.sources import fred

FIX = Path(__file__).parent / "fixtures"


def test_parse_fred_offline():
    raw = (FIX / "fred_intl.json").read_text(encoding="utf-8")
    df = fred.parse_fred(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"global"}
    assert set(df.metric) == {"brent_crude", "us_10y_treasury", "aud_usd"}
    assert set(df.unit) == {"usd_per_barrel", "percent", "usd_per_aud"}

    # sane ranges for each indicator
    assert df[df.metric == "brent_crude"].value.between(0, 200).all()
    assert df[df.metric == "us_10y_treasury"].value.between(0, 10).all()
    assert df[df.metric == "aud_usd"].value.between(0.4, 1.0).all()

    latest_t = df[df.metric == "us_10y_treasury"].sort_values("date").iloc[-1]
    assert latest_t.value == 4.58

    # FRED missing values ("."), if any, are dropped -> all values numeric
    assert df.value.notna().all()
