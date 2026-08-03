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


def test_discover_layer_regional_picks_newest_regional_greenfield():
    results = [
        _pkg("urban-development-program-greenfield-residential-land-2025", "gf2025"),
        _pkg("urban-development-program-regional-greenfield-residential-land-2023", "rgf2023"),
        _pkg("urban-development-program-regional-greenfield-residential-land-2024", "rgf2024"),
    ]
    assert udp.discover_layer(results, regional=True) == "open-data-platform:rgf2024"


def test_discover_layer_regional_missing_raises():
    with pytest.raises(ValueError):
        udp.discover_layer(
            [_pkg("urban-development-program-greenfield-residential-land-2025", "gf2025")],
            regional=True,
        )


def test_parse_greenfield_offline():
    raw = (FIX / "udp_greenfield.csv").read_text(encoding="utf-8")
    df = udp.parse_greenfield(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne"}
    assert (df.date == "2024-12-31").all()
    assert set(df.metric) == {
        "greenfield_lots_titled", "greenfield_lot_supply",
        "greenfield_lot_supply_zoned", "greenfield_lot_supply_unzoned",
        "greenfield_years_of_supply",
    }

    v = df.set_index("metric")
    assert v.loc["greenfield_lots_titled", "value"] == 18543
    assert v.loc["greenfield_lot_supply", "value"] == 334019
    # Zoned/unzoned split of the same supply total (verified against DTP's
    # UDP 2025 Melbourne page AND live WFS 2026-08-03): zoned = Proposed
    # 39,812 + Zoned englobo 165,671 (gazetted PSP); unzoned = 128,536
    # englobo lots still awaiting a PSP. The split partitions supply exactly.
    assert v.loc["greenfield_lot_supply_zoned", "value"] == 205483
    assert v.loc["greenfield_lot_supply_unzoned", "value"] == 128536
    assert (v.loc["greenfield_lot_supply_zoned", "value"]
            + v.loc["greenfield_lot_supply_unzoned", "value"]
            == v.loc["greenfield_lot_supply", "value"])
    assert v.loc["greenfield_lots_titled", "unit"] == "lots"
    assert v.loc["greenfield_lot_supply_zoned", "unit"] == "lots"
    assert v.loc["greenfield_lot_supply_unzoned", "unit"] == "lots"
    assert v.loc["greenfield_years_of_supply", "unit"] == "years"

    # years-of-supply is supply / lots-titled.
    yos = v.loc["greenfield_lot_supply", "value"] / v.loc["greenfield_lots_titled", "value"]
    assert v.loc["greenfield_years_of_supply", "value"] == pytest.approx(round(yos, 1), abs=0.05)
    assert 5 < v.loc["greenfield_years_of_supply", "value"] < 40  # sane supply horizon


def test_parse_greenfield_parses_the_fixture_into_tidy_rows_with_the_expected_regions():
    """Shared template (docs/superpowers/plans/2026-07-23-geo-scoping.md,
    "Shared test template"). Fixture is a REAL combined WFS dump: the
    existing metro fixture (unchanged) concatenated with a freshly fetched
    full regional layer (rgf2024, live-verified 2026-07-24: package
    urban-development-program-regional-greenfield-residential-land-2024,
    layer open-data-platform:rgf2024, 43,331 features)."""
    raw = (FIX / "udp_greenfield_regional.csv").read_text(encoding="utf-8")
    df = udp.parse_greenfield(raw)

    # Schema is fixed law for every series in this repo.
    assert list(df.columns) == ["date", "region", "metric", "value", "unit"]
    # (1) The regions this source is being added FOR.
    assert set(df["region"]) == {"melbourne", "regional_vic"}
    # (2) Metrics are the ones the chart will plot, nothing stray.
    assert set(df["metric"]) == {
        "greenfield_lots_titled", "greenfield_lot_supply",
        "greenfield_lot_supply_zoned", "greenfield_lot_supply_unzoned",
        "greenfield_years_of_supply",
    }
    # (3) Spot value hand-verified against the fixture (independent pandas
    # aggregation, not via the parser): regional_vic's latest titled bucket
    # is "Titled 2024 H1" (a running half-year snapshot -- the regional
    # layer has no separate year_titled column, unlike metro), summing to
    # 2,625 lots as of the June-2024 cutoff the CKAN package notes state.
    row = df[
        (df.region == "regional_vic") & (df.date == "2024-06-30")
        & (df.metric == "greenfield_lots_titled")
    ]
    assert len(row) == 1 and row.iloc[0]["value"] == 2625

    assert df["value"].notna().all()
    assert not df.duplicated(["date", "region", "metric"]).any()

    # The metro path must still parse EXACTLY as before (same fixture bytes
    # as udp_greenfield.csv, mixed into this combined raw payload).
    v = df.set_index(["region", "metric"])
    assert v.loc[("melbourne", "greenfield_lots_titled"), "value"] == 18543
    assert v.loc[("melbourne", "greenfield_lot_supply"), "value"] == 334019
    assert v.loc[("melbourne", "greenfield_lots_titled"), "date"] == "2024-12-31"

    # Regional's supply figure and derived years-of-supply.
    assert v.loc[("regional_vic", "greenfield_lot_supply"), "value"] == 187819
    assert v.loc[("regional_vic", "greenfield_years_of_supply"), "value"] == pytest.approx(71.6, abs=0.05)

    # Zoned/unzoned split, both regions (independent pandas aggregation of
    # the fixture, cross-checked live 2026-08-03; metro also matches DTP's
    # UDP 2025 Melbourne page): zoned = Proposed + Zoned englobo (gazetted
    # PSP), unzoned = englobo awaiting a PSP — partitions supply exactly.
    assert v.loc[("melbourne", "greenfield_lot_supply_zoned"), "value"] == 205483
    assert v.loc[("melbourne", "greenfield_lot_supply_unzoned"), "value"] == 128536
    assert v.loc[("regional_vic", "greenfield_lot_supply_zoned"), "value"] == 76022
    assert v.loc[("regional_vic", "greenfield_lot_supply_unzoned"), "value"] == 111797
    for region in ("melbourne", "regional_vic"):
        assert (v.loc[(region, "greenfield_lot_supply_zoned"), "value"]
                + v.loc[(region, "greenfield_lot_supply_unzoned"), "value"]
                == v.loc[(region, "greenfield_lot_supply"), "value"])
