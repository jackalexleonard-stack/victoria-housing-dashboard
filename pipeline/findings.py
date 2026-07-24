"""Chart catalogue + computed finding headlines for Dashboard 2.0.

CHARTS is the single source of truth for what the front-end renders: section
membership, series/metrics, region behaviour, and (via build_findings) the
plain-language headline each chart card leads with. Python computes the words
so the SPA stays presentational and the daily run refreshes them.
"""
from __future__ import annotations

import re
from datetime import date
from typing import Callable, Optional

import pandas as pd

from pipeline import scoring

SECTIONS: list[tuple[str, str]] = [
    ("today", "Today"), ("prices", "Prices"), ("rents", "Rents & vacancy"),
    ("supply", "Supply & construction"), ("money", "Money & credit"),
    ("people", "People"), ("social", "Social housing"), ("world", "World"),
    ("news", "News"),
]


def _c(id, section, title, series_id, *, metrics=None, region_mode="geo",
       scope="geo", percent=False, markers=False, annotate=False, noun=None,
       primary=None, note=None, modal_metrics=None, source_name=None):
    """noun: subject of the generic finding sentence; primary: metric it uses
    (defaults to metrics[0]); both ignored by charts with custom rules.
    note: optional short disclosure/methodology line shown under the chart
    (source-window caveats, definition changes, etc.) — None for most charts.
    modal_metrics: optional extra metric list shown only in the detail modal
    (mixed-scale split charts keep a secondary series set there — e.g.
    credit's mom trio, Accord's quarterly pair) — None for most charts.
    source_name: optional per-chart override of the series' one shared
    meta.source_name (design review d2) — needed when several charts share a
    single series_id whose own instruments deserve separate citations (the
    three FRED world charts all read intl_fred, but Brent/AUD-USD/US-10yr
    are different instruments); None for every chart happy with its series'
    single shared source string.
    scope: the FINEST geography this chart is ever available at —
    "geo" (metro/regional specific), "state" (Victoria-wide only; no
    metro/regional split is published), "national" (no sub-national version
    exists), "global" (world context). Drives band placement: a chart whose
    selected geo is absent from its derived `geos` is hidden-and-footnoted
    when scope=="geo", but shown in the badged context band otherwise."""
    return dict(id=id, section=section, title=title, series_id=series_id,
                metrics=metrics, region_mode=region_mode, scope=scope,
                percent=percent, markers=markers, annotate=annotate, noun=noun,
                primary=primary or (metrics[0] if metrics else None),
                note=note, modal_metrics=modal_metrics, source_name=source_name)


_HVI_NOTE = ("Daily index — the free Cotality feed covers a rolling year; "
             "history accumulates from Jul 2025.")
_MEDIAN_RENT_NOTE = ("Metro/Non-Metro medians from DFFH's LGA tables; "
                     "grouping differs slightly from pre-2026 snapshot figures.")
_POP_GCCSA_NOTE = ("Annual ABS data (components of population change by "
                   "GCCSA) — a separate, less-frequent series from the "
                   "quarterly Victoria/Australia population figures above.")
# Task 9/15: the two regions publish on different cadences — Melbourne a full
# year to Dec, Regional Victoria a running half-year "Titled H1" snapshot to
# Jun — disclosed here rather than annualised to match (that would fabricate
# data the source never published; see pipeline/sources/udp.py's caveat).
_LAND_NOTE = ("Melbourne and Regional Victoria publish on different "
              "cadences — Melbourne a full year to Dec, Regional a "
              "half-year \"Titled H1\" snapshot to Jun — not annualised "
              "to match.")


def _strip_cadence_code(label: str) -> str:
    """Mirror web/src/components/HeroTiles.tsx's splitCadenceCode: a few
    registry labels carry a trailing MoM/yr cadence qualifier meant for the
    hero tile's own delta line, not a plain series name — drop it here so
    what's left is the bare name."""
    return re.sub(r"\s*\((MoM|yr)\)\s*$", "", label, flags=re.IGNORECASE)


