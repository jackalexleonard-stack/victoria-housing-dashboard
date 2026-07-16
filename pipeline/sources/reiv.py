"""REIV quarterly median house & unit prices — ``vic_median_price`` (best-effort).

REIV publishes Victorian median prices, but reiv.com.au is a React single-page app
backed by a members-gated private API — the median figures are not in the public
HTML and the API is not freely accessible. So this source usually FAILS; it runs
failure-isolated and the dashboard degrades gracefully (last good / no data +
warning), satisfying the Phase 3 requirement.

The parser is still written and tested against the expected shape — a table of
median house/unit prices for Metropolitan Melbourne vs Regional Victoria — so if a
public figure becomes reachable it is captured. Observations are dated to the
report quarter (parsed from the page, else the most recently completed quarter).
"""
from __future__ import annotations

import io
import re
from datetime import date
from typing import Optional

import pandas as pd

from pipeline import common

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
REIV_URLS = [
    "https://reiv.com.au/property-data/median-prices",
    "https://reiv.com.au/market-insights",
]
_QUARTER_RE = re.compile(r"(march|june|september|december)\s+quarter\s+(\d{4})", re.I)
_QUARTER_MONTH = {"march": 3, "june": 6, "september": 9, "december": 12}


def fetch_reiv() -> str:
    errors = []
    for url in REIV_URLS:
        try:
            resp = common.fetch(url, headers={"User-Agent": BROWSER_UA}, timeout=30, retries=1)
            if resp.status_code == 200 and resp.text:
                return resp.text
            errors.append(f"{url} -> HTTP {resp.status_code}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url} -> {type(exc).__name__}")
    raise RuntimeError("no reachable REIV source: " + "; ".join(errors))


def _region_of(label: str) -> Optional[str]:
    label = label.lower()
    if "melbourne" in label and "metropolitan" in label:
        return "melbourne"
    if "regional" in label and ("victoria" in label or "vic" in label):
        return "regional_vic"
    return None


def _money(cell) -> Optional[float]:
    digits = re.sub(r"[^\d]", "", str(cell))
    if digits and 5 <= len(digits) <= 8:  # $50,000 .. $99,999,999
        return float(digits)
    return None


def _report_quarter(html: str, today: date) -> str:
    m = _QUARTER_RE.search(html)
    if m:
        return common.period_end(f"{m.group(2)}-{_QUARTER_MONTH[m.group(1).lower()]:02d}")
    # Most recently completed quarter relative to today.
    q_end_month = ((today.month - 1) // 3) * 3  # 0,3,6,9 -> previous quarter end
    if q_end_month == 0:
        return common.period_end(f"{today.year - 1}-12")
    return common.period_end(f"{today.year}-{q_end_month:02d}")


def parse_reiv(html: str, *, today: Optional[date] = None) -> pd.DataFrame:
    today = today or date.today()
    date_iso = _report_quarter(html, today)

    try:
        tables = pd.read_html(io.StringIO(html), flavor="lxml")
    except ValueError:
        tables = []  # no <table> elements (e.g. the members-gated SPA shell)

    for t in tables:
        cols = {str(c).strip().lower(): i for i, c in enumerate(t.columns)}
        house_col = next((i for k, i in cols.items() if "house" in k), None)
        unit_col = next((i for k, i in cols.items() if "unit" in k), None)
        if house_col is None and unit_col is None:
            continue

        rows = []
        for _, r in t.iterrows():
            region = _region_of(str(r.iloc[0]))
            if not region:
                continue
            if house_col is not None and (hv := _money(r.iloc[house_col])):
                rows.append((date_iso, region, "median_house_price", hv, "AUD"))
            if unit_col is not None and (uv := _money(r.iloc[unit_col])):
                rows.append((date_iso, region, "median_unit_price", uv, "AUD"))
        if rows:
            return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)

    raise ValueError("no REIV median-price table found on the page")


SERIES = [
    common.Series(
        id="vic_median_price",
        source_name="REIV median house & unit prices",
        source_url="https://reiv.com.au/property-data/median-prices",
        frequency="quarterly",
        fetch=fetch_reiv,
        parse=parse_reiv,
    ),
]
