"""FRED (Federal Reserve Bank of St. Louis) international leading indicators.

Needs a free API key in the ``FRED_API_KEY`` env var (a local .env in dev, a
repo secret in CI). ``fetch`` returns only the observation data keyed by series
id, so the saved fixture never contains the key.
"""
from __future__ import annotations

import json
import os

import pandas as pd

from pipeline import common

FRED_OBS = "https://api.stlouisfed.org/fred/series/observations"
_OBSERVATION_START = "2015-01-01"

_FRED_SERIES = {
    "DCOILBRENTEU": "brent_crude",       # Brent crude, USD/barrel
    "DGS10": "us_10y_treasury",          # US 10-year Treasury yield, %
    "DEXUSAL": "aud_usd",                # USD per 1 AUD
}
_FRED_UNIT = {
    "brent_crude": "usd_per_barrel",
    "us_10y_treasury": "percent",
    "aud_usd": "usd_per_aud",
}


def _observations(series_id: str, api_key: str) -> list[dict]:
    resp = common.fetch(
        FRED_OBS,
        params={
            "series_id": series_id,
            "api_key": api_key,
            "file_type": "json",
            "observation_start": _OBSERVATION_START,
        },
    )
    return resp.json().get("observations", [])


def fetch_fred() -> str:
    common.load_env()
    api_key = os.environ.get("FRED_API_KEY")
    if not api_key:
        raise RuntimeError("FRED_API_KEY is not set (local .env or CI secret)")
    data = {
        sid: [{"date": o["date"], "value": o["value"]} for o in _observations(sid, api_key)]
        for sid in _FRED_SERIES
    }
    return json.dumps(data)


def parse_fred(raw: str) -> pd.DataFrame:
    data = json.loads(raw)
    rows = []
    for sid, metric in _FRED_SERIES.items():
        for obs in data.get(sid, []):
            v = obs["value"]
            if v in (".", "", None):  # FRED marks missing values with "."
                continue
            rows.append(
                {
                    "date": obs["date"],
                    "region": "global",
                    "metric": metric,
                    "value": float(v),
                    "unit": _FRED_UNIT[metric],
                }
            )
    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="intl_fred",
        source_name="FRED — Brent crude, US 10yr Treasury, AUD/USD",
        source_url="https://fred.stlouisfed.org/",
        frequency="daily",
        fetch=fetch_fred,
        parse=parse_fred,
    ),
]