# Canonical short-name per chart (design review d1: the "Cotality HVI triple"
# fix) — derived straight from scoring.REGISTRY's own hero-tile label (the
# same string HeroTiles.tsx already displays, cadence-code stripped) rather
# than a hand-duplicated literal, so the Cotality HVI pair's card caption
# (chart.title, below) and finding subject (_hvi, below) can never drift from
# what the hero tile itself shows. Deliberately scoped to just the two charts
# with a *documented* naming mismatch (re-verification's "three different
# names for the same two series") — every other chart keeps its own
# independently-authored title untouched.
SERIES_SHORT_NAMES: dict[str, str] = {
    "hvi_melbourne": _strip_cadence_code(scoring.REGISTRY["melb_dwelling_values"]["label"]),
    "hvi_australia": _strip_cadence_code(scoring.REGISTRY["au_dwelling_values"]["label"]),
}


CHARTS: list[dict] = [
    # --- prices ---
    # mean_price leads the section (full-width slot): it carries the longest
    # live history; the HVI daily worms follow (user request 2026-07-21).
    _c("mean_price", "prices", "Mean dwelling price", "au_dwelling_stock",
       metrics=["mean_price"], region_mode="geo", noun="The mean dwelling price"),
    _c("hvi_melbourne", "prices", SERIES_SHORT_NAMES["hvi_melbourne"], "vic_hvi",
       metrics=["hvi_index"], region_mode="fixed:melbourne", annotate=True,
       note=_HVI_NOTE),
    _c("hvi_australia", "prices", SERIES_SHORT_NAMES["hvi_australia"], "au_hvi",
       metrics=["hvi_index"], region_mode="fixed:australia", scope="national",
       annotate=True, note=_HVI_NOTE),
    _c("reiv_median", "prices", "REIV quarterly medians", "vic_median_price",
       region_mode="geo", noun="The median house price",
       primary="median_house_price"),
    # ABS RES_DWELL — the geo audit's worst single gap: Regional Victoria had
    # ZERO dwelling-price data of any kind. Published as separate house /
    # attached-dwelling medians (do NOT blend into one figure — not
    # published); primary=median_price_house drives the headline, mirroring
    # median_rent_by_type's primary=rent_3br_house convention below.
    _c("median_price", "prices", "Median dwelling price", "vic_res_dwell",
       metrics=["median_price_house", "median_price_attached"],
       region_mode="geo", primary="median_price_house",
       noun="The median house price"),
    _c("auctions", "prices", "Auction clearance — Melbourne", "vic_auctions",
       metrics=["clearance_rate"], region_mode="fixed:melbourne", percent=True,
       noun="The clearance rate"),
    # --- rents ---
    _c("rent_growth", "rents", "Rent index growth (annual)", "vic_rents",
       metrics=["rent_growth_annual"], region_mode="geo", percent=True,
       noun="Annual rent growth"),
    _c("median_rent", "rents", "Median weekly rent", "vic_rents",
       metrics=["median_rent"], region_mode="geo",
       noun="The median rent", note=_MEDIAN_RENT_NOTE),
    # Australia-wide rents: this is an ABS CPI PRICE INDEX (weighted average
    # of the eight capital cities), not a bond-based median in dollars — a
    # SEPARATE series/chart from median_rent above, never combined with it.
    # region_mode="fixed:australia" + scope="geo" (not "national"): this
    # only ever carries `australia` rows, so it belongs in the Australia
    # grid, hidden-and-footnoted under Melbourne/Regional/Victoria — exactly
    # like the Victorian rent charts are hidden-and-footnoted under Australia.
    _c("au_rent_index", "rents", "Rent price index — capital cities", "au_rents",
       metrics=["rent_index"], region_mode="fixed:australia", scope="geo",
       note="ABS CPI rents index for the weighted average of eight capital "
            "cities — an index, not a bond-based median; not comparable "
            "with the Victorian median rents above."),
    _c("affordable_share", "rents", "Affordable lettings share", "vic_rents",
       metrics=["affordable_share"], region_mode="geo", percent=True,
       noun="The affordable share of new lettings"),
    _c("median_rent_by_type", "rents", "Median rent by dwelling type", "vic_rents",
       metrics=["rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
                "rent_2br_house", "rent_3br_house", "rent_4br_house"],
       region_mode="geo", noun="The median 3-bedroom-house rent",
       primary="rent_3br_house", note=_MEDIAN_RENT_NOTE),
    _c("vacancy", "rents", "Rental vacancy rate", "vic_vacancy",
       metrics=["vacancy_rate"], region_mode="geo", percent=True),
    # --- supply ---
    _c("approvals", "supply", "Dwelling approvals", "vic_approvals",
       region_mode="geo", noun="Dwelling approvals",
       primary="approvals_dwellings_total"),
    # region_mode="geo", NOT "fixed:vic": vic_activity carries both `vic` and
    # `australia` rows, and pinning it to vic would hide the national data
    # from chart_geos entirely — this is the fix for the audit defect where
    # this chart fell back to showing vic under an Australia selection.
    # scope="state" because no metro/regional split of this series is
    # published; under Melbourne/Regional geo it belongs in the wider-
    # context band, rendered at its own vic geo (contrast: waitlist below
    # correctly keeps region_mode="fixed:vic" — its series has only vic
    # rows, so nothing is hidden by pinning it).
    _c("activity", "supply", "Commencements, completions, pipeline",
       "vic_activity", region_mode="geo", scope="state",
       noun="Dwellings commenced", primary="dwellings_commenced"),
    _c("accord", "supply", "Housing Accord tracker", "au_accord",
       metrics=["accord_cumulative_actual", "accord_cumulative_target"],
       region_mode="fixed:australia", scope="national",
       modal_metrics=["accord_quarterly_actual", "accord_quarterly_target"]),
    # Task 9 landed regional_vic rows; Task 15 flips region_mode from
    # "fixed:melbourne" to "geo" so chart_geos actually picks them up (they
    # sat dormant under the fixed pin) — this is what turns the chart into a
    # genuine metro-vs-regional pair. See _LAND_NOTE for the cadence caveat.
    _c("land", "supply", "Greenfield land supply", "vic_land",
       region_mode="geo", noun="Greenfield years of supply",
       primary="greenfield_years_of_supply", note=_LAND_NOTE),
    _c("input_costs", "supply", "Construction input costs — Melbourne",
       "vic_input_costs", region_mode="fixed:melbourne",
       noun="Input costs", primary="input_all_groups"),
    # ABS PPI OUTPUT index — what builders CHARGE for building construction,
    # a different concept from input_costs above (what Melbourne builders PAY
    # for materials). Separate series (vic_construction_costs), separate
    # chart card, state-level `vic` region (this dataflow publishes no
    # Melbourne/regional split for OUTPUT) — title, note, and metric labels
    # all say "output" explicitly so the two charts are never mistaken for
    # one another, sitting directly below input_costs for easy comparison.
    _c("output_costs", "supply", "Construction output costs — Victoria",
       "vic_construction_costs", region_mode="fixed:vic", scope="state",
       metrics=["output_house_construction", "output_building_construction",
                "output_other_residential"],
       noun="House construction output prices", primary="output_house_construction",
       note="ABS OUTPUT price index — what builders charge, not what they "
            "pay for materials (see input costs above); a different measure, "
            "never combined with it."),
    # --- money ---
    _c("cash_rate", "money", "RBA cash rate target", "au_cash_rate",
       metrics=["cash_rate"], region_mode="fixed:australia", scope="national",
       percent=True, annotate=True),
    _c("mortgage_rates", "money", "Mortgage rates (owner-occupier)",
       "au_mortgage_rates", region_mode="fixed:australia", scope="national",
       percent=True, noun="The average new mortgage rate", primary="mortgage_new"),
    _c("lending", "money", "New housing loan commitments", "au_lending",
       region_mode="geo", annotate=True, noun="Owner-occupier lending",
       primary="lending_owner_occupier"),
    _c("credit", "money", "Housing credit growth (Australia)", "au_credit",
       metrics=["credit_housing_yoy", "credit_investor_yoy",
                "credit_owner_occupier_yoy"],
       region_mode="fixed:australia", scope="national", percent=True,
       annotate=True, noun="Housing credit growth", primary="credit_housing_yoy",
       modal_metrics=["credit_housing_yoy", "credit_investor_yoy",
                      "credit_owner_occupier_yoy", "credit_housing_mom",
                      "credit_investor_mom", "credit_owner_occupier_mom"]),
    # --- people ---
    # ERP (population level) is deliberately excluded here — mixed-scale with
    # NOM/natural increase flattens the section's own finding to invisible
    # (design review P0-5); it gets its own stat tile (extra_tiles) instead.
    _c("population", "people", "Population & migration", "au_population",
       metrics=["net_overseas_migration", "natural_increase"],
       region_mode="geo", noun="Net overseas migration",
       primary="net_overseas_migration"),
    # Melbourne/Regional Vic components of population change (ABS GCCSA,
    # ANNUAL) — a separate series/chart from "population" above (which is
    # quarterly, vic/australia only). ERP is excluded from metrics for the
    # same reason as "population" above: it is millions vs the other
    # components' tens of thousands, so plotting it alongside them would
    # flatten the chart and the finding sentence (design review P0-5).
    _c("population_gccsa", "people", "Population & migration — Melbourne/Regional Vic",
       "vic_population_gccsa",
       metrics=["net_overseas_migration", "net_internal_migration", "natural_increase"],
       region_mode="geo", noun="Net overseas migration",
       primary="net_overseas_migration", note=_POP_GCCSA_NOTE),
    # --- social ---
    _c("waitlist", "social", "Victorian Housing Register", "vic_social_waitlist",
       region_mode="fixed:vic", scope="state",
       noun="Housing Register applications", primary="vhr_total"),
    # Productivity Commission RoGS Part G §18 — public-housing dwelling stock
    # and waitlist, Victoria + Australia. region_mode="geo" (not "fixed:vic"):
    # the series carries both `vic` and `australia` rows, same reasoning as
    # "activity" above — pinning it would hide the national figure from
    # chart_geos entirely. scope="state": RoGS publishes no metro/regional
    # split, only per-jurisdiction. A DIFFERENT figure from the VHR waitlist
    # above — RoGS' own cross-jurisdiction public-housing count, not Homes
    # Victoria's VHR count — never combined with it.
    _c("social_housing_rogs", "social", "Public housing — dwellings & waitlist",
       "au_social_housing",
       metrics=["social_dwellings_public", "social_waitlist_public"],
       region_mode="geo", scope="state",
       noun="The public housing waitlist", primary="social_waitlist_public",
       note="Productivity Commission Report on Government Services (RoGS), "
            "annual — public housing only, not all social housing; a "
            "separate figure from the Victorian Housing Register above."),
    # --- world ---
    # source_name: intl_fred's one shared meta.source_name ("FRED — Brent
    # crude, US 10yr Treasury, AUD/USD") reads fine on the card caption
    # (shortSource collapses all three to "FRED" regardless), but the detail
    # modal renders meta.source_name RAW — showing the identical three-in-one
    # string on every one of these three cards (design review d2). Each
    # chart cites its own FRED series id instead.
    _c("brent", "world", "Brent crude", "intl_fred", metrics=["brent_crude"],
       region_mode="fixed:global", scope="global", noun="Brent crude",
       source_name="FRED — Brent crude (DCOILBRENTEU)"),
    _c("aud_usd", "world", "AUD/USD", "intl_fred", metrics=["aud_usd"],
       region_mode="fixed:global", scope="global", noun="The Australian dollar",
       source_name="FRED — AUD/USD (DEXUSAL)"),
    _c("ust10", "world", "US 10-year Treasury", "intl_fred",
       metrics=["us_10y_treasury"], region_mode="fixed:global", scope="global",
       percent=True, noun="The US 10-year yield",
       source_name="FRED — US 10-year Treasury (DGS10)"),
    _c("iron_ore", "world", "Iron ore", "intl_commodities",
       metrics=["iron_ore"], region_mode="fixed:global", scope="global",
       noun="Iron ore"),
    _c("copper", "world", "Copper", "intl_commodities", metrics=["copper"],
       region_mode="fixed:global", scope="global", noun="Copper"),
    _c("sawnwood", "world", "Sawnwood", "intl_commodities",
       metrics=["sawnwood"], region_mode="fixed:global", scope="global",
       noun="Sawnwood"),
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
    if u in ("dwellings", "applications", "number", "persons", "lots", "applicants"):
        return f"{v:,.0f}"
    return f"{v:,.2f}"


def _primary_frame(chart: dict, load_series: Loader, geo: str) -> pd.DataFrame:
    df = load_series(chart["series_id"])
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["date", "region", "metric", "value", "unit"])
    df = df[df["metric"] == chart["primary"]] if chart["primary"] else df
    mode = chart["region_mode"]
    if mode.startswith("fixed:"):
        df = df[df["region"] == mode.split(":", 1)[1]]
    else:
        # Exactly the requested geo — never a fallback. A geo with no rows
        # yields an empty frame, and the caller emits no finding for it.
        df = df[df["region"] == geo]
    df = df.dropna(subset=["value"]).copy()
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date")


