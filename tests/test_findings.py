from datetime import date
import pandas as pd
from pipeline import findings


def _df(rows):
    return pd.DataFrame(rows, columns=["date", "region", "metric", "value", "unit"])


def _loaders(frames, metas=None):
    def load_series(sid):
        return frames.get(sid, _df([]))
    def load_meta(sid):
        return (metas or {}).get(sid, {"frequency": "monthly"})
    return load_series, load_meta


def test_catalogue_shape_and_sections():
    ids = [c["id"] for c in findings.CHARTS]
    assert len(ids) == len(set(ids)), "chart ids must be unique"
    secs = [s for s, _ in findings.SECTIONS]
    assert secs == ["today", "prices", "rents", "supply", "money",
                    "people", "social", "world", "news"]
    for c in findings.CHARTS:
        assert c["section"] in secs
        assert c["region_mode"] == "geo" or c["region_mode"] == "all" \
            or c["region_mode"].startswith("fixed:")


def test_generic_finding_rise():
    ls, lm = _loaders({"vic_approvals": _df([
        ("2026-04-30", "vic", "approvals_dwellings_total", 4000, "dwellings"),
        ("2026-05-31", "vic", "approvals_dwellings_total", 4400, "dwellings"),
    ])})
    out = findings.build_findings(ls, lm)
    assert out["approvals"] == "Dwelling approvals rose 10.0% to 4,400 in May 2026"


def test_generic_finding_fall_and_flat():
    ls, lm = _loaders({"vic_activity": _df([
        ("2025-12-31", "vic", "dwellings_commenced", 12000, "dwellings"),
        ("2026-03-31", "vic", "dwellings_commenced", 11400, "dwellings"),
    ])}, {"vic_activity": {"frequency": "quarterly"}})
    out = findings.build_findings(ls, lm)
    assert out["activity"] == "Dwellings commenced fell 5.0% to 11,400 in Mar qtr 2026"


def test_cash_rate_held_wording():
    rows = [(f"2026-0{m}-28", "australia", "cash_rate", 3.85, "percent") for m in range(1, 7)]
    ls, lm = _loaders({"au_cash_rate": _df(rows)},
                      {"au_cash_rate": {"frequency": "monthly"}})
    out = findings.build_findings(ls, lm)
    assert out["cash_rate"] == "The cash rate has held at 3.85% since Jan 2026"


def test_hvi_finding_uses_mom():
    ls, lm = _loaders({"vic_hvi": _df([
        ("2026-05-31", "melbourne", "hvi_change_mom", 0.2, "percent"),
        ("2026-06-30", "melbourne", "hvi_change_mom", -1.0, "percent"),
        ("2026-06-30", "melbourne", "hvi_change_yoy", -0.9, "percent"),
    ])}, {"vic_hvi": {"frequency": "daily"}})
    out = findings.build_findings(ls, lm)
    assert out["hvi_melbourne"] == \
        "Melbourne dwelling values fell 1.0% in Jun 2026 (-0.9% over the year)"


def test_accord_finding_vs_target():
    ls, lm = _loaders({"au_accord": _df([
        ("2026-03-31", "australia", "accord_cumulative_actual", 133455, "dwellings"),
        ("2026-03-31", "australia", "accord_cumulative_target", 180000, "dwellings"),
    ])}, {"au_accord": {"frequency": "quarterly"}})
    out = findings.build_findings(ls, lm)
    assert out["accord"] == \
        "Completions trail the Accord track by 46,545 homes as at Mar qtr 2026"


def test_median_rent_by_type_finding_uses_3br_house_primary():
    ls, lm = _loaders({"vic_rents": _df([
        ("2025-06-30", "melbourne", "rent_3br_house", 540, "AUD/week"),
        ("2025-09-30", "melbourne", "rent_3br_house", 550, "AUD/week"),
        ("2025-09-30", "melbourne", "rent_1br_flat", 500, "AUD/week"),
    ])}, {"vic_rents": {"frequency": "quarterly"}})
    out = findings.build_findings(ls, lm)
    assert out["median_rent_by_type"] == \
        "The median 3-bedroom-house rent rose 1.9% to $550/wk in Sep qtr 2025"


