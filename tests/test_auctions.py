from datetime import date
from pathlib import Path

import pandas as pd
import pytest

from pipeline import common
from pipeline.sources import auctions

FIX = Path(__file__).parent / "fixtures"
TODAY = date(2026, 7, 16)


def test_parse_auctions_offline():
    html = (FIX / "auctions_sample.html").read_text(encoding="utf-8")
    df = auctions.parse_auctions(html, today=TODAY)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne"}
    assert set(df.metric) == {"clearance_rate", "auctions_reported"}

    v = df.set_index("metric")["value"]
    assert v["clearance_rate"] == pytest.approx(64.3, abs=0.01)   # Melbourne, not Sydney (61.0)
    assert v["auctions_reported"] == 1182

    # Dated to the auction week's Saturday.
    d = df["date"].iloc[0]
    assert pd.Timestamp(d).dayofweek == 5
    assert d <= TODAY.strftime("%Y-%m-%d")


def test_parse_auctions_no_rate_raises():
    with pytest.raises(ValueError):
        auctions.parse_auctions("<html><body>No auctions this week.</body></html>", today=TODAY)


def test_recent_saturday():
    # 2026-07-16 is a Thursday -> most recent Saturday is 2026-07-11.
    assert auctions._recent_saturday(TODAY) == "2026-07-11"
