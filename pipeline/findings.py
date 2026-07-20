"""Chart catalogue + computed finding headlines for Dashboard 2.0.

CHARTS is the single source of truth for what the front-end renders: section
membership, series/metrics, region behaviour, and (via build_findings) the
plain-language headline each chart card leads with. Python computes the words
so the SPA stays presentational and the daily run refreshes them.
"""
from __future__ import annotations

from typing import Callable, Optional

import pandas as pd

SECTIONS: list[tuple[str, str]] = [
    ("today", "Today"), ("prices", "Prices"), ("rents", "Rents & vacancy"),
    ("supply", "Supply & construction"), ("money", "Money & credit"),
    ("people", "People"), ("social", "Social housing"), ("world", "World"),
    ("news", "News"),
]


def _c(id, section, title, series_id, *, metrics=None, region_mode="geo",
       percent=False, markers=False, annotate=False, noun=None, primary=None):
    """noun: subject of the generic finding sentence; primary: metric it uses
    (defaults to metrics[0]); both ignored by charts with custom rules."""
    return dict(id=id, section=section, title=title, series_id=series_id,
                metrics=metrics, region_mode=region_mode, percent=percent,
                markers=markers, annotate=annotate, noun=noun,
                primary=primary or (metrics[0] if metrics else None))


CHARTS: list[dict] = [
    # --- prices ---
    _c("hvi_melbourne", "prices", "Cotality HVI — Melbourne", "vic_hvi",
       metrics=["hvi_index"], region_mode="fixed:melbourne", annotate=True),
    _c("hvi_australia", "prices", "Cotality HVI — 5 capitals", "au_hvi",
       metrics=["hvi_index"], region_mode="fixed:australia", annotate=True),
    _c("mean_price", "prices", "Mean dwelling price", "au_dwelling_stock",
       metrics=["mean_price"], region_mode="geo", noun="The mean dwelling price"),
    _c("reiv_median", "prices", "REIV quarterly medians", "vic_median_price",
       region_mode="geo", noun="The median house price",
       primary="median_house_price"),
    _c("auctions", "prices", "Auction clearance — Melbourne", "vic_auctions",
       metrics=["clearance_rate"], region_mode="fixed:melbourne", percent=True,
       noun="The clearance rate"),
    # --- rents ---
    _c("rent_growth", "rents", "Rent index growth (annual)", "vic_rents",
       metrics=["rent_growth_annual"], region_mode="geo", percent=True,
       noun="Annual rent growth"),
    _c("median_rent", "rents", "Median weekly rent", "vic_rents",
       metrics=["median_rent"], region_mode="geo",
       noun="The median rent"),
    _c("affordable_share", "rents", "Affordable lettings share", "vic_rents",
       metrics=["affordable_share"], region_mode="geo", percent=True,
       noun="The affordable share of new lettings"),
    _c("median_rent_by_type", "rents", "Median rent by dwelling type", "vic_rents",
       metrics=["rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
                "rent_2br_house", "rent_3br_house", "rent_4br_house"],
       region_mode="geo", noun="The median 3-bedroom-house rent",
       primary="rent_3br_house"),
    _c("vacancy", "rents", "Rental vacancy rate", "vic_vacancy",
       metrics=["vacancy_rate"], region_mode="geo", percent=True),
    # --- supply ---
    _c("approvals", "supply", "Dwelling approvals", "vic_approvals",
       region_mode="geo", noun="Dwelling approvals",
       primary="approvals_dwellings_total"),
    _c("activity", "supply", "Commencements, completions, pipeline",
       "vic_activity", region_mode="fixed:vic", noun="Dwellings commenced",
       primary="dwellings_commenced"),
    _c("accord", "supply", "Housing Accord tracker", "au_accord",
       region_mode="fixed:australia"),
    _c("land", "supply", "Greenfield land supply", "vic_land",
       region_mode="fixed:melbourne", noun="Greenfield years of supply",
       primary="greenfield_years_of_supply"),
    _c("input_costs", "supply", "Construction input costs — Melbourne",
       "vic_input_costs", region_mode="fixed:melbourne",
       noun="Input costs", primary="input_all_groups"),
    # --- money ---
    _c("cash_rate", "money", "RBA cash rate target", "au_cash_rate",
       metrics=["cash_rate"], region_mode="fixed:australia", percent=True,
       annotate=True),
    _c("mortgage_rates", "money", "Mortgage rates (owner-occupier)",
       "au_mortgage_rates", region_mode="fixed:australia", percent=True,
       noun="The average new mortgage rate", primary="mortgage_new"),
    _c("lending", "money", "New housing loan commitments", "au_lending",
       region_mode="geo", annotate=True, noun="Owner-occupier lending",
       primary="lending_owner_occupier"),
    _c("credit", "money", "Housing credit growth", "au_credit",
       region_mode="fixed:australia", percent=True, annotate=True,
       noun="Housing credit growth", primary="credit_housing_yoy"),
    # --- people ---
    _c("population", "people", "Population & migration", "au_population",
       region_mode="geo", noun="Net overseas migration",
       primary="net_overseas_migration"),
    # --- social ---
    _c("waitlist", "social", "Victorian Housing Register", "vic_social_waitlist",
       region_mode="fixed:vic", noun="Housing Register applications",
       primary="vhr_total"),
    # --- world ---
    _c("brent", "world", "Brent crude", "intl_fred", metrics=["brent_crude"],
       region_mode="fixed:global", noun="Brent crude"),
    _c("aud_usd", "world", "AUD/USD", "intl_fred", metrics=["aud_usd"],
       region_mode="fixed:global", noun="The Australian dollar"),
    _c("ust10", "world", "US 10-year Treasury", "intl_fred",
       metrics=["us_10y_treasury"], region_mode="fixed:global", percent=True,
       noun="The US 10-year yield"),
    _c("iron_ore", "world", "Iron ore", "intl_commodities",
       metrics=["iron_ore"], region_mode="fixed:global", noun="Iron ore"),
    _c("copper", "world", "Copper", "intl_commodities", metrics=["copper"],
       region_mode="fixed:global", noun="Copper"),
    _c("sawnwood", "world", "Sawnwood", "intl_commodities",
       metrics=["sawnwood"], region_mode="fixed:global", noun="Sawnwood"),
]

