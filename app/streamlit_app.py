"""Victorian Housing Dashboard — Streamlit front-end.

Reads the CSVs and metadata committed by the pipeline (no live fetching here),
so it renders instantly and works offline. Every chart shows a staleness badge
derived from the series metadata and a link to the source; a missing or failed
series degrades to its last good data with a warning rather than crashing.

Phase 2 adds the rents/affordability, greenfield-land and social-housing-waitlist
charts to the Victoria tab, World Bank commodities to the International tab, and a
tagged, deduped News tab backed by data/news/items.jsonl.
"""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import plotly.express as px
import streamlit as st

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"

st.set_page_config(page_title="Victorian Housing Dashboard", page_icon="🏘️", layout="wide")

# Normal cadence (days) per frequency; the badge warns past ~1.5x this gap.
NORMAL_CADENCE = {
    "daily": 3, "monthly": 31, "quarterly": 92, "annual": 366, "per_decision": 92,
}

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
    """Render a staleness badge + source link caption for a series."""
    meta = load_meta(series_id)
    if not meta:
        st.caption("⚪ no metadata")
        return
    freq = meta.get("frequency", "monthly")
    status = meta.get("status", "ok")
    last_data = meta.get("last_data_date")
    dot, note = "🟢", ""
    if last_data:
        gap = (pd.Timestamp.utcnow().tz_localize(None) - pd.Timestamp(last_data)).days
        cad = NORMAL_CADENCE.get(freq, 31)
        if gap > 2.5 * cad:
            dot, note = "🔴", " · stale"
        elif gap > 1.5 * cad:
            dot, note = "🟡", " · ageing"
        period = _fmt_period(pd.Timestamp(last_data), freq)
        data_to = f"Data to {period}"
    else:
        dot, data_to = "⚪", "no data"
    if status == "failed":
        dot = "🔴"
        note = f" · last fetch failed: {meta.get('error', '')[:80]}"
    url = meta.get("source_url", "")
    src = f" · [{meta.get('source_name', 'source')}]({url})" if url else ""
    st.caption(f"{dot} {data_to} · fetched {_ago(meta.get('last_fetched'))}{note}{src}")


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
    fig.update_layout(height=320, margin=dict(l=0, r=0, t=6, b=0),
                      legend=dict(orientation="h", yanchor="bottom", y=1.0, x=0),
                      hovermode="x unified")
    if percent:
        fig.update_yaxes(ticksuffix="%")
    st.plotly_chart(fig, use_container_width=True, key=f"{series_id}-{title}")
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
    fig.update_layout(height=300, margin=dict(l=0, r=0, t=6, b=0))
    st.plotly_chart(fig, use_container_width=True, key=f"{series_id}-bar-{title}")
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
# Header + hero strip
# ---------------------------------------------------------------------------
st.title("🏘️ Victorian Housing Dashboard")
st.caption(
    "Metro Melbourne vs Regional Victoria housing metrics, national context, and "
    "international leading indicators. Data auto-refreshed daily via GitHub Actions; "
    "each chart shows how current its underlying series is."
)

h = st.columns(4)
with h[0]:
    v, p, _ = latest_value("au_cash_rate", "cash_rate")
    st.metric("RBA cash rate", f"{v:.2f}%" if v is not None else "—",
              f"{v - p:+.2f} pp" if v is not None and p is not None else None,
              delta_color="inverse")
with h[1]:
    # ABS Total Value of Dwellings gives a MEAN price; a true median needs REIV /
    # Cotality (Phase 3). Labelled "mean" so the figure is not misrepresented.
    v, p, _ = latest_value("au_dwelling_stock", "mean_price", region="vic")
    st.metric("Vic mean dwelling price", f"${v/1000:,.0f}k" if v is not None else "—",
              f"{(v/p - 1)*100:+.1f}% qtr" if v and p else None)
with h[2]:
    v, p, _ = latest_value("vic_approvals", "approvals_dwellings_total", region="vic")
    st.metric("Vic dwelling approvals (mth)", f"{v:,.0f}" if v is not None else "—",
              f"{v - p:+,.0f}" if v is not None and p is not None else None)
with h[3]:
    act, _, _ = latest_value("au_accord", "accord_quarterly_actual")
    tgt, _, _ = latest_value("au_accord", "accord_quarterly_target")
    st.metric("Accord run-rate (qtr)", f"{act:,.0f}" if act is not None else "—",
              f"{act - tgt:+,.0f} vs 60k target" if act is not None and tgt is not None else None)

st.divider()

tab_vic, tab_nat, tab_intl, tab_news = st.tabs(
    ["🏙️ Victoria", "🇦🇺 National", "🌏 International", "📰 News"]
)

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

    # Optional Claude-generated digest (Phase 3) — degrade silently if absent.
    digest_path = DATA / "news" / "digest.md"
    if digest_path.exists():
        st.markdown(digest_path.read_text(encoding="utf-8"))
        st.divider()

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

        filtered = [
            it for it in items
            if (not chosen_tags or set(it["tags"]) & set(chosen_tags))
            and (not chosen_sources or it["source"] in chosen_sources)
        ]

        ok, failed = news_meta.get("feeds_ok"), news_meta.get("feeds_failed")
        feeds_note = f" · {ok}/{(ok or 0) + (failed or 0)} feeds ok" if ok is not None else ""
        st.caption(
            f"🟢 {len(filtered)} of {len(items)} items · newest "
            f"{news_meta.get('last_item_date', '—')} · fetched "
            f"{_ago(news_meta.get('last_fetched'))}{feeds_note} · "
            "headlines link out to the original source (no article text stored)."
        )

        for it in filtered:
            tags = " ".join(
                f"`{t.replace('_', ' ')}`" for t in it["tags"]
            )
            st.markdown(
                f"**[{it['title']}]({it['url']})**  \n"
                f"<span style='color:gray'>{it['published']} · {it['source']} · {tags}</span>",
                unsafe_allow_html=True,
            )
