"""Pure scoring logic for the dashboard — no streamlit import, fully unit-testable.

Two scorers live here, plus the indicator registry both consume:

* **News importance** — ranks stored headlines for the "Top stories" rows.
  ``score = decay(age) × (W_src + W_tags + W_vic + W_policy + W_dup)``.
* **Hero notability** — decides which metrics earn the rotating hero-strip slots
  by detecting recent trend changes: ``N = 0.5·Z + 0.3·F + 0.2·R`` where Z is the
  robust surprise of the latest change vs its trailing distribution, F flags a
  3-period trend flip, and R rewards a genuinely fresh (rare-cadence) data print.

Data access is injected (``load_series``/``load_meta`` callables) so tests pass
fakes. Selection is deterministic given (committed data, calendar date): no
randomness, no time-of-day, registry order breaks ties.
"""
from __future__ import annotations

import math
import re
from datetime import date
from typing import Callable, Optional

import pandas as pd

# ---------------------------------------------------------------------------
# Shared constants
# ---------------------------------------------------------------------------
# Normal cadence (days) per frequency; a series is red-stale past ~2.5x this gap
# (the same rule the dashboard badges use).
NORMAL_CADENCE = {
    "daily": 3, "weekly": 8, "monthly": 31, "quarterly": 92, "annual": 366, "per_decision": 92,
}


def norm_title(title: str) -> str:
    """Normalise a headline (same logic as the pipeline's dedup — copied, not
    imported, because Streamlit Cloud only ships the app)."""
    t = re.sub(r"\s+-\s+[^-]+$", "", title.strip())
    t = re.sub(r"[^\w\s]", " ", t.lower())
    return re.sub(r"\s+", " ", t).strip()


# ---------------------------------------------------------------------------
# News importance score
# ---------------------------------------------------------------------------
HALF_LIFE_DAYS = 2.0
_DEFAULT_AGE = 7  # malformed/missing published date

W_SRC = {
    "RBA": 5.0,
    "Premier of Victoria": 4.0,
    "Cotality": 4.0,
    "The Age": 3.0,
    "ABC News": 3.0,
    "The Urban Developer": 2.5,
    "Guardian Australia": 2.5,
    "The Conversation": 2.0,
    "Google News": 1.5,
}
_W_SRC_DEFAULT = 1.5

TAG_VALUE = {
    "policy": 2.0, "prices": 2.0, "rents": 1.5,
    "supply_construction": 1.5, "construction_costs": 1.0, "international": 0.5,
}
_TAG_DEFAULT = 0.5

_VIC_KEYWORDS = [
    "melbourne", "victoria", "victorian", "victorians", "vic",
    "geelong", "ballarat", "bendigo", "werribee", "tarneit", "craigieburn",
    "melton", "wyndham", "whittlesea", "casey", "frankston", "dandenong",
    "footscray", "brunswick", "docklands", "fishermans bend",
    "growth corridor", "growth corridors", "allan government", "big housing build",
]
_POLICY_KEYWORDS = [
    "cash rate", "rate cut", "rate cuts", "rate rise", "rate rises",
    "rate hike", "rate hikes", "rate decision", "rba", "reserve bank",
    "negative gearing", "stamp duty", "capital gains tax", "first home",
    "help to buy", "shared equity", "housing accord", "housing target",
    "housing targets", "social housing", "affordable housing", "rezoning",
    "planning reform", "activity centre", "activity centres", "rent freeze",
    "rental cap", "rent caps", "vacancy tax", "land tax",
]
_VIC_RE = re.compile(r"\b(?:" + "|".join(re.escape(k) for k in _VIC_KEYWORDS) + r")\b", re.I)
_POLICY_RE = re.compile(r"\b(?:" + "|".join(re.escape(k) for k in _POLICY_KEYWORDS) + r")\b", re.I)


def _age_days(published: str, today: date) -> float:
    try:
        d = date.fromisoformat(str(published))
    except (ValueError, TypeError):
        return _DEFAULT_AGE
    return max(0, (today - d).days)