# Both branches below route |delta| smaller than half the *displayed*
# precision to "held at" — otherwise rounding-to-display can show "rose 0.0
# pp"/"fell 0.0%", a factually-wrong move on a brand built on precision
# (design review P1-copy). Display precision is 1dp in both branches, so the
# cutoff is half of 0.1.
HELD_THRESHOLD_PP = 0.05     # percent-unit (pp) branch — was 0.005, too tight
HELD_THRESHOLD_PCT = 0.05    # percent-of-value branch — already aligned


def _generic(chart: dict, load_series: Loader, load_meta: Loader,
             geo: str) -> Optional[str]:
    df = _primary_frame(chart, load_series, geo)
    if df.empty:
        return None
    freq = (load_meta(chart["series_id"]) or {}).get("frequency", "monthly")
    v = float(df["value"].iloc[-1])
    unit = str(df["unit"].iloc[-1])
    period = fmt_period(df["date"].iloc[-1], freq)
    noun = chart["noun"] or chart["title"]
    if len(df) < 2:
        return f"{noun} was {fmt_value(v, unit)} in {period}"
    p = float(df["value"].iloc[-2])
    if unit == "percent":  # level series in pp
        d = v - p
        if abs(d) < HELD_THRESHOLD_PP:
            return f"{noun} held at {fmt_value(v, unit)} in {period}"
        verb = "rose" if d > 0 else "fell"
        return f"{noun} {verb} {abs(d):.1f} pp to {fmt_value(v, unit)} in {period}"
    if p == 0:
        return f"{noun} was {fmt_value(v, unit)} in {period}"
    pct = (v / p - 1) * 100
    if abs(pct) < HELD_THRESHOLD_PCT:
        return f"{noun} held at {fmt_value(v, unit)} in {period}"
    verb = "rose" if pct > 0 else "fell"
    return f"{noun} {verb} {abs(pct):.1f}% to {fmt_value(v, unit)} in {period}"


