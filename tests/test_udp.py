from pathlib import Path

import pytest

from pipeline import common
from pipeline.sources import udp

FIX = Path(__file__).parent / "fixtures"


def _pkg(name, layer=None):
    resources = []
    if layer:
        resources = [{"url": f"https://opendata.maps.vic.gov.au/geoserver/wms?layers=open-data-platform:{layer}"}]
    return {"name": name, "resources": resources}


def test_discover_layer_picks_newest_metro_greenfield():
    results = [
        _pkg("urban-development-program-greenfield-residential-land-2022", "gf2022"),
        _pkg("urban-development-program-greenfield-residential-land-2025", "gf2025"),
        _pkg("urban-development-program-regional-greenfield-residential-land-2024", "rgf2024"),
        _pkg("urban-development-program-industrial-land-2025", "ind2025"),
    ]
    assert udp.discover_layer(results) == "open-data-platform:gf2025"


def test_discover_layer_missing_raises():
    with pytest.raises(ValueError):
        udp.discover_layer([_pkg("some-unrelated-dataset")])


def test_parse_greenfield_offline():
    raw = (FIX / "udp_greenfield.csv").read_text(encoding="utf-8")
    df = udp.parse_greenfield(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne"}
    assert (df.date == "2024-12-31").all()
    assert set(df.metric) == {
        "greenfield_lots_titled", "greenfield_lot_supply", "greenfield_years_of_supply",
    }

    v = df.set_index("metric")
    assert v.loc["greenfield_lots_titled", "value"] == 18543
    assert v.loc["greenfield_lot_supply", "value"] == 334019
    assert v.loc["greenfield_lots_titled", "unit"] == "lots"
    assert v.loc["greenfield_years_of_supply", "unit"] == "years"

    # years-of-supply is supply / lots-titled.
    yos = v.loc["greenfield_lot_supply", "value"] / v.loc["greenfield_lots_titled", "value"]
    assert v.loc["greenfield_years_of_supply", "value"] == pytest.approx(round(yos, 1), abs=0.05)
    assert 5 < v.loc["greenfield_years_of_supply", "value"] < 40  # sane supply horizon
