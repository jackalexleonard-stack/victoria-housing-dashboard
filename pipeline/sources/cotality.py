"""Cotality (formerly CoreLogic) Home Value Index — ``vic_hvi`` + ``au_hvi``.

Cotality publishes its Home Value Index for the ASX as a JSON feed at
``https://au-indices.cotality.com/asx.json`` (linked from
cotality.com/au/our-data/indices). Per location it carries a daily index + change,
a monthly block (all/house/unit index values with month- and year-on-year %
change) and a 365-day daily "worm" time series. The free feed covers the capital
cities and the 5-capital aggregate only — there is **no Regional Victoria** series
in it, so vic_hvi is Melbourne-only (documented on the dashboard).

Derived:
  ``vic_hvi`` (region=melbourne, code 205) and ``au_hvi`` (region=australia, the
  5-capital-city aggregate, code 999), each with:
    * ``hvi_index``      — dwelling-values index (daily, from the worm series)
    * ``hvi_change_mom`` — latest month-on-month % change (from the monthly block)
    * ``hvi_change_yoy`` — latest year-on-year % change
The daily index accumulates full history over time (write_series preserves older
points beyond the feed's rolling 365-day window).

Verified live 2026-07-16 (monthly reference "30 June 2026").
"""
from __future__ import annotations

import json

import pandas as pd

from pipeline import common

ASX_JSON = "https://au-indices.cotality.com/asx.json"
INDICES_PAGE = "https://www.cotality.com/au/our-data/indices"
_MELBOURNE_CODE = "205"
_AGGREGATE_CODE = "999"  # 5 capital city aggregate


def fetch_asx() -> bytes:
    return common.fetch(ASX_JSON).content


def _yyyymmdd(n) -> str:
    s = str(int(n))
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


def _parse(raw: bytes, *, code: str, region: str) -> pd.DataFrame:
    data = json.loads(raw)
    rows: list[tuple] = []

    worm = next((w for w in data.get("worm", []) if str(w.get("code")) == code), None)
    if worm:
        for point in worm.get("data", []):
            day, val = point[0], point[1]
            if val is not None:
                rows.append((_yyyymmdd(day), region, "hvi_index", float(val), "index"))

    monthly = next((m for m in data.get("monthly", []) if str(m.get("code")) == code), None)
    if monthly:
        mdate = common.period_end(pd.to_datetime(data["monthName"]).strftime("%Y-%m"))
        rows.append((mdate, region, "hvi_change_mom", float(monthly["allPercentChangeMonth"]), "percent"))
        rows.append((mdate, region, "hvi_change_yoy", float(monthly["allPercentChangeYear"]), "percent"))

    if not rows:
        raise ValueError(f"Cotality feed had no data for location code {code}")
    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


def parse_vic_hvi(raw: bytes) -> pd.DataFrame:
    return _parse(raw, code=_MELBOURNE_CODE, region="melbourne")


def parse_au_hvi(raw: bytes) -> pd.DataFrame:
    return _parse(raw, code=_AGGREGATE_CODE, region="australia")


SERIES = [
    common.Series(
        id="vic_hvi",
        source_name="Cotality Home Value Index — Melbourne",
        source_url=INDICES_PAGE,
        frequency="daily",
        fetch=fetch_asx,
        parse=parse_vic_hvi,
    ),
    common.Series(
        id="au_hvi",
        source_name="Cotality Home Value Index — 5-capital-city aggregate",
        source_url=INDICES_PAGE,
        frequency="daily",
        fetch=fetch_asx,
        parse=parse_au_hvi,
    ),
]