def _hvi(chart, load_series, load_meta):
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
    # Design review d1: the sentence's subject is the SAME canonical short
    # name the hero tile/card caption use (SERIES_SHORT_NAMES, above) —
    # "Melb dwelling values"/"AU dwelling values" — not a hand-written
    # "Melbourne"/"Capital-city" + " dwelling values" phrase that could drift
    # from what the rest of the UI calls this series.
    subject = SERIES_SHORT_NAMES.get(chart["id"], chart["title"])
    verb = "rose" if v > 0 else "fell"
    yoy = df[(df["metric"] == "hvi_change_yoy") & (df["region"] == region)]
    tail = ""
    if len(yoy):
        y = float(yoy.sort_values("date")["value"].iloc[-1])
        tail = f" ({y:+.1f}% over the year)"
    # Backlog cleanup: an exact `v == 0` check missed the same near-zero-but-
    # displays-as-0.0 case _generic's HELD_THRESHOLD_PP already fixed
    # elsewhere (design review P1-copy) — a mom of e.g. 0.03 rounds to "0.0%"
    # at this sentence's own 1dp precision, so it must read "held flat", not
    # "rose 0.0%". Same threshold, same display precision, same bug class.
    if abs(v) < HELD_THRESHOLD_PP:
        return f"{subject} held flat in {period}{tail}"
    return f"{subject} {verb} {abs(v):.1f}% in {period}{tail}"


