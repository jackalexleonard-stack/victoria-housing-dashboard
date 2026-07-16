"""Urban Development Program — greenfield residential land (``vic_land``).

The UDP publishes Melbourne's greenfield (growth-corridor) land as an annual
spatial layer on Victoria's open-data GeoServer. Each feature is a broadhectare
parcel with ``total_lots`` and a ``development_status`` (Titled / Zoned / Unzoned
/ Proposed); ``year_titled`` carries the reporting year for parcels titled that
year, or a supply category (``EngloboSupply`` / ``ProposedOnly``) otherwise.

From the current layer we derive, for metro Melbourne (the 7 growth-area LGAs:
Cardinia, Casey, Hume, Melton, Mitchell, Whittlesea, Wyndham):
* ``greenfield_lots_titled``     — lots titled in the reporting year
* ``greenfield_lot_supply``      — remaining supply lots (Proposed+Zoned+Unzoned)
* ``greenfield_years_of_supply`` — supply / lots titled (transparent derivation)

A single layer reports one year's titling, so this is an annual observation; the
pipeline appends a fresh point when next year's layer publishes (git history keeps
each vintage). The GeoServer caps a response at 5000 features, so we paginate with
``startIndex``; the current layer name (``gf<year>``) is discovered from the
data.vic.gov.au CKAN catalogue rather than hardcoded.

Discovery:  CKAN package_search 'urban development program greenfield residential
            land' -> newest metro package -> WFS layer id from its resource URL
Data:       WFS GetFeature (outputFormat=csv) on opendata.maps.vic.gov.au
Verified live 2026-07-16 (layer gf2025: 18,543 lots titled 2024; ~18 yrs supply).
"""
from __future__ import annotations

import io
import re

import pandas as pd

from pipeline import common

CKAN = "https://discover.data.vic.gov.au/api/3/action/package_search"
WFS = "https://opendata.maps.vic.gov.au/geoserver/wfs"
_CKAN_QUERY = "urban development program greenfield residential land"
_PKG_RE = re.compile(r"^urban-development-program-greenfield-residential-land-(\d{4})$")
_LAYER_RE = re.compile(r"open-data-platform:(gf\d{4})", re.I)
_PAGE = 5000
_PROPS = "year_titled,development_status,total_lots,lga"
_SUPPLY_STATUS = {"Proposed", "Zoned", "Unzoned"}


def discover_layer(pkg_results: list[dict]) -> str:
    """Return the WFS layer id (``open-data-platform:gf<year>``) of the newest
    metro greenfield package that exposes a spatial service."""
    best: tuple[int, str] | None = None
    for pkg in pkg_results:
        m = _PKG_RE.match(pkg.get("name", ""))
        if not m:
            continue
        year = int(m.group(1))
        layer = None
        for rsrc in pkg.get("resources", []):
            lm = _LAYER_RE.search(rsrc.get("url", "") or "")
            if lm:
                layer = f"open-data-platform:{lm.group(1)}"
                break
        if layer and (best is None or year > best[0]):
            best = (year, layer)
    if best is None:
        raise ValueError("no greenfield WFS layer found in the UDP catalogue")
    return best[1]


def _wfs_page(layer: str, start: int) -> pd.DataFrame:
    params = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": layer, "outputFormat": "csv",
        "count": str(_PAGE), "startIndex": str(start), "propertyName": _PROPS,
    }
    text = common.fetch(WFS, params=params, timeout=120).text
    return pd.read_csv(io.StringIO(text))


def fetch_greenfield() -> str:
    """Discover the current greenfield layer and page its full attribute table
    (returns a single combined CSV, saved as the fixture)."""
    results = common.fetch(CKAN, params={"q": _CKAN_QUERY, "rows": 50}).json()
    layer = discover_layer(results["result"]["results"])
    frames, start = [], 0
    while True:
        page = _wfs_page(layer, start)
        frames.append(page)
        if len(page) < _PAGE:
            break
        start += _PAGE
    return pd.concat(frames, ignore_index=True).to_csv(index=False)


def parse_greenfield(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw))
    df["yt"] = pd.to_numeric(df["year_titled"], errors="coerce")

    titled = df[df["development_status"] == "Titled"]
    years = titled["yt"].dropna()
    if years.empty:
        raise ValueError("no titled lots with a reporting year in greenfield layer")
    year = int(years.max())
    date = common.period_end(str(year))  # -> YYYY-12-31

    lots_titled = float(titled.loc[titled["yt"] == year, "total_lots"].sum())
    supply = float(df.loc[df["development_status"].isin(_SUPPLY_STATUS), "total_lots"].sum())
    years_of_supply = round(supply / lots_titled, 1) if lots_titled else float("nan")

    rows = [
        (date, "melbourne", "greenfield_lots_titled", lots_titled, "lots"),
        (date, "melbourne", "greenfield_lot_supply", supply, "lots"),
        (date, "melbourne", "greenfield_years_of_supply", years_of_supply, "years"),
    ]
    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="vic_land",
        source_name="Urban Development Program — Greenfield Residential Land (DTP)",
        source_url="https://www.land.vic.gov.au/valuations/resources-and-reports/urban-development-program",
        frequency="annual",
        fetch=fetch_greenfield,
        parse=parse_greenfield,
    ),
]