def score_news(item: dict, today: date) -> float:
    """Importance of one stored headline. Higher is better."""
    decay = 0.5 ** (_age_days(item.get("published", ""), today) / HALF_LIFE_DAYS)
    w_src = W_SRC.get(item.get("source", ""), _W_SRC_DEFAULT)
    tags = item.get("tags") or []
    w_tags = 0.0
    if tags:
        w_tags = max(TAG_VALUE.get(t, _TAG_DEFAULT) for t in tags)
        w_tags += min(0.5 * (len(tags) - 1), 1.5)  # breadth bonus, capped
    title = item.get("title", "")
    w_vic = 2.0 if _VIC_RE.search(title) else 0.0        # flat, no stacking
    w_policy = 1.5 if _POLICY_RE.search(title) else 0.0  # flat, no stacking
    w_dup = 1.5 * min(len(item.get("dup_sources", [])), 3)
    return decay * (w_src + w_tags + w_vic + w_policy + w_dup)


def rank_news(items: list[dict], today: date) -> list[dict]:
    """Deterministic importance ordering: score desc, then newer, then stronger
    source, then normalised title, then URL."""
    def key(it: dict):
        try:
            pub_ord = date.fromisoformat(str(it.get("published", ""))).toordinal()
        except (ValueError, TypeError):
            pub_ord = 0
        return (
            -round(score_news(it, today), 6),
            -pub_ord,
            -W_SRC.get(it.get("source", ""), _W_SRC_DEFAULT),
            norm_title(it.get("title", "")),
            it.get("url", ""),
        )
    return sorted(items, key=key)


def top_stories(items: list[dict], today: date, n: int = 4,
                min_score: float = 2.0, max_age_days: int = 7) -> list[dict]:
    """The n most important recent stories. Never pads with weak items — if
    fewer qualify, fewer are returned (an empty section collapses)."""
    ranked = rank_news(items, today)
    out = [it for it in ranked
           if score_news(it, today) >= min_score
           and _age_days(it.get("published", ""), today) <= max_age_days]
    return out[:n]


# ---------------------------------------------------------------------------
# Indicator registry (rendering + scoring, one entry per headline-able metric)
# ---------------------------------------------------------------------------
# Fields: label/tab/delta_color/value_fmt/delta_fmt (rendering);
# series_id/metric/region (data); score_kind diff|pct + resample (scoring);
# delta_mode diff|pct|none (display delta); composite hvi|accord overrides the
# displayed value/delta; hero marks rotating-strip eligibility.
def _e(label, tab, series_id, metric, region, *, score_kind, delta_mode,
       value_fmt, delta_fmt, delta_color="normal", hero=True,
       composite=None, resample=None) -> dict:
    return dict(label=label, tab=tab, series_id=series_id, metric=metric,
                region=region, score_kind=score_kind, delta_mode=delta_mode,
                value_fmt=value_fmt, delta_fmt=delta_fmt, delta_color=delta_color,
                hero=hero, composite=composite, resample=resample)


