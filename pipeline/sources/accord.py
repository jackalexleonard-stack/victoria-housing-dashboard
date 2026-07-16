"""Derived series: National Housing Accord progress.

The Accord target is 1.2 million homes over the five years from 1 July 2024 —
a straight-line 60,000 completions per quarter. We compute cumulative actual
national completions (from ABS Building Activity) against the cumulative target.

Reuses the Building Activity fetch/parse so it stays self-contained and
failure-isolated (its own request; no ordering dependency on vic_activity).
"""
from __future__ import annotations

import pandas as pd

from pipeline import common
from pipeline.sources import abs as absrc

TARGET_PER_QUARTER = 60_000          # 1.2m homes / 20 quarters
FIRST_QUARTER_END = "2024-09-30"     # first quarter of the Accord (Jul–Sep 2024)


def fetch_accord() -> str:
    # Reuse the Building Activity payload (national completions live here).
    return absrc.fetch_activity()


def parse_accord(raw: str) -> pd.DataFrame:
    activity = absrc.parse_activity(raw)
    nat = activity[
        (activity.region == "australia") & (activity.metric == "dwellings_completed")
    ].sort_values("date")
    acc = nat[nat.date >= FIRST_QUARTER_END].reset_index(drop=True)
    if acc.empty:
        raise ValueError("no national completions on/after the Accord start")

    n = range(1, len(acc) + 1)
    cum_actual = acc["value"].cumsum()
    cum_target = [q * TARGET_PER_QUARTER for q in n]

    frames = [
        _rows(acc["date"], "accord_quarterly_actual", acc["value"]),
        _rows(acc["date"], "accord_quarterly_target", TARGET_PER_QUARTER),
        _rows(acc["date"], "accord_cumulative_actual", cum_actual),
        _rows(acc["date"], "accord_cumulative_target", cum_target),
    ]
    return pd.concat(frames, ignore_index=True)[common.TIDY_COLUMNS]


def _rows(dates, metric, values) -> pd.DataFrame:
    return pd.DataFrame(
        {"date": list(dates), "region": "australia", "metric": metric,
         "value": values, "unit": "dwellings"}
    )


SERIES = [
    common.Series(
        id="au_accord",
        source_name="Housing Accord progress (derived from ABS Building Activity)",
        source_url=absrc.SERIES[1].source_url,  # BUILDING_ACTIVITY request URL
        frequency="quarterly",
        fetch=fetch_accord,
        parse=parse_accord,
    ),
]
