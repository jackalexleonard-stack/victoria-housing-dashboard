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
_REGION_GCCSA_VIC = {
    "2": "vic",
    "2GMEL": "melbourne",
    "2RVIC": "regional_vic",
    "AUS": "australia",
}
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
# GET .../BA_GCCSA/1.1.9.1.110+150+100.10.2+2GMEL+2RVIC+AUS.M
#   1 Number of dwelling units · 1 Total value-range · 9 Total Sectors ·
#   WORK_TYPE 1 New · BUILDING_TYPE 110 Houses / 150 Total Other Residential /
#   100 Total Residential · TSEST 10 Original ·
#   REGION Vic/GtrMelb/RestOfVic/Australia · M
# ---------------------------------------------------------------------------
_APPROVALS_KEY = "1.1.9.1.110+150+100.10.2+2GMEL+2RVIC+AUS.M"
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


# ---------------------------------------------------------------------------
# au_lending — Lending Indicators, Housing Finance (LEND_HOUSING), quarterly
# key: MEASURE.DATA_ITEM.LOAN_TYPE.LOAN_PURPOSE.LENDER_TYPE.HOUSING_PURPOSE.TSEST.REGION.FREQ
# GET .../LEND_HOUSING/FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL+TOTHOUS.TOT.DV5167+DV5168+DV5167_FHB+TOT.20.2+AUS.Q
#   Value of new loan commitments ($m), total fixed-term+revolving, Total lender,
#   Seasonally Adjusted, Victoria + Australia.  Borrower split is HOUSING_PURPOSE:
#   OO / Investor / Total sit under LOAN_PURPOSE=TOTDWELL, First-home-buyer under
#   TOTHOUS — each borrower type has a unique HOUSING_PURPOSE, so we map on that.
# ---------------------------------------------------------------------------
_LENDING_KEY = (
    "FIN_VAL.NEWCOMMITS.DV8368.TOTDWELL+TOTHOUS.TOT."
    "DV5167+DV5168+DV5167_FHB+TOT.20.2+AUS.Q"
)
_LENDING_METRIC = {
    "DV5167": "lending_owner_occupier",
    "DV5168": "lending_investor",
    "DV5167_FHB": "lending_first_home_buyer",
    "TOT": "lending_total",
}


def fetch_lending() -> str:
    return abs_csv("LEND_HOUSING", _LENDING_KEY)


def parse_lending(raw: str) -> pd.DataFrame:
    return _tidy(
        pd.read_csv(io.StringIO(raw)),
        region_col="REGION", region_map=_REGION_STATE,
        metric_col="HOUSING_PURPOSE", metric_map=_LENDING_METRIC,
        unit="aud_million",
    )


# ---------------------------------------------------------------------------
# au_population — Population & components of change (ERP_COMP_Q), quarterly
# key order: MEASURE.REGION.FREQ · GET .../ERP_COMP_Q/3+9+10.2+AUS.Q
#   MEASURE 10 Estimated Resident Population / 9 Net Overseas Migration /
#   3 Natural Increase · REGION 2 Victoria + AUS.  These three measures are
#   consistently UNIT_MULT=3 (thousands); we scale by 10^UNIT_MULT to persons.
#   Quarterly population growth is DERIVED from the ERP level's QoQ change
#   (the dataflow's own "change over previous quarter" measure has an
#   inconsistent multiplier, so we compute it ourselves).
# ---------------------------------------------------------------------------
_POP_KEY = "3+9+10.2+AUS.Q"
_POP_METRIC = {
    "10": "population_erp",
    "9": "net_overseas_migration",
    "3": "natural_increase",
}


def fetch_population() -> str:
    return abs_csv("ERP_COMP_Q", _POP_KEY)


