"""DFFH / Homes Victoria Rental Report (``vic_rents``).

Quarterly Victorian rental data. The report's data workbook ("Tables from Rental
Report - <Quarter> <Year>.xlsx") is linked from the report index with the quarter
in the URL slug, so we discover the current link on each run rather than
hardcoding it.

USER-AGENT NOTE: www.dffh.vic.gov.au tarpits/blocks non-browser User-Agents — the
plain pipeline UA times out, and even a browser UA with our identifier appended is
dropped; only a clean browser UA is served. So this one source overrides the
default UA out of necessity. We stay polite in every other respect: one run/day,
robots.txt permits these paths (/publications/ and the data files aren't
disallowed), and the usual timeouts + retries apply.

``vic_rents`` is built for metro (Melbourne) vs regional Victoria from:
* ``rent_growth_annual`` — Rent Index annual % change        (Fig 1 source, 2000Q2->)
* ``affordable_share``   — affordable lettings % of new lets (Fig 8 source, 2020Q3->)
* ``median_rent``        — overall median rent, new lettings  (Table 1, report quarter)
* ``rent_<size>_<type>`` — median rent by dwelling type       (Table 3, report quarter)
The two time series give immediate history; the two snapshot tables carry only the
report's own quarter, and the pipeline appends a fresh point each quarter (git
history preserves every vintage).

Discovery:  GET https://www.dffh.vic.gov.au/publications/rental-report
            -> href matching 'tables-rental-report-<quarter>-excel'
            -> GET that URL (redirects to the .xlsx)
Verified live 2026-07-16 (September Quarter 2025 report).
"""
from __future__ import annotations

import datetime as _dt
import io
import re

import openpyxl
import pandas as pd

from pipeline import common

BASE = "https://www.dffh.vic.gov.au"
INDEX = f"{BASE}/publications/rental-report"
# A clean browser UA — required; the site blocks anything else (see module docstring).
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
_TABLES_RE = re.compile(r'href="([^"]*tables-rental-report-[^"]*-excel)"', re.I)
_TITLE_RE = re.compile(r"(march|june|september|december)\s+quarter\s+(\d{4})", re.I)
_QUARTER_MONTH = {"march": 3, "june": 6, "september": 9, "december": 12}

# Table 3 row labels -> tidy metric / region
_DWELLING_METRIC = {
    "1 bed flat": "rent_1br_flat",
    "2 bed flat": "rent_2br_flat",
    "3 bed flat": "rent_3br_flat",
    "2 bed house": "rent_2br_house",
    "3 bed house": "rent_3br_house",
    "4 bed house": "rent_4br_house",
}
_REGION_HEADER = {
    "metropolitan melbourne": "melbourne",
    "regional victoria": "regional_vic",
}


# --------------------------------------------------------------------------
# Fetch (browser UA; discover the current workbook link)
# --------------------------------------------------------------------------
def _browser_fetch(url: str) -> "object":
    return common.fetch(url, headers={"User-Agent": BROWSER_UA}, timeout=60)


def discover_tables_url(index_html: str) -> str:
    """Return the absolute URL of the current 'Tables from Rental Report' XLSX."""
    m = _TABLES_RE.search(index_html)
    if not m:
        raise ValueError("no 'tables-rental-report-*-excel' link on the report index")
    href = m.group(1)
    return href if href.startswith("http") else BASE + href


def fetch_tables() -> bytes:
    html = _browser_fetch(INDEX).text
    return _browser_fetch(discover_tables_url(html)).content


# --------------------------------------------------------------------------
# Parse
# --------------------------------------------------------------------------
def _report_quarter_end(title: str) -> str:
    m = _TITLE_RE.search(title or "")
    if not m:
        raise ValueError(f"could not read report quarter from title: {title!r}")
    return common.period_end(f"{m.group(2)}-{_QUARTER_MONTH[m.group(1).lower()]:02d}")


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool)


def _rows(ws) -> list:
    return list(ws.iter_rows(values_only=True))


def _timeseries(ws, colmap: dict[int, str], metric: str) -> list[tuple]:
    """Rows keyed by a datetime in col 0; ``colmap`` maps col index -> region.
    Values are fractions in the sheet and stored as percentages."""
    out = []
    for row in _rows(ws):
        d = row[0]
        if not isinstance(d, _dt.datetime):
            continue
        date = common.period_end(f"{d.year}-{d.month:02d}")
        for ci, region in colmap.items():
            if ci < len(row) and _num(row[ci]):
                out.append((date, region, metric, float(row[ci]) * 100.0, "percent"))
    return out


def _table3_by_dwelling(ws, report_date: str) -> list[tuple]:
    """Table 3: region header rows followed by dwelling-type rows (snapshot)."""
    out, region = [], None
    for row in _rows(ws):
        label = str(row[0]).strip().lower() if row[0] is not None else ""
        if label in _REGION_HEADER:
            region = _REGION_HEADER[label]
        elif region and label in _DWELLING_METRIC and _num(row[1]):
            out.append((report_date, region, _DWELLING_METRIC[label], float(row[1]), "AUD/week"))
    return out


def _table1_overall(ws, report_date: str) -> list[tuple]:
    """Table 1: 'Melbourne' / 'Regional Victoria' rows, col 1 = median rent."""
    labels = {"melbourne": "melbourne", "regional victoria": "regional_vic"}
    out = []
    for row in _rows(ws):
        label = str(row[0]).strip().lower() if row[0] is not None else ""
        if label in labels and _num(row[1]):
            out.append((report_date, labels[label], "median_rent", float(row[1]), "AUD/week"))
    return out


def parse_tables(raw: bytes) -> pd.DataFrame:
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    title = next(wb["Contents"].iter_rows(max_row=1, values_only=True))[0]
    report_date = _report_quarter_end(title)

    rows: list[tuple] = []
    # Time series (metro = MRI / Metro col; regional = RRI / Regional col).
    rows += _timeseries(wb["Fig 1 source"], {1: "melbourne", 2: "regional_vic"}, "rent_growth_annual")
    rows += _timeseries(wb["Fig 8 source"], {2: "melbourne", 3: "regional_vic"}, "affordable_share")
    # Current-quarter snapshots.
    rows += _table1_overall(wb["Table 1"], report_date)
    rows += _table3_by_dwelling(wb["Table 3"], report_date)

    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="vic_rents",
        source_name="DFFH / Homes Victoria Rental Report",
        source_url=INDEX,
        frequency="quarterly",
        fetch=fetch_tables,
        parse=parse_tables,
    ),
]
