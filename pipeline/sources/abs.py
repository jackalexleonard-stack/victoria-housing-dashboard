"""ABS Data API sources (SDMX REST, no key required).

All dataflow IDs and dimension keys below were discovered and verified live
against the ABS Data API / Data Explorer (working rule: never invent them).
Request format is SDMX-CSV (``Accept: application/vnd.sdmx.data+csv``); the
flow reference omits the version so the API serves the latest.
"""
from __future__ import annotations

import io

import pandas as pd

from pipeline import common

ABS_BASE = "https://data.api.abs.gov.au/rest/data"

# Shared region-code -> tidy label maps.
_REGION_GCCSA_VIC = {"2": "vic", "2GMEL": "melbourne", "2RVIC": "regional_vic"}
_REGION_STATE = {"2": "vic", "AUS": "australia"}


def abs_csv(flow: str, key: str, *, start: str | None = None) -> str:
    """Fetch an ABS dataflow slice as SDMX-CSV text (latest version)."""
    url = f"{ABS_BASE}/{flow}/{key}"
    params = {"startPeriod": start} if start else None
    resp = common.fetch(
        url, headers={"Accept": "application/vnd.sdmx.data+csv"}, params=params
    )
    return resp.text


def _tidy(df: pd.DataFrame, *, metric_col, metric_map, unit,
          region_col=None, region_map=None, region_const=None) -> pd.DataFrame:
    """Shared ABS SDMX-CSV -> tidy long transform. Region comes either from a
    column (``region_col`` + ``region_map``) or is a constant (``region_const``)."""
    df = df[df["OBS_VALUE"].notna()]
    region = region_const if region_const is not None else df[region_col].astype(str).map(region_map)
    out = pd.DataFrame(
        {
            "date": df["TIME_PERIOD"].map(common.period_end),
            "region": region,
            "metric": df[metric_col].astype(str).map(metric_map),
            "value": pd.to_numeric(df["OBS_VALUE"]),
            "unit": unit,
        }
    )
    return out.dropna(subset=["region", "metric"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# vic_approvals — Building Approvals (BA_GCCSA), number of new dwelling units
# key order: MEASURE.VALUE.SECTOR.WORK_TYPE.BUILDING_TYPE.TSEST.REGION.FREQ
# GET .../BA_GCCSA/1.1.9.1.110+150+100.10.2+2GMEL+2RVIC.M
#   1 Number of dwelling units · 1 Total value-range · 9 Total Sectors ·
#   WORK_TYPE 1 New · BUILDING_TYPE 110 Houses / 150 Total Other Residential /
#   100 Total Residential · TSEST 10 Original · REGION Vic/GtrMelb/RestOfVic · M
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
    return _tidy(
        pd.read_csv(io.StringIO(raw)),
        region_col="REGION", region_map=_REGION_GCCSA_VIC,
        metric_col="BUILDING_TYPE", metric_map=_APPROVALS_METRIC,
        unit="dwellings",
    )


# ---------------------------------------------------------------------------
# vic_activity — Building Activity (BUILDING_ACTIVITY), dwelling unit counts
# key order: MEASURE.REGION.PRICE_ADJ.BLD_WORK_TYPE.SECTOR_OWN.TYPE_BLDG.TSEST.FREQ
# GET .../BUILDING_ACTIVITY/M6+M7+M8.2+AUS.CUR.1.9.100.10.Q
#   M6 commenced / M7 completed / M8 under construction · REGION 2 Vic + AUS
#   (national completions feed the Housing Accord) · CUR · New · Total Sectors ·
#   TYPE_BLDG 100 Total Residential · TSEST 10 Original · Quarterly
# ---------------------------------------------------------------------------
_ACTIVITY_KEY = "M6+M7+M8.2+AUS.CUR.1.9.100.10.Q"
_ACTIVITY_METRIC = {
    "M6": "dwellings_commenced",
    "M7": "dwellings_completed",
    "M8": "dwellings_under_construction",
}


def fetch_activity() -> str:
    return abs_csv("BUILDING_ACTIVITY", _ACTIVITY_KEY)


def parse_activity(raw: str) -> pd.DataFrame:
    return _tidy(
        pd.read_csv(io.StringIO(raw)),
        region_col="REGION", region_map=_REGION_STATE,
        metric_col="MEASURE", metric_map=_ACTIVITY_METRIC,
        unit="dwellings",
    )


# ---------------------------------------------------------------------------
# vic_input_costs — Producer Price Indexes (PPI), inputs to house construction
# key order: MEASURE.INDEX.TYPE.FREQ
# GET .../PPI/1.8102576+8104602+8104643+8104620.INPUT.Q
#   MEASURE 1 Index Number · INDEX (Melbourne series): 8102576 All groups /
#   8104602 Timber, board & joinery / 8104643 Steel products / 8104620 Cement
#   products · TYPE INPUT · Quarterly.  (Region is encoded in the INDEX code.)
# ---------------------------------------------------------------------------
_INPUT_KEY = "1.8102576+8104602+8104643+8104620.INPUT.Q"
_INPUT_METRIC = {
    "8102576": "input_all_groups",
    "8104602": "input_timber",
    "8104643": "input_steel",
    "8104620": "input_cement",
}


def fetch_input_costs() -> str:
    return abs_csv("PPI", _INPUT_KEY)


def parse_input_costs(raw: str) -> pd.DataFrame:
    return _tidy(
        pd.read_csv(io.StringIO(raw)),
        region_const="melbourne",
        metric_col="INDEX", metric_map=_INPUT_METRIC,
        unit="index",
    )


SERIES = [
    common.Series(
        id="vic_approvals",
        source_name="ABS Building Approvals (BA_GCCSA)",
        source_url=f"{ABS_BASE}/BA_GCCSA/{_APPROVALS_KEY}",
        frequency="monthly",
        fetch=fetch_approvals,
        parse=parse_approvals,
    ),
    common.Series(
        id="vic_activity",
        source_name="ABS Building Activity (BUILDING_ACTIVITY)",
        source_url=f"{ABS_BASE}/BUILDING_ACTIVITY/{_ACTIVITY_KEY}",
        frequency="quarterly",
        fetch=fetch_activity,
        parse=parse_activity,
    ),
    common.Series(
        id="vic_input_costs",
        source_name="ABS Producer Price Indexes — House construction inputs (PPI)",
        source_url=f"{ABS_BASE}/PPI/{_INPUT_KEY}",
        frequency="quarterly",
        fetch=fetch_input_costs,
        parse=parse_input_costs,
    ),
]
