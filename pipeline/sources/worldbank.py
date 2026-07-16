"""World Bank 'Pink Sheet' commodity prices (``intl_commodities``).

Monthly nominal-USD commodity prices. The download URL embeds a hash that the
World Bank rotates every month, so we **discover the current link live** from the
Commodity Markets page instead of hardcoding a URL that would silently go stale
(verified: a hardcoded 2025 URL still returned data only through 2025M12).

Sheet ``Monthly Prices``: row 5 = commodity names, row 6 = units, rows 7+ =
monthly values keyed ``YYYYMmm`` (e.g. ``2026M06``); missing cells are ``…``.
We keep iron ore, copper and sawnwood from 2015 on (matching the FRED window on
the International tab).

Discovery:  GET https://www.worldbank.org/en/research/commodity-markets
            -> href matching ``CMO-Historical-Data-Monthly.xlsx``
            -> GET that .xlsx
Verified live 2026-07-16 (current file data through 2026M06).
"""
from __future__ import annotations

import io
import re

import openpyxl
import pandas as pd

from pipeline import common

CMO_PAGE = "https://www.worldbank.org/en/research/commodity-markets"
_XLSX_RE = re.compile(r"""https?://[^"'\s<>]*CMO-Historical-Data-Monthly\.xlsx""", re.I)
_PERIOD_RE = re.compile(r"^\d{4}M\d{2}$")
_START_PERIOD = "2015M01"  # fixed-width -> lexicographic compare == chronological

# Pink Sheet column header -> (tidy metric, unit)
_COMMODITIES = {
    "Iron ore, cfr spot": ("iron_ore", "USD/dmtu"),
    "Copper": ("copper", "USD/tonne"),
    "Sawnwood, Malaysian": ("sawnwood", "USD/m3"),
}


def discover_url(page_html: str) -> str:
    """Extract the current monthly-data XLSX link from the CMO page HTML."""
    m = _XLSX_RE.search(page_html)
    if not m:
        raise ValueError("no CMO monthly XLSX link on the commodity-markets page")
    return m.group(0)


def fetch_pink_sheet() -> bytes:
    """Discover the live link, then download the workbook (returns raw bytes)."""
    html = common.fetch(CMO_PAGE).text
    return common.fetch(discover_url(html), timeout=60).content


def _period_to_iso(period: str) -> str:
    p = period.strip()  # 'YYYYMmm' -> 'YYYY-mm' -> period-end
    return common.period_end(f"{p[:4]}-{p[5:7]}")


def parse_pink_sheet(raw: bytes) -> pd.DataFrame:
    wb = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)
    ws = wb["Monthly Prices"]
    rows = list(ws.iter_rows(values_only=True))
    names = rows[4]  # row 5: commodity names

    colidx = {i: spec for i, nm in enumerate(names) if (spec := _COMMODITIES.get(nm))}
    found = {names[i] for i in colidx}
    missing = set(_COMMODITIES) - found
    if missing:
        raise ValueError(f"Pink Sheet columns not found: {sorted(missing)}")

    out = []
    for row in rows:
        period = row[0]
        if not (isinstance(period, str) and _PERIOD_RE.match(period.strip())):
            continue
        if period.strip() < _START_PERIOD:
            continue
        iso = _period_to_iso(period)
        for ci, (metric, unit) in colidx.items():
            val = row[ci]
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                out.append((iso, "global", metric, float(val), unit))
    return pd.DataFrame(out, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="intl_commodities",
        source_name="World Bank Commodity Price Data (The Pink Sheet)",
        source_url=CMO_PAGE,
        frequency="monthly",
        fetch=fetch_pink_sheet,
        parse=parse_pink_sheet,
    ),
]