REGISTRY: dict[str, dict] = {
    # --- hero-eligible core (insertion order = tiebreak priority) ---
    "cash_rate": _e("RBA cash rate", "National", "au_cash_rate", "cash_rate", "australia",
                    score_kind="diff", delta_mode="diff",
                    value_fmt=lambda v: f"{v:.2f}%", delta_fmt=lambda d: f"{d:+.2f} pp",
                    delta_color="inverse"),
    "melb_dwelling_values": _e("Melb dwelling values (MoM)", "Victoria",
                    "vic_hvi", "hvi_index", "melbourne",
                    score_kind="pct", delta_mode="none", composite="hvi", resample="ME",
                    value_fmt=lambda v: f"{v:+.1f}%", delta_fmt=lambda d: f"{d:+.1f}% yr"),
    "au_dwelling_values": _e("AU dwelling values (MoM)", "National",
                    "au_hvi", "hvi_index", "australia",
                    score_kind="pct", delta_mode="none", composite="hvi", resample="ME",
                    value_fmt=lambda v: f"{v:+.1f}%", delta_fmt=lambda d: f"{d:+.1f}% yr"),
    "vic_mean_price": _e("Vic mean dwelling price", "Victoria",
                    "au_dwelling_stock", "mean_price", "vic",
                    score_kind="pct", delta_mode="pct",
                    value_fmt=lambda v: f"${v/1000:,.0f}k", delta_fmt=lambda d: f"{d:+.1f}% qtr"),
    "vic_approvals": _e("Vic dwelling approvals (mth)", "Victoria",
                    "vic_approvals", "approvals_dwellings_total", "vic",
                    score_kind="pct", delta_mode="diff",
                    value_fmt=lambda v: f"{v:,.0f}", delta_fmt=lambda d: f"{d:+,.0f}"),
    "accord_runrate": _e("Accord run-rate (qtr)", "National",
                    "au_accord", "accord_quarterly_actual", "australia",
                    score_kind="pct", delta_mode="none", composite="accord",
                    value_fmt=lambda v: f"{v:,.0f}",
                    delta_fmt=lambda d: f"{d:+,.0f} vs 60k target"),
    "melb_vacancy": _e("Rental vacancy — Melbourne", "Victoria",
                    "vic_vacancy", "vacancy_rate", "melbourne",
                    score_kind="diff", delta_mode="diff",
                    value_fmt=lambda v: f"{v:.1f}%", delta_fmt=lambda d: f"{d:+.1f} pp",
                    delta_color="off"),
    "melb_rent_growth": _e("Melb rent growth (yr)", "Victoria",
                    "vic_rents", "rent_growth_annual", "melbourne",
                    score_kind="diff", delta_mode="diff",
                    value_fmt=lambda v: f"{v:+.1f}%", delta_fmt=lambda d: f"{d:+.1f} pp"),
    "credit_growth": _e("Housing credit growth (yr)", "National",
                    "au_credit", "credit_housing_yoy", "australia",
                    score_kind="diff", delta_mode="diff",
                    value_fmt=lambda v: f"{v:.1f}%", delta_fmt=lambda d: f"{d:+.1f} pp"),
    "mortgage_new": _e("New mortgage rate (OO)", "National",
                    "au_mortgage_rates", "mortgage_new", "australia",
                    score_kind="diff", delta_mode="diff",
                    value_fmt=lambda v: f"{v:.2f}%", delta_fmt=lambda d: f"{d:+.2f} pp",
                    delta_color="inverse"),
    "vic_commencements": _e("Vic dwellings commenced (qtr)", "Victoria",
                    "vic_activity", "dwellings_commenced", "vic",
                    score_kind="pct", delta_mode="diff",
                    value_fmt=lambda v: f"{v:,.0f}", delta_fmt=lambda d: f"{d:+,.0f}"),
    "vhr_waitlist": _e("Housing Register applications", "Victoria",
                    "vic_social_waitlist", "vhr_total", "vic",
                    score_kind="pct", delta_mode="diff",
                    value_fmt=lambda v: f"{v:,.0f}", delta_fmt=lambda d: f"{d:+,.0f}",
                    delta_color="inverse"),
    "nom": _e("Net overseas migration (qtr)", "National",
                    "au_population", "net_overseas_migration", "australia",
                    score_kind="pct", delta_mode="diff",
                    value_fmt=lambda v: f"{v:,.0f}", delta_fmt=lambda d: f"{d:+,.0f}",
                    delta_color="off"),
    "input_costs": _e("Melb construction input costs", "Victoria",
                    "vic_input_costs", "input_all_groups", "melbourne",
                    score_kind="pct", delta_mode="pct",
                    value_fmt=lambda v: f"{v:,.1f}", delta_fmt=lambda d: f"{d:+.1f}% qtr",
                    delta_color="inverse"),
    "iron_ore": _e("Iron ore", "International",
                    "intl_commodities", "iron_ore", "global",
                    score_kind="pct", delta_mode="pct",
                    value_fmt=lambda v: f"US${v:,.0f}", delta_fmt=lambda d: f"{d:+.1f}% mth"),
    # --- What's-new-only entries (never on the hero strip) ---
    "melb_rent": _e("Median rent — Melbourne", "Victoria",
                    "vic_rents", "median_rent", "melbourne",
                    score_kind="diff", delta_mode="diff", hero=False,
                    value_fmt=lambda v: f"${v:,.0f}/wk", delta_fmt=lambda d: f"{d:+,.0f}/wk"),
    "greenfield_supply": _e("Greenfield years of supply", "Victoria",
                    "vic_land", "greenfield_years_of_supply", "melbourne",
                    score_kind="diff", delta_mode="diff", hero=False,
                    value_fmt=lambda v: f"{v:,.1f} yrs", delta_fmt=lambda d: f"{d:+.1f}"),
    "melb_median_house": _e("Melb median house (REIV)", "Victoria",
                    "vic_median_price", "median_house_price", "melbourne",
                    score_kind="pct", delta_mode="pct", hero=False,
                    value_fmt=lambda v: f"${v/1000:,.0f}k", delta_fmt=lambda d: f"{d:+.1f}% qtr"),
    "melb_clearance": _e("Melb auction clearance", "Victoria",
                    "vic_auctions", "clearance_rate", "melbourne",
                    score_kind="diff", delta_mode="diff", hero=False,
                    value_fmt=lambda v: f"{v:.0f}%", delta_fmt=lambda d: f"{d:+.0f} pp"),
    "oo_lending": _e("New loans — owner-occupier", "National",
                    "au_lending", "lending_owner_occupier", "australia",
                    score_kind="pct", delta_mode="pct", hero=False,
                    value_fmt=lambda v: f"${v:,.0f}m", delta_fmt=lambda d: f"{d:+.1f}% qtr"),
}