def _cash_rate(chart, load_series, load_meta, geo):
    df = _primary_frame(chart, load_series, geo)
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


def _vacancy(chart, load_series, load_meta, geo):
    df = _primary_frame(chart, load_series, geo)
    if df.empty:
        return None
    freq = (load_meta(chart["series_id"]) or {}).get("frequency", "monthly")
    v = float(df["value"].iloc[-1])
    period = fmt_period(df["date"].iloc[-1], freq)
    if v <= float(df["value"].min()) + 0.1:
        return f"Vacancy holds near record lows at {v:g}% in {period}"
    return _generic({**chart, "noun": "The vacancy rate"}, load_series, load_meta, geo)


_CUSTOM = {
    "hvi_melbourne": _hvi,
    "hvi_australia": _hvi,
    "cash_rate": _cash_rate,
    "accord": _accord,
    "vacancy": _vacancy,
}

# Which _CUSTOM builders reach _primary_frame (and so need geo threaded
# through). _hvi and _accord read load_series directly and are already
# pinned to a single region via chart["region_mode"] ("fixed:melbourne" /
# "fixed:australia" for _hvi; "fixed:australia" for _accord) — they keep
# their original 3-arg form.
_GEO_AWARE_CUSTOM = {"cash_rate", "vacancy"}

NO_DATA_FINDING = "No recent data — source currently unavailable"


