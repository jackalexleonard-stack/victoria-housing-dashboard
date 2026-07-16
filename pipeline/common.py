"""Shared plumbing for the housing-dashboard pipeline.

Provides:
* ``fetch`` — polite HTTP GET (plain User-Agent, timeout, modest retries);
* ``period_end`` — SDMX/ISO period string -> period-end ISO date;
* ``write_series`` — tidy long-format CSV writer with revision-overwrite;
* ``update_meta`` — per-series metadata JSON;
* ``Series`` / ``process_series`` / ``mark_failed`` — the unit the orchestrator
  runs in isolation (one broken source must never block the others).

Tidy schema (one CSV per series): ``date, region, metric, value, unit``.
"""
from __future__ import annotations

import json
import os
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import pandas as pd
import requests

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
SERIES_DIR = DATA / "series"
META_DIR = DATA / "meta"
NEWS_DIR = DATA / "news"

TIDY_COLUMNS = ["date", "region", "metric", "value", "unit"]
_KEY = ["date", "region", "metric"]

# A plain, identifying User-Agent (working rule: be polite).
USER_AGENT = (
    "victoria-housing-dashboard/1.0 "
    "(automated daily fetch; +https://github.com/)"
)


# --------------------------------------------------------------------------
# Local env (.env) — never committed; in CI the key is a repo secret.
# --------------------------------------------------------------------------
def load_env() -> None:
    """Load KEY=VALUE lines from a local .env into os.environ (no overwrite)."""
    path = ROOT / ".env"
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, val = line.split("=", 1)
        os.environ.setdefault(key.strip(), val.strip())


# --------------------------------------------------------------------------
# HTTP
# --------------------------------------------------------------------------
DEFAULT_TIMEOUT = 30
_RETRY_STATUS = {429, 500, 502, 503, 504}


def fetch(
    url: str,
    *,
    headers: Optional[dict] = None,
    params: Optional[dict] = None,
    timeout: int = DEFAULT_TIMEOUT,
    retries: int = 3,
    backoff: float = 2.0,
) -> requests.Response:
    """GET ``url`` with a plain UA, a timeout, and modest retries on transient
    failures (connection errors and 429/5xx). Raises the last error if all
    attempts fail."""
    hdrs = {"User-Agent": USER_AGENT}
    if headers:
        hdrs.update(headers)
    last_exc: Optional[Exception] = None
    for attempt in range(1, retries + 1):
        try:
            resp = requests.get(url, headers=hdrs, params=params, timeout=timeout)
            if resp.status_code in _RETRY_STATUS:
                raise requests.HTTPError(
                    f"{resp.status_code} {resp.reason}", response=resp
                )
            resp.raise_for_status()
            return resp
        except requests.RequestException as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(backoff * attempt)
    assert last_exc is not None
    raise last_exc


# --------------------------------------------------------------------------
# Dates
# --------------------------------------------------------------------------
def period_end(period) -> str:
    """Convert an SDMX/ISO period to a period-end ISO date.

    ``2026-05`` -> ``2026-05-31``; ``2026-Q1`` -> ``2026-03-31``;
    ``2026`` -> ``2026-12-31``; ``2026-07-14`` -> ``2026-07-14``.
    """
    return pd.Period(str(period).strip()).end_time.strftime("%Y-%m-%d")


def _utcnow() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --------------------------------------------------------------------------
# Tidy series validation / writing
# --------------------------------------------------------------------------
def validate_tidy(df: pd.DataFrame) -> None:
    """Raise ValueError if ``df`` does not match the tidy schema."""
    if list(df.columns) != TIDY_COLUMNS:
        raise ValueError(f"columns {list(df.columns)} != {TIDY_COLUMNS}")
    if df.empty:
        raise ValueError("no rows produced")
    iso = df["date"].astype(str).str.match(r"^\d{4}-\d{2}-\d{2}$")
    if not iso.all():
        raise ValueError(f"non-ISO date(s): {list(df.loc[~iso, 'date'].unique())[:3]}")
    if not pd.api.types.is_numeric_dtype(df["value"]):
        raise ValueError("value column must be numeric")
    for col in ("region", "metric", "unit"):
        blank = df[col].isna() | (df[col].astype(str).str.len() == 0)
        if blank.any():
            raise ValueError(f"empty {col} value(s)")