def test_failed_series_gets_no_data_finding():
    ls, lm = _loaders({}, {"vic_auctions": {"frequency": "weekly", "status": "failed"}})
    out = findings.build_findings(ls, lm)
    assert out["auctions"] == "No recent data — source currently unavailable"


def test_exactly_four_charts_carry_a_note():
    noted = {c["id"]: c["note"] for c in findings.CHARTS if c.get("note")}
    assert set(noted) == {"hvi_melbourne", "hvi_australia",
                           "median_rent", "median_rent_by_type"}
    assert noted["hvi_melbourne"] == noted["hvi_australia"] == (
        "Daily index — the free Cotality feed covers a rolling year; "
        "history accumulates from Jul 2025.")
    assert noted["median_rent"] == noted["median_rent_by_type"] == (
        "Metro/Non-Metro medians from DFFH's LGA tables; grouping differs "
        "slightly from pre-2026 snapshot figures.")
    cash_rate = next(c for c in findings.CHARTS if c["id"] == "cash_rate")
    assert cash_rate["note"] is None


def test_fmt_value_units():
    assert findings.fmt_value(3.85, "percent") == "3.85%"
    assert findings.fmt_value(4400, "dwellings") == "4,400"
    assert findings.fmt_value(183.4, "index") == "183.4"
    assert findings.fmt_value(820000, "aud") == "$820,000"


def test_population_credit_accord_chart_splits_and_modal_metrics():
    """Design review P0-5: mixed-scale charts split by measure — the
    dominant-scale series moves to its own tile/modal so the card's plotted
    lines all share a comparable scale."""
    charts_by_id = {c["id"]: c for c in findings.CHARTS}
    population = charts_by_id["population"]
    assert population["metrics"] == ["net_overseas_migration", "natural_increase"]
    assert population["modal_metrics"] is None
    credit = charts_by_id["credit"]
    assert credit["metrics"] == ["credit_housing_yoy", "credit_investor_yoy",
                                 "credit_owner_occupier_yoy"]
    assert credit["modal_metrics"] == [
        "credit_housing_yoy", "credit_investor_yoy", "credit_owner_occupier_yoy",
        "credit_housing_mom", "credit_investor_mom", "credit_owner_occupier_mom"]
    accord = charts_by_id["accord"]
    assert accord["metrics"] == ["accord_cumulative_actual", "accord_cumulative_target"]
    assert accord["modal_metrics"] == ["accord_quarterly_actual", "accord_quarterly_target"]


def test_split_chart_findings_describe_a_plotted_series():
    """A split chart's headline must name a series actually plotted on the
    card, not one relegated to the modal/a stat tile."""
    for chart_id in ("population", "credit", "accord"):
        chart = next(c for c in findings.CHARTS if c["id"] == chart_id)
        if chart["primary"] is not None:
            assert chart["primary"] in chart["metrics"], chart_id


def test_every_chart_primary_is_among_its_own_metrics_when_both_set():
    for c in findings.CHARTS:
        if c["metrics"] and c["primary"]:
            assert c["primary"] in c["metrics"], c["id"]


def test_held_threshold_aligned_to_display_precision():
    """A 0.02 pp wobble must read as 'held', not 'rose 0.0 pp' (design review
    P1-copy) — the held branch's cutoff must match the 1dp display precision."""
    ls, lm = _loaders({"au_credit": _df([
        ("2026-04-30", "australia", "credit_housing_yoy", 7.50, "percent"),
        ("2026-05-31", "australia", "credit_housing_yoy", 7.52, "percent"),
    ])}, {"au_credit": {"frequency": "monthly"}})
    out = findings.build_findings(ls, lm)
    assert out["credit"] == "Housing credit growth held at 7.52% in May 2026"