def _finding_for(chart: dict, load_series: Loader, load_meta: Loader,
                 geo: str) -> Optional[str]:
    """The per-chart dispatch (custom-builder lookup falling back to
    _generic), now geo-aware: every path that reaches _primary_frame is
    threaded this exact geo, never a fallback region."""
    cid = chart["id"]
    fn = _CUSTOM.get(cid)
    if fn is None:
        return _generic(chart, load_series, load_meta, geo)
    if cid in _GEO_AWARE_CUSTOM:
        return fn(chart, load_series, load_meta, geo)
    return fn(chart, load_series, load_meta)


def build_findings(load_series: Loader, load_meta: Loader) -> dict[str, dict[str, str]]:
    from pipeline.export import chart_geos     # local import avoids a cycle
    out: dict[str, dict[str, str]] = {}
    for chart in CHARTS:
        per_geo: dict[str, str] = {}
        for geo in chart_geos(chart, load_series):
            sentence = _finding_for(chart, load_series, load_meta, geo)
            if sentence:
                per_geo[geo] = sentence
        out[chart["id"]] = per_geo
    return out


# ---------------------------------------------------------------------------
# Per-metric display labels (design review P1-labels) — translates raw column
# identifiers ("credit_housing_mom") into sentence-case, prefix-stripped,
# abbreviation-expanded legend/table text. Hand-picked for every metric
# actually present in the committed data; anything new falls back to a plain
# humanisation rather than crashing.
# ---------------------------------------------------------------------------
METRIC_LABELS: dict[str, str] = {
    # credit — three series, mom/yoy cadence (card shows yoy, modal both)
    "credit_housing_mom": "Housing, monthly", "credit_housing_yoy": "Housing, annual",
    "credit_investor_mom": "Investor, monthly", "credit_investor_yoy": "Investor, annual",
    "credit_owner_occupier_mom": "Owner-occupier, monthly",
    "credit_owner_occupier_yoy": "Owner-occupier, annual",
    # rents
    "median_rent": "Median rent", "affordable_share": "Affordable share",
    "rent_growth_annual": "Annual rent growth",
    "rent_1br_flat": "1-bed flat", "rent_2br_flat": "2-bed flat",
    "rent_3br_flat": "3-bed flat", "rent_2br_house": "2-bed house",
    "rent_3br_house": "3-bed house", "rent_4br_house": "4-bed house",
    "vacancy_rate": "Vacancy rate", "rent_index": "Rent price index",
    # mortgage rates — new/outstanding x fixed/variable
    "mortgage_new": "New (average)", "mortgage_new_fixed": "New — fixed",
    "mortgage_new_variable": "New — variable",
    "mortgage_outstanding": "Outstanding (average)",
    "mortgage_outstanding_fixed": "Outstanding — fixed",
    "mortgage_outstanding_variable": "Outstanding — variable",
    # accord — cumulative (card) vs quarterly (modal)
    "accord_cumulative_actual": "Actual (cumulative)",
    "accord_cumulative_target": "Target (cumulative)",
    "accord_quarterly_actual": "Actual (quarterly)",
    "accord_quarterly_target": "Target (quarterly)",
    # population & migration
    "net_overseas_migration": "Net overseas migration",
    "net_internal_migration": "Net internal migration",
    "natural_increase": "Natural increase",
    "population_erp": "Resident population",
    "population_growth_qtr": "Quarterly growth",
    # social housing register
    "vhr_total": "Total applications", "vhr_priority": "Priority applications",
    "vhr_register_of_interest": "Register of interest",
    # RoGS public housing (dwellings & waitlist)
    "social_dwellings_public": "Public housing dwellings",
    "social_waitlist_public": "Public housing waitlist",
    # greenfield land supply
    "greenfield_lot_supply": "Lot supply", "greenfield_lots_titled": "Lots titled",
    "greenfield_years_of_supply": "Years of supply",
    # construction input costs
    "input_all_groups": "All groups", "input_cement": "Cement",
    "input_steel": "Steel", "input_timber": "Timber",
    # construction output costs (what builders charge, vs input above)
    "output_house_construction": "House construction (output)",
    "output_other_residential": "Other residential (output)",
    "output_building_construction": "All building construction (output)",
    # dwelling activity
    "dwellings_commenced": "Commenced", "dwellings_completed": "Completed",
    "dwellings_under_construction": "Under construction",
    # approvals
    "approvals_dwellings_total": "Total dwellings", "approvals_houses": "Houses",
    "approvals_other_residential": "Other residential",
    # lending
    "lending_owner_occupier": "Owner-occupier", "lending_investor": "Investor",
    "lending_first_home_buyer": "First home buyer", "lending_total": "Total",
    # HVI
    "hvi_index": "Index level", "hvi_change_mom": "Monthly change",
    "hvi_change_yoy": "Annual change",
    # prices
    "mean_price": "Mean price", "dwelling_count": "Dwelling count",
    "clearance_rate": "Clearance rate", "median_house_price": "Median house price",
    "median_price_house": "House", "median_price_attached": "Attached dwelling",
    # cash rate
    "cash_rate": "Cash rate",
    # world
    "brent_crude": "Brent crude", "aud_usd": "AUD/USD",
    "us_10y_treasury": "US 10-year yield",
    "copper": "Copper", "iron_ore": "Iron ore", "sawnwood": "Sawnwood",
}


