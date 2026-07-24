"""Productivity Commission — Report on Government Services, Part G §18
Housing (``au_social_housing``).

RoGS publishes one big per-jurisdiction CSV (Table_Number/Measure/Description1-6
+ one value column per state/territory plus ``Total`` and ``Aust``) covering
every social-housing indicator the Commission tracks — 56 tables, ~2,400 rows.
This is a dashboard, not a mirror of RoGS: we keep only the two headline
"Public housing" measures that map cleanly onto our schema and that this repo
did not already have at the national/Victorian level —

* Table 18A.3 "Dwellings; at 30 June" (Description1="Public housing",
  Description3 blank) — the public-housing dwelling stock.
* Table 18A.5 "Applicants on waitlist at 30 June" / "Total (excluding
  applicants for transfer)" — the public-housing waiting list (state/national
  counterpart to the existing Victoria-only ``vic_social_waitlist`` VHR series;
  not the same figure — VHR is Homes Victoria's own count, this is RoGS'
  cross-jurisdiction figure, so both stay separate series).

Only the ``Vic`` and ``Aust`` jurisdiction columns are emitted (this task is
"Australia (and Victoria) social housing" — not a mirror of all eight
states/territories). Values are RoGS' own published counts — no derivation,
no combining across housing types or jurisdictions.

RoGS is published ANNUALLY (one release covering the prior financial year;
these two measures report "at 30 June", so each row is dated the FY-end).

Verified live 2026-07-24: HTTP 200, 974,189 bytes, 2,397 rows, columns incl.
NSW/Vic/.../Aust — matches the geo audit's description exactly.
"""
from __future__ import annotations

import io

import pandas as pd

from pipeline import common

CSV_URL = (
    "https://assets.pc.gov.au/2026-06/"
    "rogs-202606-partg-section18-housing-dataset_0.csv"
)

# CSV jurisdiction column -> tidy region.
_JURISDICTIONS = {"Vic": "vic", "Aust": "australia"}

# Placeholder tokens RoGS uses in place of a number (not available / not
# published / rounds to zero-or-not-applicable) — treated as missing, never 0.
_NA_TOKENS = {"na", "np", "..", "n.a.", "n.p."}

# (Table_Number, Description2, Description3) -> (tidy metric, unit). All rows
# are Description1 == "Public housing" (each table is already scoped to one
# housing type by RoGS; Public housing is the largest, most consistently
# reported category across jurisdictions and years).
_MEASURES = {
    ("18A.3", "Dwellings; at 30 June", None):
        ("social_dwellings_public", "dwellings"),
    ("18A.5", "Applicants on waitlist at 30 June",
     "Total (excluding applicants for transfer)"):
        ("social_waitlist_public", "applicants"),
}


def fetch_rogs_csv() -> str:
    return common.fetch(CSV_URL, timeout=120).text


def _to_float(val: object) -> float | None:
    if val is None or (isinstance(val, float) and pd.isna(val)):
        return None
    s = str(val).strip()
    if not s or s.lower() in _NA_TOKENS:
        return None
    try:
        return float(s.replace(",", ""))
    except ValueError:
        return None


def parse_rogs_csv(raw: str) -> pd.DataFrame:
    df = pd.read_csv(io.StringIO(raw), dtype=str)

    out = []
    for (table, desc2, desc3), (metric, unit) in _MEASURES.items():
        mask = (
            (df["Table_Number"] == table)
            & (df["Description1"] == "Public housing")
            & (df["Description2"] == desc2)
        )
        if desc3 is None:
            mask &= df["Description3"].isna()
        else:
            mask &= df["Description3"] == desc3
        sub = df[mask]
        if sub.empty:
            raise ValueError(f"no RoGS rows for {table} / {desc2} / {desc3}")

        for _, row in sub.iterrows():
            year = str(row["Year"]).strip()
            if not (len(year) == 4 and year.isdigit()):
                continue  # defensive: these two measures are single-year in
                          # every vintage seen so far, never an "FY" range
            date = f"{year}-06-30"  # RoGS reports these "at 30 June"
            for col, region in _JURISDICTIONS.items():
                value = _to_float(row.get(col))
                if value is None:
                    continue
                out.append((date, region, metric, value, unit))

    return pd.DataFrame(out, columns=common.TIDY_COLUMNS)


SERIES = [
    common.Series(
        id="au_social_housing",
        source_name=(
            "Productivity Commission — Report on Government Services, "
            "Part G, Section 18 (Housing)"
        ),
        source_url=CSV_URL,
        frequency="annual",
        fetch=fetch_rogs_csv,
        parse=parse_rogs_csv,
    ),
]
