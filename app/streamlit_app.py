"""Victorian Housing Dashboard — Streamlit front-end.

Reads the CSVs and metadata committed by the pipeline (no live fetching here),
so it renders instantly and works offline. Every chart shows a staleness badge
derived from the series metadata and a link to the source; a missing or failed
series degrades to its last good data with a warning rather than crashing.

Phase 2 adds the rents/affordability, greenfield-land and social-housing-waitlist
charts to the Victoria tab, World Bank commodities to the International tab, and a
tagged, deduped News tab backed by data/news/items.jsonl.

The "Today" landing tab leads with what's new: series whose data changed in the
last week (headline-metric cards) and the day's top stories (importance-scored,
with thumbnails). The hero strip above the tabs rotates daily — two pinned tiles
plus the three metrics with the most notable recent trend changes (app/scoring.py).
"""
from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

try:  # pytest imports the package; `streamlit run` has app/ on sys.path
    from app import scoring, theme
except ImportError:  # pragma: no cover
    import scoring
    import theme

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

st.set_page_config(page_title="Victorian Housing Dashboard", page_icon="🏘️", layout="wide")
theme.register_template()
st.markdown(theme.CSS, unsafe_allow_html=True)

# Normal cadence (days) per frequency; the badge warns past ~1.5x this gap.
# Single source of truth lives in scoring.py (the stale gate uses it too).
NORMAL_CADENCE = scoring.NORMAL_CADENCE

METRIC_LABELS = {
    "approvals_dwellings_total": "Total dwellings",
    "approvals_houses": "Houses",
    "approvals_other_residential": "Other residential",
    "dwellings_commenced": "Commenced",
    "dwellings_completed": "Completed",
    "dwellings_under_construction": "Under construction",
    "input_all_groups": "All groups", "input_timber": "Timber",
    "input_steel": "Steel", "input_cement": "Cement",
    "lending_owner_occupier": "Owner-occupier", "lending_investor": "Investor",
    "lending_first_home_buyer": "First home buyer", "lending_total": "Total",
    "population_erp": "Resident population", "population_growth_qtr": "Growth (qtr)",
    "net_overseas_migration": "Net overseas migration", "natural_increase": "Natural increase",
    "dwelling_count": "Dwelling count", "mean_price": "Mean price",
    "cash_rate": "Cash rate target",
    "mortgage_outstanding": "Outstanding (all)", "mortgage_outstanding_variable": "Outstanding variable",
    "mortgage_outstanding_fixed": "Outstanding fixed", "mortgage_new": "New (all)",
    "mortgage_new_variable": "New variable", "mortgage_new_fixed": "New fixed",
    "credit_housing_yoy": "Housing (YoY)", "credit_owner_occupier_yoy": "Owner-occupier (YoY)",
    "credit_investor_yoy": "Investor (YoY)", "credit_housing_mom": "Housing (MoM)",
    "credit_owner_occupier_mom": "Owner-occupier (MoM)", "credit_investor_mom": "Investor (MoM)",
    "brent_crude": "Brent crude", "us_10y_treasury": "US 10yr Treasury", "aud_usd": "AUD/USD",
    "accord_cumulative_actual": "Cumulative actual", "accord_cumulative_target": "Cumulative target",
    "accord_quarterly_actual": "Quarterly actual", "accord_quarterly_target": "Quarterly target",
    # Phase 2 — rents (DFFH)
    "median_rent": "Median rent (new lettings)", "rent_growth_annual": "Rent index (annual change)",
    "affordable_share": "Affordable lettings share",
    "rent_1br_flat": "1-bed flat", "rent_2br_flat": "2-bed flat", "rent_3br_flat": "3-bed flat",
    "rent_2br_house": "2-bed house", "rent_3br_house": "3-bed house", "rent_4br_house": "4-bed house",
    # Phase 2 — greenfield land (UDP)
    "greenfield_lots_titled": "Lots titled (year)", "greenfield_lot_supply": "Remaining lot supply",
    "greenfield_years_of_supply": "Years of supply",
    # Phase 2 — social housing waitlist (VHR)
    "vhr_total": "Total applications", "vhr_priority": "Priority Access",
    "vhr_register_of_interest": "Register of Interest",
    # Phase 2 — commodities (World Bank)
    "iron_ore": "Iron ore", "copper": "Copper", "sawnwood": "Sawnwood",
    # Phase 3 — Cotality HVI / vacancy / auctions / medians
    "hvi_index": "Dwelling values index", "hvi_change_mom": "Monthly change",
    "hvi_change_yoy": "Annual change", "vacancy_rate": "Vacancy rate",
    "clearance_rate": "Clearance rate", "auctions_reported": "Auctions reported",
    "median_house_price": "Median house", "median_unit_price": "Median unit",
}