Loader = Callable[[str], object]


def fmt_period(ts: pd.Timestamp, freq: str) -> str:
    ts = pd.Timestamp(ts)
    if freq == "quarterly":
        return f"{['', 'Mar', 'Jun', 'Sep', 'Dec'][ts.quarter]} qtr {ts.year}"
    if freq in ("monthly", "per_decision", "daily"):
        return ts.strftime("%b %Y")
    if freq == "annual":
        return str(ts.year)
    return ts.strftime("%d %b %Y")


def _norm_unit(unit: str) -> str:
    """Normalise a unit string for matching, e.g. 'AUD/week' -> 'aud_per_week'."""
    u = str(unit).strip().lower()
    u = u.replace("/", "_per_")
    u = u.replace(" ", "_")
    return u


def _trim(s: str) -> str:
    """Strip trailing fractional zeros (and a bare trailing '.') from a formatted number."""
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def fmt_value(v: float, unit: str) -> str:
    u = _norm_unit(unit)
    if u == "percent":
        return f"{_trim(f'{v:,.2f}')}%"
    if u == "index":
        return f"{v:,.1f}"
    if u == "aud":
        return f"${v:,.0f}"
    if u == "aud_million":
        return f"${v:,.0f}m"
    if u == "aud_per_week":
        return f"${v:,.0f}/wk"
    if u == "years":
        return f"{v:.1f} yrs"
    if u == "usd_per_aud":  # exchange rate, not a money amount
        return f"{v:,.2f}"
    if u.startswith("usd"):  # any USD-per-commodity money unit
        return f"US${v:,.2f}" if abs(v) < 10 else f"US${v:,.0f}"
    if u in ("dwellings", "applications", "number", "persons", "lots"):
        return f"{v:,.0f}"
    return f"{v:,.2f}"


def _primary_frame(chart: dict, load_series: Loader) -> pd.DataFrame:
    df = load_series(chart["series_id"])
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["date", "region", "metric", "value", "unit"])
    df = df[df["metric"] == chart["primary"]] if chart["primary"] else df
    mode = chart["region_mode"]
    if mode.startswith("fixed:"):
        df = df[df["region"] == mode.split(":", 1)[1]]
    elif mode == "geo":
        for r in ("melbourne", "vic", "australia"):  # finding uses default view
            sub = df[df["region"] == r]
            if len(sub):
                df = sub
                break
    df = df.dropna(subset=["value"]).copy()
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date")


def _generic(chart: dict, load_series: Loader, load_meta: Loader) -> Optional[str]:
    df = _primary_frame(chart, load_series)
    if df.empty:
        return None
    freq = (load_meta(chart["series_id"]) or {}).get("frequency", "monthly")
    v = float(df["value"].iloc[-1])
    unit = str(df["unit"].iloc[-1])
    period = fmt_period(df["date"].iloc[-1], freq)
    noun = chart["noun"] or chart["title"]
    if len(df) < 2:
        return f"{noun} is {fmt_value(v, unit)} in {period}"
    p = float(df["value"].iloc[-2])
    if unit == "percent":  # level series in pp
        d = v - p
        if abs(d) < 0.005:
            return f"{noun} held at {fmt_value(v, unit)} in {period}"
        verb = "rose" if d > 0 else "fell"
        return f"{noun} {verb} {abs(d):.1f} pp to {fmt_value(v, unit)} in {period}"
    if p == 0:
        return f"{noun} is {fmt_value(v, unit)} in {period}"
    pct = (v / p - 1) * 100
    if abs(pct) < 0.05:
        return f"{noun} held at {fmt_value(v, unit)} in {period}"
    verb = "rose" if pct > 0 else "fell"
    return f"{noun} {verb} {abs(pct):.1f}% to {fmt_value(v, unit)} in {period}"


