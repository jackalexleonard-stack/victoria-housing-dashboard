from pathlib import Path

import pytest

from pipeline import common
from pipeline.sources import worldbank

FIX = Path(__file__).parent / "fixtures"


def test_discover_url_from_page_html():
    html = (
        '<a href="https://thedocs.worldbank.org/en/doc/'
        'abc123-0050012026/related/CMO-Historical-Data-Annual.xlsx">annual</a>'
        '<a href="https://thedocs.worldbank.org/en/doc/'
        'abc123-0050012026/related/CMO-Historical-Data-Monthly.xlsx">monthly</a>'
    )
    url = worldbank.discover_url(html)
    assert url.endswith("CMO-Historical-Data-Monthly.xlsx")
    assert "Annual" not in url


def test_discover_url_missing_raises():
    with pytest.raises(ValueError):
        worldbank.discover_url("<html>no link here</html>")


def test_parse_pink_sheet_offline():
    raw = (FIX / "worldbank_pink_sheet.xlsx").read_bytes()
    df = worldbank.parse_pink_sheet(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"global"}
    assert set(df.metric) == {"iron_ore", "copper", "sawnwood"}

    units = df.drop_duplicates("metric").set_index("metric")["unit"]
    assert units["iron_ore"] == "USD/dmtu"
    assert units["copper"] == "USD/tonne"
    assert units["sawnwood"] == "USD/m3"

    # Window starts 2015 (period-end of 2015M01) and is monthly period-end.
    assert df.date.min() == "2015-01-31"
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()

    # Latest fixture vintage: June 2026.
    latest = df[df.date == "2026-06-30"].set_index("metric")["value"]
    assert latest["iron_ore"] == pytest.approx(100.8, abs=0.05)
    assert latest["copper"] == pytest.approx(13552, abs=1)
    assert latest["sawnwood"] == pytest.approx(726.8, abs=0.05)

    # Values are positive prices.
    assert (df.value > 0).all()