PINNED = ["cash_rate", "melb_dwelling_values"]  # always rendered first
HERO_SLOTS = 5
QUALIFY = 0.25
DEFAULT_ORDER = [  # today's fixed strip first, then sensible extras
    "cash_rate", "melb_dwelling_values", "vic_mean_price", "vic_approvals",
    "accord_runrate", "melb_vacancy", "au_dwelling_values", "mortgage_new",
    "credit_growth", "iron_ore",
]

# One headline card per series for "What's new in the data". Daily-cadence
# series (intl_fred, vic_hvi, au_hvi) are deliberately absent: they change every
# single day, so they would permanently occupy the section without ever being
# news — the hero strip and charts carry them instead.
WHATS_NEW_TILE = {
    "au_cash_rate": "cash_rate", "au_dwelling_stock": "vic_mean_price",
    "vic_approvals": "vic_approvals", "au_accord": "accord_runrate",
    "vic_vacancy": "melb_vacancy", "vic_rents": "melb_rent",
    "au_credit": "credit_growth", "au_mortgage_rates": "mortgage_new",
    "vic_activity": "vic_commencements", "vic_social_waitlist": "vhr_waitlist",
    "au_population": "nom", "vic_input_costs": "input_costs",
    "intl_commodities": "iron_ore", "vic_land": "greenfield_supply",
    "vic_median_price": "melb_median_house", "vic_auctions": "melb_clearance",
    "au_lending": "oo_lending",
}

