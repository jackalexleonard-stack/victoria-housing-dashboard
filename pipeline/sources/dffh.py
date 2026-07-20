"""DFFH / Homes Victoria Rental Report (``vic_rents``).

Quarterly Victorian rental data, built from TWO workbooks linked off the same
report index (the quarter is baked into each URL slug, so we discover both
links fresh on each run rather than hardcoding them):

* "Tables from Rental Report - <Quarter> <Year>.xlsx" — ``fetch_tables`` /
  ``parse_tables``. Time series (full history) plus a dwelling-type snapshot:
  * ``rent_growth_annual`` — Rent Index annual % change        (Fig 1 source, 2000Q2->)
  * ``affordable_share``   — affordable lettings % of new lets (Fig 8 source, 2020Q3->)
  * ``rent_<size>_<type>`` — median rent by dwelling type       (Table 3, report quarter only)
* "Quarterly median rents by Local Government Area.xlsx" — ``fetch_lga_medians`` /
  ``parse_lga_medians``. The ``All Properties`` sheet's METRO NON-METRO
  aggregate rows give the overall median rent for EVERY quarter back to
  Jun 1999 (~106 quarters), so:
  * ``median_rent`` — overall median rent, new lettings, full history (Metro/Non-Metro rows)
  comes entirely from this workbook. (Table 1 in the other workbook has its own,
  current-quarter-only "Melbourne"/"Regional Victoria" median rent, on a
  slightly different statistical-region grouping than this workbook's LGA-based
  Metro/Non-Metro split — the two figures are close but not identical, so to
  avoid two competing sources for the same metric we no longer read Table 1
  at all.)

``fetch_vic_rents``/``parse_vic_rents`` (used by the ``vic_rents`` Series below)
fetch and parse both workbooks and concatenate the tidy rows. Dwelling-type
history (the 6 dwelling sheets in the LGA workbook) is out of scope for now —
those metrics remain current-quarter-only snapshots from Table 3.

USER-AGENT NOTE: www.dffh.vic.gov.au tarpits/blocks non-browser User-Agents — the
plain pipeline UA times out, and even a browser UA with our identifier appended is
dropped; only a clean browser UA is served. So this one source overrides the
default UA out of necessity. We stay polite in every other respect: one run/day,
robots.txt permits these paths (/publications/ and the data files aren't
disallowed), and the usual timeouts + retries apply.

Discovery:  GET https://www.dffh.vic.gov.au/publications/rental-report
            -> href matching 'tables-rental-report-<quarter>-excel'
               and href matching 'quarterly-median-rents-local-government-area-<quarter>-excel'
            -> GET each URL (redirects to its .xlsx)
Verified live 2026-07-16 (September Quarter 2025 report; LGA-medians discovery
verified live 2026-07-21).
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
_LGA_MEDIANS_RE = re.compile(
    r'href="([^"]*quarterly-median-rents-local-government-area-[^"]*-excel)"', re.I
)
_TITLE_RE = re.compile(r"(march|june|september|december)\s+quarter\s+(\d{4})", re.I)
_QUARTER_MONTH = {"march": 3, "june": 6, "september": 9, "december": 12}
_QUARTER_LABEL_FMT = "%b %Y"  # 'Jun 1999' as used by the LGA-medians header row

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


def discover_lga_medians_url(index_html: str) -> str:
    """Return the absolute URL of the current 'Quarterly median rents by LGA' XLSX."""
    m = _LGA_MEDIANS_RE.search(index_html)
    if not m:
        raise ValueError(
            "no 'quarterly-median-rents-local-government-area-*-excel' link "
            "on the report index"
        )
    href = m.group(1)
    return href if href.startswith("http") else BASE + href


def fetch_tables() -> bytes:
    html = _browser_fetch(INDEX).text
    return _browser_fetch(discover_tables_url(html)).content


def fetch_lga_medians() -> bytes:
    html = _browser_fetch(INDEX).text
    return _browser_fetch(discover_lga_medians_url(html)).content


def fetch_vic_rents() -> dict:
    """Fetch both workbooks behind ``vic_rents`` with a single INDEX page load."""
    html = _browser_fetch(INDEX).text
    return {
        "tables": _browser_fetch(discover_tables_url(html)).content,
        "lga_medians": _browser_fetch(discover_lga_medians_url(html)).content,
    }


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


def parse_tables(raw: bytes) -> pd.DataFrame:
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    title = next(wb["Contents"].iter_rows(max_row=1, values_only=True))[0]
    report_date = _report_quarter_end(title)

    rows: list[tuple] = []
    # Time series (metro = MRI / Metro col; regional = RRI / Regional col).
    rows += _timeseries(wb["Fig 1 source"], {1: "melbourne", 2: "regional_vic"}, "rent_growth_annual")
    rows += _timeseries(wb["Fig 8 source"], {2: "melbourne", 3: "regional_vic"}, "affordable_share")
    # Current-quarter snapshot (dwelling-type breakdown). The overall
    # median_rent snapshot (Table 1) is deliberately NOT read here any more —
    # ``parse_lga_medians`` below supplies the full median_rent history from a
    # different workbook, and reading both would give the metric two
    # (slightly different) sources for the same quarter.
    rows += _table3_by_dwelling(wb["Table 3"], report_date)

    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


# --------------------------------------------------------------------------
# Parse: "Quarterly median rents by Local Government Area" workbook
# --------------------------------------------------------------------------
_LGA_SHEET = "All Properties"
_LGA_REGION = {"metro": "melbourne", "non-metro": "regional_vic"}


def _quarter_label_to_iso(label) -> str:
    dt = _dt.datetime.strptime(str(label).strip(), _QUARTER_LABEL_FMT)
    return common.period_end(f"{dt.year}-{dt.month:02d}")


def _lga_quarter_columns(header_row: tuple) -> dict[int, str]:
    """Map each quarter's MEDIAN column index -> ISO period-end.

    Row 1 of the sheet gives each quarter a label spanning a (Count, Median)
    column pair, starting at column 2 (e.g. cols 2/3 = 'Jun 1999' Count/Median,
    cols 4/5 = 'Sep 1999' Count/Median, ...). We only need the Median column.
    """
    cols: dict[int, str] = {}
    for ci in range(2, len(header_row) - 1, 2):
        label = header_row[ci]
        if label is not None:
            cols[ci + 1] = _quarter_label_to_iso(label)
    return cols


def parse_lga_medians(raw: bytes) -> pd.DataFrame:
    """'Quarterly median rents by Local Government Area' workbook, ``All
    Properties`` sheet only: label-scan for the METRO NON-METRO section's
    Metro / Non-Metro aggregate rows (NOT fixed row numbers — the sheet grows
    a suburb/LGA row occasionally), then walk every quarter-pair column to
    emit the full median-rent history for melbourne / regional_vic.
    """
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    rows = _rows(wb[_LGA_SHEET])
    quarter_cols = _lga_quarter_columns(rows[1])

    out: list[tuple] = []
    in_section = False
    for row in rows:
        label0 = str(row[0]).strip().lower() if row[0] is not None else ""
        if label0 == "metro non-metro":
            in_section = True
        if not in_section:
            continue
        label1 = str(row[1]).strip().lower() if row[1] is not None else ""
        region = _LGA_REGION.get(label1)
        if not region:
            continue
        for ci, date in quarter_cols.items():
            if ci < len(row) and _num(row[ci]):
                out.append((date, region, "median_rent", float(row[ci]), "AUD/week"))

    if not out:
        raise ValueError(
            f"no Metro/Non-Metro median-rent rows found in '{_LGA_SHEET}' sheet"
        )
    return pd.DataFrame(out, columns=common.TIDY_COLUMNS)


def parse_vic_rents(raw: dict) -> pd.DataFrame:
    """Combine both workbooks' tidy rows for the ``vic_rents`` series."""
    df_tables = parse_tables(raw["tables"])
    df_lga = parse_lga_medians(raw["lga_medians"])
    return pd.concat([df_tables, df_lga], ignore_index=True)[common.TIDY_COLUMNS]


SERIES = [
    common.Series(
        id="vic_rents",
        source_name="DFFH / Homes Victoria Rental Report",
        source_url=INDEX,
        frequency="quarterly",
        fetch=fetch_vic_rents,
        parse=parse_vic_rents,
    ),
]