@st.cache_data
def load_series(series_id: str) -> pd.DataFrame:
    path = DATA / "series" / f"{series_id}.csv"
    if not path.exists():
        return pd.DataFrame(columns=["date", "region", "metric", "value", "unit"])
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"])
    return df


@st.cache_data
def load_meta(series_id: str) -> dict:
    path = DATA / "meta" / f"{series_id}.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}


def _fmt_period(date: pd.Timestamp, freq: str) -> str:
    if freq in ("quarterly",):
        return f"{['', 'Mar', 'Jun', 'Sep', 'Dec'][date.quarter]} qtr {date.year}"
    if freq in ("monthly", "per_decision"):
        return date.strftime("%b %Y")
    if freq == "annual":
        return str(date.year)
    return date.strftime("%d %b %Y")


def _ago(iso_ts: str | None) -> str:
    if not iso_ts:
        return "unknown"
    try:
        ts = pd.Timestamp(iso_ts).tz_localize(None)
    except (ValueError, TypeError):
        return "unknown"
    days = (pd.Timestamp.utcnow().tz_localize(None) - ts).days
    return "today" if days <= 0 else ("yesterday" if days == 1 else f"{days} days ago")


def badge(series_id: str) -> None:
    """Staleness caption: plain text when fresh; a tint chip when ageing,
    stale, or failed (spec: encode status with quiet chips, not dots)."""
    meta = load_meta(series_id)
    if not meta:
        st.caption("no metadata")
        return
    freq = meta.get("frequency", "monthly")
    status = meta.get("status", "ok")
    last_data = meta.get("last_data_date")
    lead, note = "", ""
    if last_data:
        gap = (pd.Timestamp.utcnow().tz_localize(None) - pd.Timestamp(last_data)).days
        cad = NORMAL_CADENCE.get(freq, 31)
        period = _fmt_period(pd.Timestamp(last_data), freq)
        if status == "failed":
            lead = theme.chip(f"Data to {period} · source unavailable", "bad")
        elif gap > 2.5 * cad:
            lead = theme.chip(f"Data to {period} · stale", "bad")
        elif gap > 1.5 * cad:
            lead = theme.chip(f"Data to {period} · ageing", "warn")
        else:
            lead = f"Data to {period}"
    else:
        lead = theme.chip("no data · source unavailable", "bad") if status == "failed" \
            else "no data"
    if status == "failed" and meta.get("error"):
        note = f" · {meta.get('error', '')[:60]}"
    nxt = _next_release(last_data, freq)
    url = meta.get("source_url", "")
    src = f" · <a href='{url}'>{meta.get('source_name', 'source')}</a>" if url else ""
    st.markdown(
        f"<div style='font-size:12px;color:{theme.PALETTE['faint']};margin:-6px 0 4px'>"
        f"{lead} · fetched {_ago(meta.get('last_fetched'))}{note}{nxt}{src}</div>",
        unsafe_allow_html=True,
    )


def _next_release(last_data: str | None, freq: str) -> str:
    """Estimate the next expected update from the last data point + cadence."""
    if not last_data:
        return ""
    cad = NORMAL_CADENCE.get(freq, 31)
    nxt = pd.Timestamp(last_data) + pd.Timedelta(days=cad)
    return f" · next update ~{_fmt_period(nxt, freq)}"