# Registry key -> the chart id whose card the key's finding belongs to. Mirror
# of web/src/components/HeroTiles.tsx's TILE_CHART, kept in sync by hand —
# lets the pipeline (section summaries, lead pick) reuse the exact same
# key<->chart association the front-end uses to route hero-tile taps.
TILE_CHART: dict[str, str] = {
    "cash_rate": "cash_rate", "melb_dwelling_values": "hvi_melbourne",
    "au_dwelling_values": "hvi_australia", "vic_mean_price": "mean_price",
    "vic_approvals": "approvals", "accord_runrate": "accord",
    "melb_vacancy": "vacancy", "melb_rent_growth": "rent_growth",
    "credit_growth": "credit", "mortgage_new": "mortgage_rates",
    "vic_commencements": "activity", "vhr_waitlist": "waitlist",
    "nom": "population", "input_costs": "input_costs", "iron_ore": "iron_ore",
    "melb_rent": "median_rent", "greenfield_supply": "land",
    "melb_median_house": "reiv_median", "melb_clearance": "auctions",
    "oo_lending": "lending",
}

Loader = Callable[[str], object]  # load_series(id) -> DataFrame; load_meta(id) -> dict


# ---------------------------------------------------------------------------
# Tile values (display)
# ---------------------------------------------------------------------------
def _series_values(load_series: Loader, sid: str, metric: str,
                   region: Optional[str]) -> pd.DataFrame:
    df = load_series(sid)
    if df is None or len(df) == 0:
        return pd.DataFrame(columns=["date", "value"])
    df = df[df["metric"] == metric]
    if region is not None:
        df = df[df["region"] == region]
    df = df.dropna(subset=["value"]).copy()
    df["date"] = pd.to_datetime(df["date"])
    return df.sort_values("date")


def _latest(load_series: Loader, sid: str, metric: str, region: Optional[str]):
    """(value, prev, last_date) for a metric; Nones when absent."""
    df = _series_values(load_series, sid, metric, region)
    if df.empty:
        return None, None, None
    v = float(df["value"].iloc[-1])
    p = float(df["value"].iloc[-2]) if len(df) > 1 else None
    return v, p, df["date"].iloc[-1]


def tile_value(key: str, load_series: Loader):
    """(value, delta, last_date) for a registry tile, per its display spec."""
    spec = REGISTRY[key]
    if spec["composite"] == "hvi":
        v, _, d1 = _latest(load_series, spec["series_id"], "hvi_change_mom", spec["region"])
        d, _, _ = _latest(load_series, spec["series_id"], "hvi_change_yoy", spec["region"])
        return v, d, d1
    if spec["composite"] == "accord":
        v, _, d1 = _latest(load_series, spec["series_id"], "accord_quarterly_actual", spec["region"])
        tgt, _, _ = _latest(load_series, spec["series_id"], "accord_quarterly_target", spec["region"])
        d = (v - tgt) if v is not None and tgt is not None else None
        return v, d, d1
    v, p, d1 = _latest(load_series, spec["series_id"], spec["metric"], spec["region"])
    if v is None:
        return None, None, None
    d = None
    if p is not None and spec["delta_mode"] == "diff":
        d = v - p
    elif p not in (None, 0) and spec["delta_mode"] == "pct":
        d = (v / p - 1) * 100
    return v, d, d1


# ---------------------------------------------------------------------------
# Hero notability
# ---------------------------------------------------------------------------
Z_CAP = 4.0
MIN_HISTORY = 8      # prior changes needed before Z is meaningful
TRAIL_WINDOW = 20    # trailing changes the Z distribution uses
RARITY = {"daily": 0.2, "weekly": 0.4, "monthly": 0.7,
          "per_decision": 1.0, "quarterly": 1.0, "annual": 1.0}

# World/global series (region == "global") are context, not the Victorian
# housing story — they were crowding out rent/vacancy for hero slots (iron
# ore held a hero tile while no rental series did; design review P1-World).
# Halving their notability lets local series compete on equal footing without
# hand-picking tiles.
WORLD_NOTABILITY_WEIGHT = 0.5


