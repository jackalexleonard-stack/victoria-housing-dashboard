"""Urban Development Program — greenfield residential land (``vic_land``).

The UDP publishes greenfield (growth-corridor / regional fringe) land as an
annual spatial layer on Victoria's open-data GeoServer, in TWO parallel
packages: a metro Melbourne layer and a Regional Victoria layer. Each feature
is a broadhectare parcel with ``total_lots`` and a ``development_status``.

The two layers do NOT share a schema (verified live 2026-07-24):
* Metro (``gf<year>``) has a separate ``year_titled`` column alongside a plain
  ``Titled`` status; other statuses are a supply category (``Proposed`` /
  ``Zoned`` / ``Unzoned``).
* Regional (``rgf<year>``) has no ``year_titled`` column at all — the
  reporting period is folded into the status label itself, e.g.
  ``Titled 2024 H1``: finalised years carry no suffix (``Titled 2023``), but
  the current in-progress year is a running HALF-YEAR snapshot (H1/H2) until
  finalised. The regional 2024 package's own notes confirm this: "Data as of
  June 2024 ... Lots with a title between January 2020 and July 2024". Supply
  statuses (``Proposed``/``Zoned``/``Unzoned``) are identical strings in both.

From each layer we derive, per region (melbourne = the 7 metro growth-area
LGAs: Cardinia, Casey, Hume, Melton, Mitchell, Whittlesea, Wyndham; regional_vic
= the regional fringe areas the UDP tracks):
* ``greenfield_lots_titled``     — lots titled in the latest reporting period
* ``greenfield_lot_supply``      — remaining supply lots (Proposed+Zoned+Unzoned)
* ``greenfield_years_of_supply`` — supply / lots titled (transparent derivation)

CAVEAT: when regional_vic's latest bucket is a half-year snapshot (as it is
today, "Titled 2024 H1"), its ``greenfield_lots_titled``/``years_of_supply``
are on a different time basis than metro's full-year figures — NOT annualised
here (that would fabricate data the source never published). The date field
reflects this precisely (H1 -> <year>-06-30, H2 -> <year>-12-31, no suffix ->
<year>-12-31), so the two regions' points land on genuinely different x-axis
dates when this applies.

A single layer reports one year's (or half-year's) titling, so this is close
to an annual observation; the pipeline appends a fresh point as each layer's
next vintage publishes (git history keeps each vintage). The GeoServer caps a
response at 5000 features, so we paginate with ``startIndex`` for BOTH layers;
current layer names are discovered from the data.vic.gov.au CKAN catalogue
rather than hardcoded. Region is derived per row from its WFS feature id
(``gf<year>.N`` -> melbourne, ``rgf<year>.N`` -> regional_vic — GeoServer's
CSV writer always includes this ``<layer-local-name>.<id>`` FID column,
verified live for both layers) rather than tagged at fetch time, so the raw
payload saved as the fixture is exactly what the WFS server returns.

Discovery:  CKAN package_search 'urban development program greenfield residential
            land' -> newest metro AND newest regional package (if published) ->
            WFS layer id from each package's resource URL
Data:       WFS GetFeature (outputFormat=csv) on opendata.maps.vic.gov.au
Verified live 2026-07-16 (layer gf2025: 18,543 lots titled 2024; ~18 yrs supply).
Regional verified live 2026-07-24: package
urban-development-program-regional-greenfield-residential-land-2024, layer
open-data-platform:rgf2024, 43,331 features (2,625 lots titled 2024 H1;
187,819 supply lots; ~71.6 "years" on that half-year basis — see caveat above).
"""
from __future__ import annotations

import io
import re

import pandas as pd

from pipeline import common

CKAN = "https://discover.data.vic.gov.au/api/3/action/package_search"
WFS = "https://opendata.maps.vic.gov.au/geoserver/wfs"
_CKAN_QUERY = "urban development program greenfield residential land"
_PKG_RE = re.compile(
    r"^urban-development-program-(regional-)?greenfield-residential-land-(\d{4})$"
)
_LAYER_RE = re.compile(r"open-data-platform:((?:r)?gf\d{4})", re.I)
_PAGE = 5000
_PROPS = "year_titled,development_status,total_lots,lga"
_REGIONAL_PROPS = "development_status,total_lots,lga"
_SUPPLY_STATUS = {"Proposed", "Zoned", "Unzoned"}

# Region derived from each row's WFS feature id (see module docstring).
_FID_KIND_RE = re.compile(r"^(r?gf)\d+\.", re.I)
_KIND_REGION = {"gf": "melbourne", "rgf": "regional_vic"}

# Regional's status label folds the reporting period into the text itself.
_STATUS_TITLED_RE = re.compile(r"^Titled\s+(?P<year>\d{4})(?:\s+(?P<half>H[12]))?$")