def parse_population(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw))
    df = df[df["OBS_VALUE"].notna()]
    mult = pd.to_numeric(df["UNIT_MULT"], errors="coerce").fillna(0)
    base = pd.DataFrame(
        {
            "date": df["TIME_PERIOD"].map(common.period_end),
            "region": df["REGION"].astype(str).map(_REGION_STATE),
            "metric": df["MEASURE"].astype(str).map(_POP_METRIC),
            "value": (pd.to_numeric(df["OBS_VALUE"]) * (10.0 ** mult)).round(),
            "unit": "persons",
        }
    ).dropna(subset=["region", "metric"])

    # Derive quarter-on-quarter population growth from the ERP level.
    erp = base[base.metric == "population_erp"].sort_values(["region", "date"])
    growth = erp.copy()
    growth["value"] = erp.groupby("region")["value"].diff()
    growth["metric"] = "population_growth_qtr"
    growth = growth.dropna(subset=["value"])

    return pd.concat([base, growth], ignore_index=True).reset_index(drop=True)


# ---------------------------------------------------------------------------
# au_dwelling_stock — Residential Dwellings: Values, Mean Price and Number by
# State (RES_DWELL_ST) — the ABS "Total Value of Dwellings" data.
# key order: MEASURE.REGION.FREQ · GET .../RES_DWELL_ST/4+5.2+AUS.Q
#   MEASURE 4 Number of residential dwellings / 5 Mean price of residential
#   dwellings · REGION 2 Victoria + AUS · Quarterly.  Both UNIT_MULT=3; scale
#   by 10^UNIT_MULT to base units (dwellings / dollars).
# ---------------------------------------------------------------------------
_DWELL_KEY = "4+5.2+AUS.Q"
_DWELL_METRIC = {"4": "dwelling_count", "5": "mean_price"}
_DWELL_UNIT = {"dwelling_count": "dwellings", "mean_price": "aud"}


def fetch_dwelling_stock() -> str:
    return abs_csv("RES_DWELL_ST", _DWELL_KEY)