def _resample_last(s: pd.Series, rule: str) -> pd.Series:
    """Equivalent to ``s.resample(rule).last().dropna()`` (collapse to one,
    latest-in-period value per calendar period) WITHOUT calling
    ``Series.resample()`` directly.

    For an anchored end-of-period rule like "ME" (month end) — the only kind
    used here — pandas' real ``.resample()`` hits an internal binning path
    (``DatetimeIndexResampler._adjust_bin_edges``) that builds a bare/
    'generic'-unit NumPy timedelta and raises a ``DeprecationWarning`` on
    this repo's pinned pandas==2.2.3 + newer NumPy (2.x) combination — an
    upstream pandas/NumPy version-interaction bug, not something fixable by
    passing an explicit unit at this call site (reproduces even against a
    freshly-built, explicitly-``datetime64[ns]`` index; confirmed by direct
    reproduction against pandas' own resample internals). Grouping by the
    equivalent ``PeriodIndex`` and relabelling each group back to that
    period's calendar end-timestamp is the same operation, minus the private
    binning path that emits the warning — same values, same index dtype,
    same dates, for every rule this registry currently uses.

    PRECONDITION: expects a chronologically sorted index. ``groupby(...)
    .last()`` picks the last value *by row order* within each period,
    while ``.resample().last()`` picks the last value *by timestamp* —
    the two are equivalent only when the index is already ascending.
    Callers go through ``_series_values``, which guarantees it (sorts by
    date before returning), so this holds for every caller in this file.
    Do not call this directly on an unsorted series.
    """
    period_alias = rule[:-1] if rule.endswith("E") else rule  # "ME" -> "M"
    grouped = s.groupby(s.index.to_period(period_alias)).last()
    grouped.index = grouped.index.to_timestamp(period_alias)
    return grouped.dropna()


def _robust_sigma(prior: pd.Series) -> float:
    med = prior.median()
    mad = (prior - med).abs().median()
    sigma = 1.4826 * mad
    if sigma == 0:
        sigma = float(prior.std(ddof=1)) if len(prior) > 1 else 0.0
    return 0.0 if math.isnan(sigma) else float(sigma)


def score_metric(key: str, load_series: Loader, load_meta: Loader,
                 today: date) -> Optional[dict]:
    """Notability of a hero-eligible metric, or None when unscoreable
    (empty / single point / red-stale). Returns {'n','z','f','r','last_date'}."""
    spec = REGISTRY[key]
    df = _series_values(load_series, spec["series_id"], spec["metric"], spec["region"])
    if df.empty:
        return None
    s = df.set_index("date")["value"]
    if spec["resample"]:
        s = _resample_last(s, spec["resample"])
    if len(s) < 2:
        return None

    meta = load_meta(spec["series_id"]) or {}
    freq = meta.get("frequency", "monthly")
    last_date = s.index[-1]
    gap = (pd.Timestamp(today) - last_date).days
    if gap > 2.5 * NORMAL_CADENCE.get(freq, 31):
        return None  # red-stale: old news is not a recent trend change

    if spec["score_kind"] == "diff":
        changes = s.diff().dropna()
    else:
        changes = (s.pct_change() * 100).replace([math.inf, -math.inf], math.nan).dropna()
    if len(changes) < 1:
        return None

    c_n = float(changes.iloc[-1])
    prior = changes.iloc[:-1].iloc[-TRAIL_WINDOW:]
    sigma = _robust_sigma(prior) if len(prior) >= 2 else 0.0

    # Z — surprise of the latest change vs its trailing distribution.
    z_norm = 0.0
    if len(prior) >= MIN_HISTORY:
        med = float(prior.median())
        if sigma == 0:
            z = 0.0 if c_n == med else math.copysign(Z_CAP, c_n - med)
        else:
            z = max(-Z_CAP, min(Z_CAP, (c_n - med) / sigma))
        z_norm = abs(z) / Z_CAP

    # F — 3-period trend flip above a scale-free noise floor.
    f = 0.0
    if len(changes) >= 6 and sigma > 0:
        eps = 0.2 * sigma
        recent = float(changes.iloc[-3:].mean())
        prior3 = float(changes.iloc[-6:-3].mean())
        if recent * prior3 < 0 and abs(recent) > eps and abs(prior3) > eps:
            f = 1.0
        elif c_n * prior3 < 0 and abs(c_n) > eps:
            f = 0.5

    # R — freshness of the print, discounted by how routine the cadence is.
    days_new = 30.0
    lc = meta.get("last_changed")
    if lc:
        try:
            days_new = max(0.0, (pd.Timestamp(today) -
                                 pd.Timestamp(lc).tz_localize(None).normalize()).days)
        except (ValueError, TypeError):
            pass
    r = RARITY.get(freq, 0.7) * max(0.0, 1 - days_new / 14)

    n = round(0.5 * z_norm + 0.3 * f + 0.2 * r, 4)
    if spec["region"] == "global":
        n = round(n * WORLD_NOTABILITY_WEIGHT, 4)
    return {"n": n, "z": z_norm, "f": f, "r": r, "last_date": last_date}