def discover_layer(pkg_results: list[dict], *, regional: bool = False) -> str:
    """Return the WFS layer id (``open-data-platform:<gf|rgf><year>``) of the
    newest {metro,regional} greenfield package that exposes a spatial
    service."""
    best: tuple[int, str] | None = None
    for pkg in pkg_results:
        m = _PKG_RE.match(pkg.get("name", ""))
        if not m:
            continue
        is_regional = m.group(1) is not None
        if is_regional != regional:
            continue
        year = int(m.group(2))
        layer = None
        for rsrc in pkg.get("resources", []):
            lm = _LAYER_RE.search(rsrc.get("url", "") or "")
            if lm:
                layer = f"open-data-platform:{lm.group(1)}"
                break
        if layer and (best is None or year > best[0]):
            best = (year, layer)
    if best is None:
        kind = "regional" if regional else "metro"
        raise ValueError(f"no {kind} greenfield WFS layer found in the UDP catalogue")
    return best[1]


def _wfs_page(layer: str, start: int, props: str) -> pd.DataFrame:
    params = {
        "service": "WFS", "version": "2.0.0", "request": "GetFeature",
        "typeNames": layer, "outputFormat": "csv",
        "count": str(_PAGE), "startIndex": str(start), "propertyName": props,
    }
    text = common.fetch(WFS, params=params, timeout=120).text
    return pd.read_csv(io.StringIO(text))


def _paginate(layer: str, props: str) -> pd.DataFrame:
    """Page a WFS layer's full attribute table (5000-feature cap)."""
    frames, start = [], 0
    while True:
        page = _wfs_page(layer, start, props)
        frames.append(page)
        if len(page) < _PAGE:
            break
        start += _PAGE
    return pd.concat(frames, ignore_index=True)


def fetch_greenfield() -> str:
    """Discover the current metro (+ regional, if published) greenfield
    layers and page each layer's full attribute table (returns a single
    combined CSV, saved as the fixture)."""
    results = common.fetch(CKAN, params={"q": _CKAN_QUERY, "rows": 50}).json()["result"]["results"]

    metro_layer = discover_layer(results)
    frames = [_paginate(metro_layer, _PROPS)]

    try:
        regional_layer = discover_layer(results, regional=True)
    except ValueError:
        regional_layer = None
    if regional_layer:
        frames.append(_paginate(regional_layer, _REGIONAL_PROPS))

    return pd.concat(frames, ignore_index=True).to_csv(index=False)


def _region_from_fid(fid) -> str:
    m = _FID_KIND_RE.match(str(fid))
    if not m:
        raise ValueError(f"cannot determine greenfield region from feature id {fid!r}")
    return _KIND_REGION[m.group(1).lower()]


def _period_end_for(year: int, half: str | None) -> str:
    if half == "H1":
        return common.period_end(f"{year}-06")
    if half == "H2":
        return common.period_end(f"{year}-12")
    return common.period_end(str(year))  # -> YYYY-12-31


def _titled(region: str, df: pd.DataFrame) -> tuple[str, float]:
    """Return (period-end date, total lots titled) for the most recent
    reporting period available for ``region`` (see module docstring for why
    metro and regional_vic use different columns)."""
    if region == "melbourne":
        titled = df[df["development_status"] == "Titled"]
        years = pd.to_numeric(titled["year_titled"], errors="coerce")
        valid = years.dropna()
        if valid.empty:
            raise ValueError(f"no titled lots with a reporting year for {region}")
        year = int(valid.max())
        lots = float(titled.loc[years == year, "total_lots"].sum())
        return _period_end_for(year, None), lots

    extracted = df["development_status"].astype(str).str.extract(_STATUS_TITLED_RE)
    years = pd.to_numeric(extracted["year"], errors="coerce")
    valid = years.dropna()
    if valid.empty:
        raise ValueError(f"no titled lots with a reporting year for {region}")
    year = int(valid.max())
    mask = years == year
    halves = extracted.loc[mask, "half"].dropna().unique()
    half = halves[0] if len(halves) else None
    lots = float(df.loc[mask, "total_lots"].sum())
    return _period_end_for(year, half), lots


def parse_greenfield(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw))
    df["_region"] = df["FID"].map(_region_from_fid)

    rows = []
    for region, region_df in df.groupby("_region"):
        date, lots_titled = _titled(region, region_df)
        supply = float(
            region_df.loc[region_df["development_status"].isin(_SUPPLY_STATUS), "total_lots"].sum()
        )
        years_of_supply = round(supply / lots_titled, 1) if lots_titled else float("nan")
        rows += [
            (date, region, "greenfield_lots_titled", lots_titled, "lots"),
            (date, region, "greenfield_lot_supply", supply, "lots"),
            (date, region, "greenfield_years_of_supply", years_of_supply, "years"),
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