def parse_dwelling_stock(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw))
    df = df[df["OBS_VALUE"].notna()]
    mult = pd.to_numeric(df["UNIT_MULT"], errors="coerce").fillna(0)
    metric = df["MEASURE"].astype(str).map(_DWELL_METRIC)
    out = pd.DataFrame(
        {
            "date": df["TIME_PERIOD"].map(common.period_end),
            "region": df["REGION"].astype(str).map(_REGION_STATE),
            "metric": metric,
            "value": (pd.to_numeric(df["OBS_VALUE"]) * (10.0 ** mult)).round(),
            "unit": metric.map(_DWELL_UNIT),
        }
    )
    return out.dropna(subset=["region", "metric", "unit"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# vic_res_dwell — Residential Dwellings: Median Price of Transfers (RES_DWELL)
# key order: MEASURE.REGION.FREQ · GET .../RES_DWELL/1+2+3+4.2GMEL+2RVIC.Q
#   MEASURE 3 Median Price of Established House Transfers / 4 Median Price of
#   Attached Dwelling Transfers (1/2 are transfer COUNTS for the same two
#   dwelling types — fetched for live verification, dropped by the metric
#   map: no chart plots them, and the shared tidy schema has no room for a
#   stray metric) · REGION Greater Melbourne / Rest of Vic · Quarterly.
#   UNIT_MULT is 3 (thousands) for the two price measures; scale by
#   10^UNIT_MULT to whole dollars, same as parse_dwelling_stock above.
#   This dataflow publishes RAW (unstratified) transaction medians split by
#   dwelling type — there is no single "all dwellings" median in RES_DWELL,
#   so we do NOT derive/combine house + attached into one figure (that would
#   be fabrication); both published medians are emitted as separate metrics.
# ---------------------------------------------------------------------------
_RES_DWELL_KEY = "1+2+3+4.2GMEL+2RVIC.Q"
_RES_DWELL_METRIC = {
    "3": "median_price_house",
    "4": "median_price_attached",
}


def fetch_res_dwell() -> str:
    return abs_csv("RES_DWELL", _RES_DWELL_KEY)


def parse_res_dwell(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw))
    df = df[df["OBS_VALUE"].notna()]
    mult = pd.to_numeric(df["UNIT_MULT"], errors="coerce").fillna(0)
    metric = df["MEASURE"].astype(str).map(_RES_DWELL_METRIC)
    out = pd.DataFrame(
        {
            "date": df["TIME_PERIOD"].map(common.period_end),
            "region": df["REGION"].astype(str).map(_REGION_GCCSA_VIC),
            "metric": metric,
            "value": (pd.to_numeric(df["OBS_VALUE"]) * (10.0 ** mult)).round(),
            "unit": "aud",
        }
    )
    return out.dropna(subset=["region", "metric"]).reset_index(drop=True)


# ---------------------------------------------------------------------------
# vic_population_gccsa — Population components by GCCSA
# (ERP_COMP_SA_ASGS2021), ANNUAL — Greater Melbourne / Rest of Vic.
#
# This is a SEPARATE cadence from au_population above (ERP_COMP_Q, quarterly,
# vic/australia only) — that dataflow does not publish a metro/regional
# split, and this one does not publish a vic/australia aggregate. The two are
# never merged into one series or chart: an annual print plotted next to
# quarterly prints on the same line would misread as one consistent series.
#
# key order: POP_COMP.ASGS_2021(region type).REGION.FREQ
# GET .../ERP_COMP_SA_ASGS2021/10+9+6+3.GCCSA.2GMEL+2RVIC.A
#   POP_COMP 10 Estimated Resident Population / 9 Net Overseas Migration /
#   6 Net Internal Migration / 3 Natural Increase · region type GCCSA ·
#   REGION Greater Melbourne / Rest of Vic · Annual. OBS_VALUE is already
#   whole persons on this dataflow (no UNIT_MULT column, unlike ERP_COMP_Q)
#   — no scaling needed.
# ---------------------------------------------------------------------------
_POP_GCCSA_KEY = "10+9+6+3.GCCSA.2GMEL+2RVIC.A"
_POP_GCCSA_METRIC = {
    "10": "population_erp",
    "9": "net_overseas_migration",
    "6": "net_internal_migration",
    "3": "natural_increase",
}


def fetch_population_gccsa() -> str:
    return abs_csv("ERP_COMP_SA_ASGS2021", _POP_GCCSA_KEY)


def parse_population_gccsa(raw: str) -> pd.DataFrame:
    return _tidy(
        pd.read_csv(io.StringIO(raw)),
        region_col="REGION", region_map=_REGION_GCCSA_VIC,
        metric_col="POP_COMP", metric_map=_POP_GCCSA_METRIC,
        unit="persons",
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
    common.Series(
        id="au_lending",
        source_name="ABS Lending Indicators — Housing Finance (LEND_HOUSING)",
        source_url=f"{ABS_BASE}/LEND_HOUSING/{_LENDING_KEY}",
        frequency="quarterly",
        fetch=fetch_lending,
        parse=parse_lending,
    ),
    common.Series(
        id="au_population",
        source_name="ABS Population & components of change (ERP_COMP_Q)",
        source_url=f"{ABS_BASE}/ERP_COMP_Q/{_POP_KEY}",
        frequency="quarterly",
        fetch=fetch_population,
        parse=parse_population,
    ),
    common.Series(
        id="au_dwelling_stock",
        source_name="ABS Total Value of Dwellings (RES_DWELL_ST)",
        source_url=f"{ABS_BASE}/RES_DWELL_ST/{_DWELL_KEY}",
        frequency="quarterly",
        fetch=fetch_dwelling_stock,
        parse=parse_dwelling_stock,
    ),
    common.Series(
        id="vic_res_dwell",
        source_name="ABS Residential Dwellings: Median Price of Transfers (RES_DWELL)",
        source_url=f"{ABS_BASE}/RES_DWELL/{_RES_DWELL_KEY}",
        frequency="quarterly",
        fetch=fetch_res_dwell,
        parse=parse_res_dwell,
    ),
    common.Series(
        id="vic_population_gccsa",
        source_name="ABS Population components by GCCSA (ERP_COMP_SA_ASGS2021)",
        source_url=f"{ABS_BASE}/ERP_COMP_SA_ASGS2021/{_POP_GCCSA_KEY}",
        frequency="annual",
        fetch=fetch_population_gccsa,
        parse=parse_population_gccsa,
    ),
]