def _humanize_metric(metric: str) -> str:
    """Defensive fallback for any metric not yet in METRIC_LABELS — plain
    sentence case, no abbreviation expansion. Keeps build_metric_labels total
    over whatever the data happens to contain, rather than raising."""
    s = metric.replace("_", " ").strip()
    return s[:1].upper() + s[1:] if s else s


def build_metric_labels(load_series: Loader) -> dict[str, str]:
    """{metric: display label} for every metric present in every charted
    series (not just the ones a split card plots — the modal/table can show
    more), plus every metric a chart *declares* (metrics/modal_metrics) even
    when its source currently has no data — e.g. auctions' clearance_rate,
    a never-succeeded source (design review P1-outage) — so the label is
    ready the day the source recovers rather than appearing only once it
    already has data."""
    out: dict[str, str] = {}
    for chart in CHARTS:
        wanted = set(chart["metrics"] or []) | set(chart["modal_metrics"] or [])
        df = load_series(chart["series_id"])
        if df is not None and len(df):
            wanted |= {str(m) for m in df["metric"].dropna().unique()}
        for m in wanted:
            if m not in out:
                out[m] = METRIC_LABELS.get(m) or _humanize_metric(m)
    return out


# ---------------------------------------------------------------------------
# Section summaries (feeds design review P0-3 collapsed rows, and P1-World's
# synthesized lead line) — one Newsreader-ready sentence per content section.
# Reuses existing finding machinery: the winning chart is whichever maps to
# the most notable REGISTRY key (scoring.score_metric — the same notability
# hero picks use), and its sentence is build_findings' own output verbatim
# (no prefix). Quiet/unscoreable sections get honest quiet phrasing rather
# than silently repeating whichever chart happens to be first.
# ---------------------------------------------------------------------------
_CHART_TILE_KEY: dict[str, str] = {v: k for k, v in scoring.TILE_CHART.items()}

_QUIET_SUMMARY = "No notable moves in {title} this week."

# World gets a bespoke rule (not the generic mover-lookup above) because five
# of its six charts (brent, AUD/USD, US 10-yr, copper, sawnwood) have no
# REGISTRY key at all — only iron_ore does — so the generic path could never
# consider them. "Quiet" here means the move is too small to be worth naming
# (design review: "a third of World's findings say nothing happened").
WORLD_QUIET_PCT = 1.0   # abs %-change floor for non-percent-unit World series
WORLD_QUIET_PP = 0.15   # abs pp-change floor for the one percent-unit series (UST 10yr)
WORLD_QUIET_SUMMARY = "The world backdrop was quiet this week."


def _section_mover_chart_id(section_id: str, load_series: Loader, load_meta: Loader,
                            today: date) -> Optional[str]:
    best_id, best_n = None, -1.0
    for chart in CHARTS:
        if chart["section"] != section_id:
            continue
        reg_key = _CHART_TILE_KEY.get(chart["id"])
        if reg_key is None:
            continue
        result = scoring.score_metric(reg_key, load_series, load_meta, today)
        if result is not None and result["n"] > best_n:
            best_n, best_id = result["n"], chart["id"]
    return best_id


