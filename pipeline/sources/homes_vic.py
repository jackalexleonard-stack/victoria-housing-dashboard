"""Homes Victoria — Victorian Housing Register applications (``vic_social_waitlist``).

The VHR is Victoria's single social-housing waitlist. Homes Victoria publishes the
figures as inline HTML tables on the 'Applications on the VHR' page, each showing a
rolling window of the last ~5 quarters. We parse the summary table — Priority
Access / Register of Interest / Total — into a statewide quarterly series. Because
the page rolls a 5-quarter window, the pipeline accumulates the full history over
time (git history keeps every vintage).

USER-AGENT NOTE: like other Victorian-government sites, www.homes.vic.gov.au blocks
non-browser User-Agents (the plain pipeline UA times out), so this source uses a
clean browser UA (see also dffh.py). Polite otherwise: one run/day, robots.txt
permits the page, timeouts + retries.

Source: https://www.homes.vic.gov.au/applications-victorian-housing-register-vhr
Verified live 2026-07-16 (window Mar-25..Mar-26; total 57,372 applications Mar 2026).
"""
from __future__ import annotations

import io
import re

import pandas as pd

from pipeline import common

URL = "https://www.homes.vic.gov.au/applications-victorian-housing-register-vhr"
BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
_QUARTER_RE = re.compile(r"^[A-Z][a-z]{2}-\d{2}$")  # e.g. 'Mar-25'
# Summary-table row label (lower-cased) -> tidy metric.
_ROW_METRIC = {
    "priority": "vhr_priority",
    "register of interest": "vhr_register_of_interest",
    "total": "vhr_total",
}
_SUMMARY_LABELS = set(_ROW_METRIC)  # identifies the right table among many


def fetch_page() -> str:
    return common.fetch(URL, headers={"User-Agent": BROWSER_UA}, timeout=60).text


def _quarter_to_iso(label: str) -> str:
    dt = pd.to_datetime(label.strip(), format="%b-%y")  # 'Mar-25' -> 2025-03-01
    return common.period_end(f"{dt.year}-{dt.month:02d}")


def _find_summary(tables: list[pd.DataFrame]) -> pd.DataFrame:
    for t in tables:
        labels = {str(x).strip().lower() for x in t.iloc[:, 0]}
        if _SUMMARY_LABELS <= labels:
            return t
    raise ValueError("VHR summary table (Priority / Register of interest / Total) not found")


def _quarter_columns(t: pd.DataFrame) -> dict[int, str]:
    """Map column index -> ISO period-end for the quarter columns, whether the
    quarter labels landed in the header or in the first data row."""
    for source in (list(t.columns), list(t.iloc[0])):
        cols = {i: _quarter_to_iso(str(v)) for i, v in enumerate(source)
                if _QUARTER_RE.match(str(v).strip())}
        if cols:
            return cols
    raise ValueError("no quarter columns (e.g. 'Mar-26') in VHR summary table")


def parse_vhr(raw: str) -> pd.DataFrame:
    tables = pd.read_html(io.StringIO(raw))
    summary = _find_summary(tables)
    quarter_cols = _quarter_columns(summary)

    out = []
    for _, row in summary.iterrows():
        metric = _ROW_METRIC.get(str(row.iloc[0]).strip().lower())
        if not metric:
            continue
        for ci, date in quarter_cols.items():
            val = pd.to_numeric(str(row.iloc[ci]).replace(",", ""), errors="coerce")
            if pd.notna(val):
                out.append((date, "vic", metric, float(val), "applications"))
    return pd.DataFrame(out, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="vic_social_waitlist",
        source_name="Homes Victoria — Applications on the Victorian Housing Register",
        source_url=URL,
        frequency="quarterly",
        fetch=fetch_page,
        parse=parse_vhr,
    ),
]
