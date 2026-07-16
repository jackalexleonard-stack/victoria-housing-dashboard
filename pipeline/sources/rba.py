"""RBA statistical-table sources (downloaded CSVs from rba.gov.au).

RBA table CSVs share a fixed shape: a metadata header block (Title, Description,
Frequency, Type, Units, Source, Publication date, Series ID) followed by data
rows keyed by a DD/MM/YYYY date. We locate the ``Series ID`` row to map each
wanted mnemonic to a column, then read its dated values. Table URLs and series
IDs were verified live (robots.txt permits /statistics/tables/csv/).
"""
from __future__ import annotations

import csv
import io
import re

import pandas as pd

from pipeline import common

RBA_CSV = "https://www.rba.gov.au/statistics/tables/csv/{table}-data.csv"
_DATE_RE = re.compile(r"^\d{2}/\d{2}/\d{4}$")


def fetch_table(table: str) -> str:
    return common.fetch(RBA_CSV.format(table=table)).text


def extract(text: str, series_ids: list[str]) -> pd.DataFrame:
    """Return long rows (date, sid, value) for the requested RBA series IDs."""
    rows = list(csv.reader(io.StringIO(text)))
    sid_row = next((r for r in rows if r and r[0].strip().lower() == "series id"), None)
    if sid_row is None:
        raise ValueError("no 'Series ID' row in RBA table")
    colidx = {sid: i for i, cell in enumerate(sid_row) for sid in series_ids if cell.strip() == sid}
    missing = set(series_ids) - set(colidx)
    if missing:
        raise ValueError(f"RBA series not found: {sorted(missing)}")

    out = []
    for row in rows:
        if not row or not _DATE_RE.match(row[0].strip()):
            continue
        d = row[0].strip()
        iso = f"{d[6:10]}-{d[3:5]}-{d[0:2]}"
        for sid, ci in colidx.items():
            if ci < len(row) and row[ci].strip():
                try:
                    val = float(row[ci].replace(",", ""))
                except ValueError:
                    continue
                out.append((iso, sid, val))
    return pd.DataFrame(out, columns=["date", "sid", "value"])


def _tidy(text: str, id_map: dict[str, str], *, region: str, unit: str) -> pd.DataFrame:
    """Extract the mapped series IDs and label them as tidy metrics."""
    df = extract(text, list(id_map))
    df["region"] = region
    df["metric"] = df["sid"].map(id_map)
    df["unit"] = unit
    return df[["date", "region", "metric", "value", "unit"]].reset_index(drop=True)


# ---------------------------------------------------------------------------
# au_cash_rate — RBA cash rate target (table F1.1, series FIRMMCRT, monthly)
# GET https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv
# ---------------------------------------------------------------------------
def fetch_cash_rate() -> str:
    return fetch_table("f1.1")


def parse_cash_rate(raw: str) -> pd.DataFrame:
    return _tidy(raw, {"FIRMMCRT": "cash_rate"}, region="australia", unit="percent")


SERIES = [
    common.Series(
        id="au_cash_rate",
        source_name="RBA Cash Rate Target (F1.1)",
        source_url="https://www.rba.gov.au/statistics/tables/csv/f1.1-data.csv",
        frequency="monthly",
        fetch=fetch_cash_rate,
        parse=parse_cash_rate,
    ),
]