def test_level_only_finding_uses_was_not_is():
    """Design review P1-copy: 'is X in YEAR' is wrong for two-year-old data —
    always use 'was', single point or zero-baseline alike."""
    ls, lm = _loaders({"vic_land": _df([
        ("2024-12-31", "melbourne", "greenfield_years_of_supply", 18.0, "years"),
    ])}, {"vic_land": {"frequency": "annual"}})
    out = findings.build_findings(ls, lm)
    assert out["land"] == "Greenfield years of supply was 18.0 yrs in 2024"

    ls2, lm2 = _loaders({"vic_approvals": _df([
        ("2026-04-30", "vic", "approvals_dwellings_total", 0, "dwellings"),
        ("2026-05-31", "vic", "approvals_dwellings_total", 4400, "dwellings"),
    ])})
    out2 = findings.build_findings(ls2, lm2)
    assert out2["approvals"] == "Dwelling approvals was 4,400 in May 2026"


def test_metric_labels_spot_checks():
    ls, _ = _loaders({
        "au_credit": _df([
            ("2026-05-31", "australia", "credit_owner_occupier_mom", 0.4, "percent"),
        ]),
        "vic_rents": _df([
            ("2025-09-30", "melbourne", "rent_1br_flat", 500, "AUD/week"),
        ]),
        "au_mortgage_rates": _df([
            ("2026-05-31", "australia", "mortgage_new_fixed", 5.5, "percent"),
            ("2026-05-31", "australia", "mortgage_outstanding_fixed", 5.8, "percent"),
        ]),
        "au_accord": _df([
            ("2026-03-31", "australia", "accord_cumulative_actual", 133455, "dwellings"),
            ("2026-03-31", "australia", "accord_quarterly_actual", 40000, "dwellings"),
        ]),
        "vic_input_costs": _df([
            ("2026-03-31", "melbourne", "input_cement", 120.0, "index"),
        ]),
    })
    labels = findings.build_metric_labels(ls)
    assert labels["credit_owner_occupier_mom"] == "Owner-occupier, monthly"
    assert labels["rent_1br_flat"] == "1-bed flat"
    assert labels["mortgage_new_fixed"] == "New — fixed"
    assert labels["mortgage_outstanding_fixed"] == "Outstanding — fixed"
    assert labels["accord_cumulative_actual"] == "Actual (cumulative)"
    assert labels["accord_quarterly_actual"] == "Actual (quarterly)"
    assert labels["input_cement"] == "Cement"


def test_metric_labels_covers_declared_metrics_even_with_no_data():
    """auctions' vic_auctions source has never succeeded (design review
    P1-outage), so its metric never appears in real data — but the chart
    still declares it, and the label must be ready for when the source
    recovers rather than only appearing once data exists."""
    ls, _ = _loaders({})  # no series data anywhere
    labels = findings.build_metric_labels(ls)
    assert labels["clearance_rate"] == "Clearance rate"


def test_metric_labels_fallback_humanizes_unknown_metric():
    ls, _ = _loaders({
        "vic_approvals": _df([
            ("2026-05-31", "vic", "brand_new_metric_xyz", 10, "number"),
        ]),
    })
    labels = findings.build_metric_labels(ls)
    assert labels["brand_new_metric_xyz"] == "Brand new metric xyz"


def test_section_summaries_all_quiet_when_no_data():
    ls, lm = _loaders({})
    out = findings.build_section_summaries(ls, lm, date(2026, 7, 18))
    assert set(out) == {"prices", "rents", "supply", "money", "people",
                        "social", "world"}
    assert all(isinstance(v, str) and v for v in out.values())
    assert out["world"] == findings.WORLD_QUIET_SUMMARY
    assert out["prices"] == "No notable moves in Prices this week."
    assert out["people"] == "No notable moves in People this week."


