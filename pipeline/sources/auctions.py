"""Melbourne weekly auction clearance rate — ``vic_auctions`` (best-effort scraper).

The brief's primary source is the Cotality weekly auction result, with Domain as a
fallback. Both are behind access controls that block automated $0-infrastructure
fetches — Cotality's auction data bucket returns HTTP 403, and Domain returns 403
to server-side requests (Cloudflare). So in practice this source usually FAILS,
and that is by design: it runs failure-isolated in the orchestrator and the
dashboard shows the last good value (or "no data yet") with a warning rather than
crashing (this is exactly the Phase 3 graceful-degradation requirement).

The parser is nonetheless written and tested against the expected page shape, so
if a public clearance figure becomes reachable it is captured. Clearance rate is
read as an "NN.N% clearance" / "clearance rate of NN.N%" pattern; the observation
is dated to the auction week's Saturday.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Optional

import pandas as pd

from pipeline import common

BROWSER_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0 Safari/537.36"
)
# Candidate public pages, in priority order (primary: Cotality; fallback: Domain).
AUCTION_URLS = [
    "https://www.cotality.com/au/insights/auction-market-results",
    "https://www.domain.com.au/auction-results/melbourne/",
]
_CLEARANCE_RE = re.compile(
    r"(?:clearance rate(?:\s+of)?\s*|preliminary\s+)?(\d{1,2}(?:\.\d)?)\s*%\s*(?:clearance|preliminary)?",
    re.I,
)
_STRONG_CLEARANCE_RE = re.compile(
    r"clearance rate(?:\s+of)?\s*(\d{1,2}(?:\.\d)?)\s*%|(\d{1,2}(?:\.\d)?)\s*%\s*clearance", re.I,
)
_AUCTIONS_RE = re.compile(r"(?:from\s+)?([\d,]{2,7})\s+(?:reported\s+)?auctions", re.I)


def fetch_auctions() -> str:
    """Return the HTML of the first reachable auction page, else raise."""
    errors = []
    for url in AUCTION_URLS:
        try:
            resp = common.fetch(url, headers={"User-Agent": BROWSER_UA}, timeout=30)
            if resp.status_code == 200 and resp.text:
                return resp.text
            errors.append(f"{url} -> HTTP {resp.status_code}")
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{url} -> {type(exc).__name__}")
    raise RuntimeError("no reachable auction source: " + "; ".join(errors))


def _recent_saturday(today: date) -> str:
    offset = (today.weekday() - 5) % 7  # Saturday = weekday 5
    return (today - timedelta(days=offset)).strftime("%Y-%m-%d")


def parse_auctions(html: str, *, today: Optional[date] = None) -> pd.DataFrame:
    today = today or date.today()
    m = _STRONG_CLEARANCE_RE.search(html)
    if not m:
        raise ValueError("no auction clearance rate found on the page")
    rate = float(next(g for g in m.groups() if g))

    rows = [(_recent_saturday(today), "melbourne", "clearance_rate", rate, "percent")]
    a = _AUCTIONS_RE.search(html)
    if a:
        rows.append((_recent_saturday(today), "melbourne", "auctions_reported",
                     float(a.group(1).replace(",", "")), "auctions"))
    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="vic_auctions",
        source_name="Melbourne auction clearance rate (Cotality/Domain)",
        source_url="https://www.domain.com.au/auction-results/melbourne/",
        frequency="weekly",
        fetch=fetch_auctions,
        parse=parse_auctions,
    ),
]