def _build_tile(key: str, load_series: Loader, notability: Optional[float] = None) -> Optional[dict]:
    v, d, last_date = tile_value(key, load_series)
    if v is None:
        return None
    spec = REGISTRY[key]
    help_txt = f"Data to {last_date.date().isoformat()}" if last_date is not None else ""
    if notability is not None:
        help_txt += f" · notability {notability:.2f}"
    return {
        "key": key,
        "label": spec["label"],
        "value": spec["value_fmt"](v),
        "delta": spec["delta_fmt"](d) if d is not None else None,
        "delta_color": spec["delta_color"] if d is not None else "normal",
        "help": help_txt or None,
    }


def pick_hero(load_series: Loader, load_meta: Loader, today: date) -> list[dict]:
    """Exactly HERO_SLOTS render-ready tiles: pins first, then the top trend
    movers, then defaults so the strip is never short."""
    chosen: list[dict] = []
    used: set[str] = set()

    for key in PINNED:  # a pinned tile with no value falls through silently
        tile = _build_tile(key, load_series)
        if tile:
            chosen.append(tile)
            used.add(key)

    scored = []
    for idx, (key, spec) in enumerate(REGISTRY.items()):
        if not spec["hero"] or key in used:
            continue
        result = score_metric(key, load_series, load_meta, today)
        if result is not None and result["n"] >= QUALIFY:
            scored.append((-result["n"], idx, key, result["n"]))
    scored.sort()
    for _, _, key, n in scored[: HERO_SLOTS - len(chosen)]:
        tile = _build_tile(key, load_series, notability=n)
        if tile:
            chosen.append(tile)
            used.add(key)

    for key in DEFAULT_ORDER + list(REGISTRY):  # pad to a full strip
        if len(chosen) >= HERO_SLOTS:
            break
        if key in used or not REGISTRY[key]["hero"]:
            continue
        tile = _build_tile(key, load_series)
        if tile:
            chosen.append(tile)
            used.add(key)

    while len(chosen) < HERO_SLOTS:  # absolute last resort (total data outage)
        chosen.append({"key": "empty", "label": "—", "value": "—",
                       "delta": None, "delta_color": "normal", "help": None})
    return chosen[:HERO_SLOTS]


def pick_lead(load_series: Loader, load_meta: Loader, today: date) -> str:
    """The single most notable NON-pinned metric this run — the one Today's
    lead-finding card leads with. Reuses pick_hero's own scoring loop (same
    QUALIFY gate, same score_metric), not a new ranking rule. Falls back to
    the first pin, then the first tile that actually renders, so Today always
    has a lead even during a near-total data outage."""
    scored = []
    for idx, (key, spec) in enumerate(REGISTRY.items()):
        if not spec["hero"] or key in PINNED:
            continue
        result = score_metric(key, load_series, load_meta, today)
        if result is not None and result["n"] >= QUALIFY:
            scored.append((-result["n"], idx, key))
    scored.sort()
    for _, _, key in scored:
        if _build_tile(key, load_series) is not None:
            return key
    for key in PINNED + DEFAULT_ORDER + list(REGISTRY):
        if _build_tile(key, load_series) is not None:
            return key
    return "empty"