def _changed(old: pd.DataFrame, new: pd.DataFrame) -> bool:
    """True if the merged frame differs from what is on disk (semantic
    comparison, tolerant of int/float text formatting)."""
    if len(old) != len(new):
        return True
    a = old.sort_values(_KEY).reset_index(drop=True)
    b = new.sort_values(_KEY).reset_index(drop=True)
    for col in ("date", "region", "metric", "unit"):
        if not a[col].astype(str).equals(b[col].astype(str)):
            return True
    return not np.allclose(
        pd.to_numeric(a["value"]).to_numpy(),
        pd.to_numeric(b["value"]).to_numpy(),
        rtol=0, atol=1e-9, equal_nan=True,
    )


def write_series(series_id: str, df: pd.DataFrame) -> bool:
    """Merge tidy ``df`` into ``data/series/<series_id>.csv``.

    New rows overwrite revised history (same date+region+metric); older rows
    absent from ``df`` are preserved. Writes only when content changes.
    Returns True if the file changed.
    """
    df = df[TIDY_COLUMNS].copy()
    df = df.dropna(subset=["value"])
    df["value"] = pd.to_numeric(df["value"])

    path = SERIES_DIR / f"{series_id}.csv"
    if path.exists():
        old = pd.read_csv(
            path, dtype={"date": str, "region": str, "metric": str, "unit": str}
        )
    else:
        old = pd.DataFrame(columns=TIDY_COLUMNS)

    combined = df.copy() if old.empty else pd.concat([old, df], ignore_index=True)
    combined = combined.drop_duplicates(subset=_KEY, keep="last")
    combined = combined.sort_values(["region", "metric", "date"]).reset_index(drop=True)

    if not _changed(old, combined):
        return False
    SERIES_DIR.mkdir(parents=True, exist_ok=True)
    combined.to_csv(path, index=False)
    return True


# --------------------------------------------------------------------------
# Metadata
# --------------------------------------------------------------------------
def update_meta(
    series_id: str,
    *,
    source_name: str,
    source_url: str,
    frequency: str,
    status: str,
    error: Optional[str] = None,
    changed: bool = False,
    last_data_date: Optional[str] = None,
) -> dict:
    """Write ``data/meta/<series_id>.json``. On failure, existing data fields
    (``last_changed``, ``last_data_date``) are preserved so the dashboard can
    still render the last good vintage."""
    META_DIR.mkdir(parents=True, exist_ok=True)
    path = META_DIR / f"{series_id}.json"
    meta: dict = {}
    if path.exists():
        meta = json.loads(path.read_text(encoding="utf-8"))
    now = _utcnow()
    meta.update(
        {
            "series_id": series_id,
            "source_name": source_name,
            "source_url": source_url,
            "frequency": frequency,
            "status": status,
            "last_fetched": now,
            "error": error,
        }
    )
    if last_data_date is not None:
        meta["last_data_date"] = last_data_date
    if changed:
        meta["last_changed"] = now
    path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return meta


# --------------------------------------------------------------------------
# The isolated unit of work
# --------------------------------------------------------------------------
@dataclass
class Series:
    """A single output series: how to fetch its raw payload and parse it tidy."""

    id: str
    source_name: str
    source_url: str
    frequency: str                         # monthly | quarterly | annual | daily | per_decision
    fetch: Callable[[], object]            # -> raw text/bytes (saved as fixtures)
    parse: Callable[[object], pd.DataFrame]  # raw -> tidy DataFrame


@dataclass
class Result:
    id: str
    status: str
    changed: bool = False
    rows: int = 0
    last_data_date: Optional[str] = None
    error: Optional[str] = None


def process_series(s: Series) -> Result:
    """Fetch -> parse -> validate -> write -> metadata. Raises on any failure;
    the orchestrator wraps this call so one failure cannot block the rest."""
    raw = s.fetch()
    df = s.parse(raw)
    validate_tidy(df)
    changed = write_series(s.id, df)
    last = str(df["date"].max())
    update_meta(
        s.id, source_name=s.source_name, source_url=s.source_url,
        frequency=s.frequency, status="ok", error=None,
        changed=changed, last_data_date=last,
    )
    return Result(s.id, "ok", changed=changed, rows=len(df), last_data_date=last)


def mark_failed(s: Series, exc: Exception) -> Result:
    """Record a failed run in metadata (keeps the last good data)."""
    msg = f"{type(exc).__name__}: {exc}"[:300]
    update_meta(
        s.id, source_name=s.source_name, source_url=s.source_url,
        frequency=s.frequency, status="failed", error=msg,
    )
    return Result(s.id, "failed", error=msg)