def _world_summary(load_series: Loader, load_meta: Loader) -> tuple[str, bool]:
    """(summary text, is_quiet) — chosen together, right where
    WORLD_QUIET_SUMMARY is authored, rather than leaving the caller to
    recover "was this actually quiet?" later by re-comparing the returned
    text against the sentinel string (design review honesty-override class,
    T6 — the same drift risk that motivated section_summary_quiet in the
    first place, just for World's bespoke path instead of the generic one).

    Every World chart is region_mode "fixed:global", and "global" is
    deliberately excluded from UI_GEOS (chart_geos never lists it — see
    export.UI_GEOS) — so build_findings' per-geo output never carries an
    entry for any of these six charts. The mover's sentence is therefore
    computed directly here via _finding_for rather than looked up from a
    findings dict that is permanently empty for this section."""
    best = None  # (magnitude, chart)
    for chart in CHARTS:
        if chart["section"] != "world":
            continue
        geo = chart["region_mode"].split(":", 1)[1]  # ignored by the fixed-
        df = _primary_frame(chart, load_series, geo)  # mode branch below
        if len(df) < 2:
            continue
        v, p = float(df["value"].iloc[-1]), float(df["value"].iloc[-2])
        unit = str(df["unit"].iloc[-1])
        if unit == "percent":
            mag, floor = abs(v - p), WORLD_QUIET_PP
        else:
            if p == 0:
                continue
            mag, floor = abs((v / p - 1) * 100), WORLD_QUIET_PCT
        if mag < floor:
            continue
        if best is None or mag > best[0]:
            best = (mag, chart)
    if best is None:
        return WORLD_QUIET_SUMMARY, True
    winner = best[1]
    text = _finding_for(winner, load_series, load_meta,
                        winner["region_mode"].split(":", 1)[1])
    if not text:
        return WORLD_QUIET_SUMMARY, True
    return text, False


_SUMMARY_SECTIONS = ("prices", "rents", "supply", "money", "people", "social", "world")


def build_section_summaries_full(load_series: Loader, load_meta: Loader,
                                 today: date) -> tuple[dict[str, dict[str, str]], dict[str, bool]]:
    """(section_summaries, section_summary_quiet) in one pass — the quiet
    flag is derived right here, where the _QUIET_SUMMARY/WORLD_QUIET_SUMMARY
    sentinels are authored, rather than by string-matching the rendered
    sentence later (design review honesty-override upgrade, T6): the
    collapsed-section override must not depend on prose staying byte-
    identical to these two constants.

    T4 Step 4.4b: section_summaries is per-geo ({section: {geo: sentence}}),
    mirroring `findings` — this used to collapse to ONE sentence via
    `next(iter(per_geo.values()), None)`, which always quoted Melbourne
    whenever Melbourne had data (every non-World section's mover chart —
    median_rent, vacancy, mean_price, approvals, lending, population, ... —
    is region_mode="geo"). That was the same Melbourne-bias defect Task 2
    fixed for per-chart headlines, recreated here one level up. Fixed by
    using the mover's own per-geo findings dict directly instead of
    collapsing it — a section whose mover has data for multiple geos now
    genuinely has a different sentence per geo."""
    from pipeline.export import UI_GEOS   # local import avoids a cycle

    findings_out = build_findings(load_series, load_meta)
    titles = dict(SECTIONS)
    text: dict[str, dict[str, str]] = {}
    quiet: dict[str, bool] = {}
    for section_id in _SUMMARY_SECTIONS:
        if section_id == "world":
            summary, is_quiet = _world_summary(load_series, load_meta)
            # World's charts are all region_mode="fixed:global" — genuinely
            # geo-independent (see _world_summary's own docstring) — so the
            # one sentence applies equally under every UI geo.
            text[section_id] = {g: summary for g in UI_GEOS}
            quiet[section_id] = is_quiet
            continue
        mover = _section_mover_chart_id(section_id, load_series, load_meta, today)
        # findings_out[mover] is already {geo: sentence} (build_findings,
        # Task 2) — using it directly, rather than collapsing to one entry,
        # is exactly what makes this section-summary honestly per-geo.
        per_geo = (findings_out.get(mover) or {}) if mover else {}
        is_quiet = not per_geo
        if is_quiet:
            quiet_sentence = _QUIET_SUMMARY.format(title=titles[section_id])
            text[section_id] = {g: quiet_sentence for g in UI_GEOS}
        else:
            text[section_id] = dict(per_geo)
        quiet[section_id] = is_quiet
    return text, quiet


def build_section_summaries(load_series: Loader, load_meta: Loader,
                            today: date) -> dict[str, dict[str, str]]:
    text, _ = build_section_summaries_full(load_series, load_meta, today)
    return text