def test_section_summaries_uses_the_sections_scoreable_chart():
    rows_cash = [(f"2026-0{m}-28", "australia", "cash_rate", 3.85, "percent")
                for m in range(1, 6)]
    rows_cash.append(("2026-06-28", "australia", "cash_rate", 3.60, "percent"))
    ls, lm = _loaders({"au_cash_rate": _df(rows_cash)},
                      {"au_cash_rate": {"frequency": "monthly"}})
    out = findings.build_section_summaries(ls, lm, date(2026, 7, 18))
    assert out["money"] == findings.build_findings(ls, lm)["cash_rate"]


def test_section_summaries_world_quiet_state():
    ls, lm = _loaders({
        "intl_fred": _df([
            ("2026-06-30", "global", "brent_crude", 80.0, "USD/barrel"),
            ("2026-07-31", "global", "brent_crude", 80.2, "USD/barrel"),
            ("2026-06-30", "global", "us_10y_treasury", 4.20, "percent"),
            ("2026-07-31", "global", "us_10y_treasury", 4.21, "percent"),
        ]),
        "intl_commodities": _df([
            ("2026-06-30", "global", "iron_ore", 95.0, "USD/tonne"),
            ("2026-07-31", "global", "iron_ore", 95.3, "USD/tonne"),
        ]),
    })
    out = findings.build_section_summaries(ls, lm, date(2026, 7, 18))
    assert out["world"] == findings.WORLD_QUIET_SUMMARY


def test_section_summaries_world_names_the_biggest_mover():
    ls, lm = _loaders({
        "intl_fred": _df([
            ("2026-06-30", "global", "brent_crude", 80.0, "USD/barrel"),
            ("2026-07-31", "global", "brent_crude", 80.2, "USD/barrel"),
        ]),
        "intl_commodities": _df([
            ("2026-06-30", "global", "iron_ore", 95.0, "USD/tonne"),
            ("2026-07-31", "global", "iron_ore", 115.0, "USD/tonne"),
        ]),
    })
    out = findings.build_section_summaries(ls, lm, date(2026, 7, 18))
    assert out["world"] == findings.build_findings(ls, lm)["iron_ore"]


def test_fmt_value_full_unit_vocabulary():
    # Regressions observed live on real data.
    assert findings.fmt_value(3.52655, "percent") == "3.53%"
    assert findings.fmt_value(580, "AUD/week") == "$580/wk"
    assert findings.fmt_value(16808.9, "aud_million") == "$16,809m"
    # percent: round to 2dp, strip trailing zeros.
    assert findings.fmt_value(4.35, "percent") == "4.35%"
    assert findings.fmt_value(9.70, "percent") == "9.7%"
    assert findings.fmt_value(3.0, "percent") == "3%"
    # dwellings / applications / persons / lots / number: thousands, 0dp.
    assert findings.fmt_value(4400, "applications") == "4,400"
    assert findings.fmt_value(4400, "persons") == "4,400"
    assert findings.fmt_value(4400, "lots") == "4,400"
    assert findings.fmt_value(4400, "number") == "4,400"
    # index: 1dp, unchanged.
    assert findings.fmt_value(183.4, "index") == "183.4"
    # aud: unchanged.
    assert findings.fmt_value(820000, "aud") == "$820,000"
    # years: 1dp with unit suffix.
    assert findings.fmt_value(6.2, "years") == "6.2 yrs"
    # USD-money commodity units: 0dp normally, 2dp under 10.
    assert findings.fmt_value(82, "usd_per_barrel") == "US$82"
    assert findings.fmt_value(82, "USD/dmtu") == "US$82"
    assert findings.fmt_value(82, "USD/m3") == "US$82"
    assert findings.fmt_value(82, "USD/tonne") == "US$82"
    assert findings.fmt_value(3.2, "usd_per_barrel") == "US$3.20"
    # usd_per_aud: exchange rate, no $ prefix, 2dp.
    assert findings.fmt_value(0.7, "usd_per_aud") == "0.70"
    # unrecognised: sensible 2dp fallback.
    assert findings.fmt_value(1.23456, "mystery_unit") == "1.23"