def _hvi(chart, load_series, load_meta, place):
    df = load_series(chart["series_id"])
    if df is None or len(df) == 0:
        return None
    region = chart["region_mode"].split(":", 1)[1]
    mom = df[(df["metric"] == "hvi_change_mom") & (df["region"] == region)]
    if len(mom) == 0:
        return None
    mom = mom.copy()
    mom["date"] = pd.to_datetime(mom["date"])
    mom = mom.sort_values("date")
    v = float(mom["value"].iloc[-1])
    period = fmt_period(mom["date"].iloc[-1], "monthly")
    verb = "rose" if v > 0 else ("fell" if v < 0 else "held flat,")
    yoy = df[(df["metric"] == "hvi_change_yoy") & (df["region"] == region)]
    tail = ""
    if len(yoy):
        y = float(yoy.sort_values("date")["value"].iloc[-1])
        tail = f" ({y:+.1f}% over the year)"
    if v == 0:
        return f"{place} dwelling values held flat in {period}{tail}"
    return f"{place} dwelling values {verb} {abs(v):.1f}% in {period}{tail}"


def _cash_rate(chart, load_series, load_meta):
    df = _primary_frame(chart, load_series)
    if df.empty:
        return None
    v = float(df["value"].iloc[-1])
    changes = df[df["value"].diff().fillna(0) != 0]
    if len(df) >= 2 and float(df["value"].iloc[-2]) == v:
        since_ts = changes["date"].iloc[-1] if len(changes) else df["date"].iloc[0]
        return f"The cash rate has held at {v:g}% since {fmt_period(since_ts, 'monthly')}"
    d = v - float(df["value"].iloc[-2]) if len(df) >= 2 else 0.0
    verb = "cut" if d < 0 else "raised"
    period = fmt_period(df["date"].iloc[-1], "monthly")
    return f"The RBA {verb} the cash rate to {v:g}% in {period}"


def _accord(chart, load_series, load_meta):
    df = load_series(chart["series_id"])
    if df is None or len(df) == 0:
        return None
    df = df.copy()
    df["date"] = pd.to_datetime(df["date"])
    act = df[df["metric"] == "accord_cumulative_actual"].sort_values("date")
    tgt = df[df["metric"] == "accord_cumulative_target"].sort_values("date")
    if act.empty:
        return None
    period = fmt_period(act["date"].iloc[-1], "quarterly")
    if tgt.empty:
        return f"Accord completions reached {float(act['value'].iloc[-1]):,.0f} as at {period}"
    gap = float(tgt["value"].iloc[-1]) - float(act["value"].iloc[-1])
    if gap > 0:
        return f"Completions trail the Accord track by {gap:,.0f} homes as at {period}"
    return f"Completions run {abs(gap):,.0f} homes ahead of the Accord track as at {period}"


def _vacancy(chart, load_series, load_meta):
    df = _primary_frame(chart, load_series)
    if df.empty:
        return None
    freq = (load_meta(chart["series_id"]) or {}).get("frequency", "monthly")
    v = float(df["value"].iloc[-1])
    period = fmt_period(df["date"].iloc[-1], freq)
    if v <= float(df["value"].min()) + 0.1:
        return f"Vacancy holds near record lows at {v:g}% in {period}"
    return _generic({**chart, "noun": "The vacancy rate"}, load_series, load_meta)


_CUSTOM = {
    "hvi_melbourne": lambda c, ls, lm: _hvi(c, ls, lm, "Melbourne"),
    "hvi_australia": lambda c, ls, lm: _hvi(c, ls, lm, "Capital-city"),
    "cash_rate": _cash_rate,
    "accord": _accord,
    "vacancy": _vacancy,
}

NO_DATA_FINDING = "No recent data — source currently unavailable"


def build_findings(load_series: Loader, load_meta: Loader) -> dict[str, str]:
    out: dict[str, str] = {}
    for chart in CHARTS:
        fn = _CUSTOM.get(chart["id"])
        text = fn(chart, load_series, load_meta) if fn \
            else _generic(chart, load_series, load_meta)
        out[chart["id"]] = text or NO_DATA_FINDING
    return out
