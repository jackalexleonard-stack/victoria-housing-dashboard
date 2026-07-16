"""ABS Data API sources (SDMX REST, no key required).

All dataflow IDs and dimension keys below were discovered and verified live
against the ABS Data API / Data Explorer (working rule: never invent them).
Request format is SDMX-CSV (``Accept: application/vnd.sdmx.data+csv``); the
flow reference omits the version so the API serves the latest.

Dimension order for BA_GCCSA (verified via the datastructure endpoint):
``MEASURE.VALUE.SECTOR.WORK_TYPE.BUILDING_TYPE.TSEST.REGION.FREQ``
"""
from __future__ import annotations

import io

import pandas as pd

from pipeline import common

ABS_BASE = "https://data.api.abs.gov.au/rest/data"

# Shared GCCSA region codes -> tidy region labels.
_REGION_VIC = {"2": "vic", "2GMEL": "melbourne", "2RVIC": "regional_vic"}


def abs_csv(flow: str, key: str, *, start: str | None = None) -> str:
    """Fetch an ABS dataflow slice as SDMX-CSV text (latest version)."""
    url = f"{ABS_BASE}/{flow}/{key}"
    params = {"startPeriod": start} if start else None
    resp = common.fetch(
        url, headers={"Accept": "application/vnd.sdmx.data+csv"}, params=params
    )
    return resp.text


# ---------------------------------------------------------------------------
# vic_approvals — Building Approvals (BA_GCCSA), Number of new dwelling units
# GET https://data.api.abs.gov.au/rest/data/BA_GCCSA/1.1.9.1.110+150+100.10.2+2GMEL+2RVIC.M
#   MEASURE=1 Number of dwelling units · VALUE=1 Total · SECTOR=9 Total Sectors
#   WORK_TYPE=1 New · BUILDING_TYPE 110 Houses / 150 Total Other Residential /
#   100 Total Residential · TSEST=10 Original (only estimate at GCCSA level)
#   REGION 2 Victoria / 2GMEL Greater Melbourne / 2RVIC Rest of Vic · FREQ=M
# ---------------------------------------------------------------------------
_APPROVALS_KEY = "1.1.9.1.110+150+100.10.2+2GMEL+2RVIC.M"
_APPROVALS_METRIC = {
    "100": "approvals_dwellings_total",
    "110": "approvals_houses",
    "150": "approvals_other_residential",
}


def fetch_approvals() -> str:
    return abs_csv("BA_GCCSA", _APPROVALS_KEY)


def parse_approvals(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw))
    df = df[df["OBS_VALUE"].notna()]
    out = pd.DataFrame(
        {
            "date": df["TIME_PERIOD"].map(common.period_end),
            "region": df["REGION"].astype(str).map(_REGION_VIC),
            "metric": df["BUILDING_TYPE"].astype(str).map(_APPROVALS_METRIC),
            "value": pd.to_numeric(df["OBS_VALUE"]),
            "unit": "dwellings",
        }
    )
    return out.dropna(subset=["region", "metric"]).reset_index(drop=True)


SERIES = [
    common.Series(
        id="vic_approvals",
        source_name="ABS Building Approvals (BA_GCCSA)",
        source_url=f"{ABS_BASE}/BA_GCCSA/{_APPROVALS_KEY}",
        frequency="monthly",
        fetch=fetch_approvals,
        parse=parse_approvals,
    ),
]