def relabel(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df["series"] = df["metric"].map(lambda m: METRIC_LABELS.get(m, m.replace("_", " ")))
    return df


def line_block(series_id: str, *, metrics=None, region=None, title="", y_title="",
               since=None, percent=False, markers=False) -> None:
    """Render a titled line chart for a series subset, with a staleness badge.

    ``markers=True`` also draws point markers so a series with only one
    observation (e.g. a snapshot table that accumulates one point per release)
    is still visible rather than an empty line.
    """
    st.markdown(f"##### {title}")
    df = load_series(series_id)
    meta = load_meta(series_id)
    if df.empty:
        st.warning(f"No data yet for **{series_id}** (status: {meta.get('status', 'unknown')}).")
        badge(series_id)
        return
    if region:
        df = df[df["region"] == region]
    if metrics:
        df = df[df["metric"].isin(metrics)]
    if since:
        df = df[df["date"] >= pd.Timestamp(since)]
    if df.empty:
        st.warning("No data for this selection — showing the badge for context.")
        badge(series_id)
        return
    df = relabel(df)
    # Auto-enable markers when any line would have a single point (else it's blank).
    single_point = df.groupby("series").size().max() < 2
    fig = px.line(df, x="date", y="value", color="series", markers=markers or single_point,
                  labels={"date": "", "value": y_title, "series": ""})
    fig.update_layout(height=320, hovermode="x unified",
                      showlegend=df["series"].nunique() > 1)
    if percent:
        fig.update_yaxes(ticksuffix="%")
    st.plotly_chart(fig, use_container_width=True, theme=None, key=f"{series_id}-{title}",
                    config=theme.PLOTLY_CONFIG)
    badge(series_id)


def latest_value(series_id, metric, region=None):
    """Return (value, prev_value, date) for a metric's latest observation."""
    df = load_series(series_id)
    df = df[df["metric"] == metric]
    if region:
        df = df[df["region"] == region]
    df = df.sort_values("date")
    if df.empty:
        return None, None, None
    val = df["value"].iloc[-1]
    prev = df["value"].iloc[-2] if len(df) > 1 else None
    return val, prev, df["date"].iloc[-1]


def bar_latest_block(series_id, *, metrics=None, region=None, title="", x_title="") -> None:
    """Horizontal bar of a series' latest-date values across metrics — suited to
    snapshot tables (e.g. current median rents by dwelling type)."""
    st.markdown(f"##### {title}")
    df = load_series(series_id)
    meta = load_meta(series_id)
    if df.empty:
        st.warning(f"No data yet for **{series_id}** (status: {meta.get('status', 'unknown')}).")
        badge(series_id)
        return
    if region:
        df = df[df["region"] == region]
    if metrics:
        df = df[df["metric"].isin(metrics)]
    if df.empty:
        st.warning("No data for this selection — showing the badge for context.")
        badge(series_id)
        return
    latest = df["date"].max()
    d = relabel(df[df["date"] == latest]).sort_values("value")
    fig = px.bar(d, x="value", y="series", orientation="h", text="value",
                 labels={"value": x_title, "series": ""})
    fig.update_traces(texttemplate="%{text:,.0f}", textposition="outside")
    fig.update_layout(height=300, showlegend=False, bargap=0.35)
    st.plotly_chart(fig, use_container_width=True, theme=None, key=f"{series_id}-bar-{title}",
                    config=theme.PLOTLY_CONFIG)
    badge(series_id)


@st.cache_data
def load_news() -> list[dict]:
    path = DATA / "news" / "items.jsonl"
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line:
            out.append(json.loads(line))
    out.sort(key=lambda d: d.get("published", ""), reverse=True)
    return out


# ---------------------------------------------------------------------------
# News cards (Top stories) + What's-new cards
# ---------------------------------------------------------------------------
TOP_STORIES_N = 4        # featured stories on Today and atop the News tab
WHATS_NEW_DAYS = 7       # window for "What's new in the data"
WHATS_NEW_MAX = 8        # card cap (2 rows of 4)
COLD_START_MIN = 10      # >= this many changed series => initial-load mode


def _short_tag(t: str) -> str:
    return t.replace("supply_construction", "supply").replace("_", " ")


@st.cache_data
def top_news(today_iso: str, n: int) -> list[dict]:
    """Score-ranked top stories; cache rolls over with the calendar date."""
    return scoring.top_stories(load_news(), date.fromisoformat(today_iso), n=n)


def news_card(item: dict) -> None:
    """One bordered story card: thumbnail (or tag-emoji placeholder), linked
    headline, source · date · tags caption."""
    with st.container(border=True):
        img = item.get("image")  # optional field; older rows lack it
        if img:
            try:
                st.image(img, use_container_width=True)
            except TypeError:  # Streamlit API drift fallback
                st.image(img, use_column_width=True)
        else:
            tag = (item.get("tags") or ["international"])[0]  # sorted -> deterministic
            icon = theme.TAG_ICON.get(tag, "newspaper")
            st.markdown(
                "<div style='text-align:center;height:110px;line-height:110px;"
                f"background:{theme.PALETTE['bg2']};border-radius:8px'>"
                f"<span class='material-symbols-rounded' style='font-size:44px;"
                f"line-height:110px'>{icon}</span></div>",
                unsafe_allow_html=True,
            )
        title = item["title"]
        if len(title) > 90:
            title = title[:87] + "…"
        st.markdown(f"**[{title}]({item['url']})**")
        tags = " · ".join(_short_tag(t) for t in item.get("tags", [])[:2])
        caption = f"{item['source']} · {item['published']} · {tags}"
        n_outlets = 1 + len(item.get("dup_sources", []))
        if n_outlets > 1:
            caption += f" · covered by {n_outlets} outlets"
        st.caption(caption)


def whats_new(window_days: int = WHATS_NEW_DAYS) -> tuple[list[str], bool]:
    """Registry tile keys whose series changed within the window, newest first.
    Returns (tile_keys, cold_start)."""
    changed = []
    for sid, key in scoring.WHATS_NEW_TILE.items():
        meta = load_meta(sid)
        lc = meta.get("last_changed")
        if not lc:
            continue
        try:
            age = (pd.Timestamp.utcnow().tz_localize(None)
                   - pd.Timestamp(lc).tz_localize(None)).total_seconds() / 86400
        except (ValueError, TypeError):
            continue
        if 0 <= age <= window_days:
            changed.append((age, sid, key))
    changed.sort(key=lambda t: (t[0], t[1]))  # newest first, series_id tiebreak
    return [key for _, _, key in changed], len(changed) >= COLD_START_MIN


def whats_new_cards(tile_keys: list[str]) -> None:
    for row_start in range(0, len(tile_keys), 4):
        cols = st.columns(4)  # fixed 4 keeps card widths equal on partial rows
        for col, key in zip(cols, tile_keys[row_start:row_start + 4]):
            spec = scoring.REGISTRY[key]
            v, d, _ = scoring.tile_value(key, load_series)
            meta = load_meta(spec["series_id"])
            with col, st.container(border=True):
                st.metric(spec["label"],
                          spec["value_fmt"](v) if v is not None else "—",
                          spec["delta_fmt"](d) if d is not None else None,
                          delta_color=spec["delta_color"] if d is not None else "normal")
                st.caption(f"Updated {_ago(meta.get('last_changed'))} · {spec['tab']} tab")


# ---------------------------------------------------------------------------
# Header + hero strip
# ---------------------------------------------------------------------------
st.title(":material/home_work: Victorian Housing Dashboard")
st.caption(
    "Metro Melbourne vs Regional Victoria housing metrics, national context, and "
    "international leading indicators. Data auto-refreshed daily via GitHub Actions; "
    "each chart shows how current its underlying series is."
)

@st.cache_data
def hero_tiles(today_iso: str) -> list[dict]:
    """One hero selection per day — reruns within the day are stable; the strip
    changes only when the data or the date changes."""
    return scoring.pick_hero(load_series, load_meta, date.fromisoformat(today_iso))


def render_hero(tiles: list[dict]) -> None:
    cols = st.columns(len(tiles))
    for col, t in zip(cols, tiles):
        with col:
            st.metric(t["label"], t["value"], t["delta"],
                      delta_color=t["delta_color"], help=t["help"])
    st.caption("Tiles auto-selected daily by trend-change score · "
               "pinned: RBA cash rate, Melb dwelling values")


render_hero(hero_tiles(date.today().isoformat()))

st.divider()

tab_today, tab_vic, tab_nat, tab_intl, tab_news = st.tabs(
    [f":material/{theme.TAB_ICONS[n]}: {n}"
     for n in ("Today", "Victoria", "National", "International", "News")]
)

# ---------------------------------------------------------------------------
# Today — the landing view: what changed, and the day's top stories
# ---------------------------------------------------------------------------
with tab_today:
    # Claude daily digest, when the pipeline produced one (silent otherwise).
    digest_path = DATA / "news" / "digest.md"
    if digest_path.exists():
        st.markdown(digest_path.read_text(encoding="utf-8"))
        st.divider()

    st.markdown("#### What's new in the data")
    new_keys, cold_start = whats_new()
    if not new_keys:
        st.caption("No data updates in the past 7 days. Each chart's badge shows "
                   "its expected next release.")
    else:
        if cold_start:
            st.caption("Most series were populated together in the initial data "
                       f"load — showing the {min(len(new_keys), WHATS_NEW_MAX)} "
                       "most recent changes.")
        overflow = len(new_keys) - WHATS_NEW_MAX
        whats_new_cards(new_keys[:WHATS_NEW_MAX])
        if overflow > 0 and not cold_start:
            st.caption(f"+ {overflow} more series updated this week — see their tabs.")

    st.markdown("#### Top stories")
    today_items = load_news()
    if not today_items:
        st.info("No news items yet — run `python -m pipeline.run` to populate "
                "`data/news/items.jsonl`.")
    else:
        stories = top_news(date.today().isoformat(), TOP_STORIES_N)
        if not stories:
            st.caption("No stories scored highly enough in the past week — "
                       "see the News tab for the full list.")
        else:
            cols = st.columns(TOP_STORIES_N)
            for col, it in zip(cols, stories):
                with col:
                    news_card(it)
            st.caption(f"Scored from the last 90 days of tagged housing headlines · "
                       f"{len(today_items)} items on the News tab.")

# ---------------------------------------------------------------------------
# Victoria
# ---------------------------------------------------------------------------
with tab_vic:
    region_label = st.radio("Region", ["Metro Melbourne", "Regional Victoria"],
                            horizontal=True, key="vic_region")
    region = "melbourne" if region_label == "Metro Melbourne" else "regional_vic"

    st.subheader("Approvals, activity & construction costs")
    c1, c2 = st.columns(2)
    with c1:
        line_block("vic_approvals", region=region, since="2010-01-01",
                   title=f"Dwelling approvals — {region_label}", y_title="dwellings/mth")
        line_block("au_dwelling_stock", region="vic", metrics=["mean_price"],
                   since="2011-01-01", title="Mean dwelling price — Victoria", y_title="A$")
    with c2:
        line_block("vic_activity", region="vic", since="2010-01-01",
                   title="Building activity — Victoria (state)", y_title="dwellings/qtr")
        line_block("vic_input_costs", region="melbourne", since="2010-01-01",
                   title="House-construction input costs — Melbourne", y_title="index")
    st.caption(
        "Note: dwelling approvals and rents split Metro vs Regional; building "
        "activity, mean price and input costs are Victoria/Melbourne-wide."
    )

    st.subheader(f"Dwelling values, rental vacancy & auctions — {region_label}")
    c1, c2 = st.columns(2)
    with c1:
        if region == "melbourne":
            line_block("vic_hvi", region="melbourne", metrics=["hvi_index"],
                       title="Dwelling values index — Melbourne (Cotality)", y_title="index")
        else:
            st.markdown("##### Dwelling values index — Melbourne (Cotality)")
            st.info("Cotality's free daily index covers capital cities only — "
                    "no Regional Victoria series is published.")
            badge("vic_hvi")
        line_block("vic_vacancy", region=region, metrics=["vacancy_rate"],
                   since="2005-01-01", title=f"Rental vacancy rate — {region_label}",
                   y_title="%", percent=True)
    with c2:
        # Best-effort scrapers — usually unavailable; they degrade to a warning + badge.
        line_block("vic_auctions", region="melbourne", metrics=["clearance_rate"],
                   title="Auction clearance rate — Melbourne", y_title="%", percent=True)
        bar_latest_block("vic_median_price", region=region,
                         metrics=["median_house_price", "median_unit_price"],
                         title=f"Median house & unit price — {region_label} (REIV)", x_title="A$")

    st.subheader(f"Rents & affordability — {region_label}")
    c1, c2 = st.columns(2)
    with c1:
        line_block("vic_rents", region=region, metrics=["rent_growth_annual"],
                   since="2005-01-01", title="Rent index — annual growth",
                   y_title="%", percent=True)
        bar_latest_block("vic_rents", region=region,
                         metrics=["rent_1br_flat", "rent_2br_flat", "rent_3br_flat",
                                  "rent_2br_house", "rent_3br_house", "rent_4br_house"],
                         title="Median rents by dwelling type (latest quarter)",
                         x_title="A$/week")
    with c2:
        line_block("vic_rents", region=region, metrics=["affordable_share"],
                   since="2020-01-01", title="Affordable lettings — % of new lettings",
                   y_title="%", percent=True)
        line_block("vic_rents", region=region, metrics=["median_rent"],
                   title="Median rent — all new lettings", y_title="A$/week")

    st.subheader("Greenfield land & social housing (statewide)")
    c1, c2 = st.columns(2)
    with c1:
        st.markdown("##### Greenfield land supply — Melbourne growth corridors")
        lt, _, _ = latest_value("vic_land", "greenfield_lots_titled", region="melbourne")
        sp, _, _ = latest_value("vic_land", "greenfield_lot_supply", region="melbourne")
        ys, _, _ = latest_value("vic_land", "greenfield_years_of_supply", region="melbourne")
        m = st.columns(3)
        m[0].metric("Lots titled (year)", f"{lt:,.0f}" if lt is not None else "—")
        m[1].metric("Remaining supply", f"{sp:,.0f}" if sp is not None else "—")
        m[2].metric("Years of supply", f"{ys:,.1f}" if ys is not None else "—")
        badge("vic_land")
    with c2:
        line_block("vic_social_waitlist", region="vic",
                   metrics=["vhr_total", "vhr_priority", "vhr_register_of_interest"],
                   title="Victorian Housing Register — applications",
                   y_title="applications")

# ---------------------------------------------------------------------------
# National
# ---------------------------------------------------------------------------
with tab_nat:
    c1, c2 = st.columns(2)
    with c1:
        line_block("au_cash_rate", since="2000-01-01", title="RBA cash rate target",
                   y_title="%", percent=True)
        line_block("au_mortgage_rates",
                   metrics=["mortgage_new", "mortgage_outstanding",
                            "mortgage_new_variable", "mortgage_new_fixed"],
                   title="Housing lending rates (owner-occupier)", y_title="%", percent=True)
        line_block("au_lending", region="australia",
                   metrics=["lending_owner_occupier", "lending_investor",
                            "lending_first_home_buyer"],
                   since="2010-01-01", title="New loan commitments — Australia",
                   y_title="A$m/qtr")
        line_block("au_dwelling_stock", region="australia", metrics=["mean_price"],
                   since="2011-01-01", title="Mean dwelling price — Australia", y_title="A$")
        line_block("au_hvi", region="australia", metrics=["hvi_index"],
                   title="Dwelling values index — 5-capital aggregate (Cotality)",
                   y_title="index")
    with c2:
        line_block("au_credit",
                   metrics=["credit_housing_yoy", "credit_owner_occupier_yoy",
                            "credit_investor_yoy"],
                   since="2005-01-01", title="Housing credit growth (12-month)",
                   y_title="%", percent=True)
        line_block("au_population", region="australia",
                   metrics=["population_growth_qtr", "net_overseas_migration",
                            "natural_increase"],
                   since="2005-01-01", title="Population growth & NOM — Australia",
                   y_title="persons/qtr")
        line_block("au_accord",
                   metrics=["accord_cumulative_actual", "accord_cumulative_target"],
                   title="Housing Accord: cumulative completions vs target",
                   y_title="dwellings")

# ---------------------------------------------------------------------------
# International
# ---------------------------------------------------------------------------
with tab_intl:
    st.subheader("Financial indicators")
    c1, c2 = st.columns(2)
    with c1:
        line_block("intl_fred", metrics=["brent_crude"], since="2018-01-01",
                   title="Brent crude oil", y_title="US$/barrel")
        line_block("intl_fred", metrics=["aud_usd"], since="2018-01-01",
                   title="AUD/USD exchange rate", y_title="US$ per A$")
    with c2:
        line_block("intl_fred", metrics=["us_10y_treasury"], since="2018-01-01",
                   title="US 10-year Treasury yield", y_title="%", percent=True)

    st.subheader("Commodity prices — World Bank Pink Sheet")
    st.caption("Construction- and economy-relevant commodities (monthly, nominal US$).")
    c1, c2, c3 = st.columns(3)
    with c1:
        line_block("intl_commodities", region="global", metrics=["iron_ore"],
                   title="Iron ore", y_title="US$/dmtu")
    with c2:
        line_block("intl_commodities", region="global", metrics=["copper"],
                   title="Copper", y_title="US$/tonne")
    with c3:
        line_block("intl_commodities", region="global", metrics=["sawnwood"],
                   title="Sawnwood", y_title="US$/m³")

# ---------------------------------------------------------------------------
# News (Phase 2)
# ---------------------------------------------------------------------------
with tab_news:
    items = load_news()
    news_meta = load_meta("news")

    if not items:
        st.info("No news items yet — run `python -m pipeline.run` to populate "
                "`data/news/items.jsonl`.")
    else:
        all_tags = sorted({t for it in items for t in it["tags"]})
        all_sources = sorted({it["source"] for it in items})
        f1, f2 = st.columns([3, 2])
        chosen_tags = f1.multiselect(
            "Filter by topic", all_tags,
            format_func=lambda t: t.replace("_", "/").replace("supply/construction", "supply"),
        )
        chosen_sources = f2.multiselect("Filter by source", all_sources)

        # Top-stories row only when browsing unfiltered — a filtering user is
        # searching, and unfiltered heroes above filtered results would confuse.
        hero: list[dict] = []
        if not chosen_tags and not chosen_sources:
            st.markdown("#### Top stories")
            hero = top_news(date.today().isoformat(), TOP_STORIES_N)
            cols = st.columns(TOP_STORIES_N)
            for col, it in zip(cols, hero):
                with col:
                    news_card(it)
            st.divider()

        filtered = [
            it for it in items
            if (not chosen_tags or set(it["tags"]) & set(chosen_tags))
            and (not chosen_sources or it["source"] in chosen_sources)
        ]

        ok, failed = news_meta.get("feeds_ok"), news_meta.get("feeds_failed")
        feeds_note = f" · {ok}/{(ok or 0) + (failed or 0)} feeds ok" if ok is not None else ""
        hero_note = f" · {len(hero)} shown above" if hero else ""
        st.caption(
            f"{len(filtered)} of {len(items)} items · newest "
            f"{news_meta.get('last_item_date', '—')} · fetched "
            f"{_ago(news_meta.get('last_fetched'))}{feeds_note}{hero_note} · "
            "headlines link out to the original source (no article text stored)."
        )

        hero_urls = {it["url"] for it in hero}
        for it in filtered:
            if it["url"] in hero_urls:
                continue  # already featured above
            tags = " ".join(
                f"`{t.replace('_', ' ')}`" for t in it["tags"]
            )
            n_outlets = 1 + len(it.get("dup_sources", []))
            coverage = f" · covered by {n_outlets} outlets" if n_outlets > 1 else ""
            st.markdown(
                f"**[{it['title']}]({it['url']})**  \n"
                f"<span style='color:gray'>{it['published']} · {it['source']} · "
                f"{tags}{coverage}</span>",
                unsafe_allow_html=True,
            )
