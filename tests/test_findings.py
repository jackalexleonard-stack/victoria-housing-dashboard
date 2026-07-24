from datetime import date
import pandas as pd
from pipeline import export, findings


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
    assert out["approvals"]["vic"] == "Dwelling approvals rose 10.0% to 4,400 in May 2026"


def test_generic_finding_fall_and_flat():
    ls, lm = _loaders({"vic_activity": _df([
        ("2025-12-31", "vic", "dwellings_commenced", 12000, "dwellings"),
        ("2026-03-31", "vic", "dwellings_commenced", 11400, "dwellings"),
    ])}, {"vic_activity": {"frequency": "quarterly"}})
    out = findings.build_findings(ls, lm)
    assert out["activity"]["vic"] == "Dwellings commenced fell 5.0% to 11,400 in Mar qtr 2026"


def test_cash_rate_held_wording():
    rows = [(f"2026-0{m}-28", "australia", "cash_rate", 3.85, "percent") for m in range(1, 7)]
    ls, lm = _loaders({"au_cash_rate": _df(rows)},
                      {"au_cash_rate": {"frequency": "monthly"}})
    out = findings.build_findings(ls, lm)
    assert out["cash_rate"]["australia"] == "The cash rate has held at 3.85% since Jan 2026"


def test_hvi_finding_uses_mom():
    ls, lm = _loaders({"vic_hvi": _df([
        # chart_geos derives coverage from the chart's *declared* metrics
        # (hvi_index — what's plotted), not the mom/yoy columns _hvi actually
        # reads for its sentence, so a real fixture needs an hvi_index row
        # for the geo to be detected at all.
        ("2026-06-30", "melbourne", "hvi_index", 183.4, "index"),
        ("2026-05-31", "melbourne", "hvi_change_mom", 0.2, "percent"),
        ("2026-06-30", "melbourne", "hvi_change_mom", -1.0, "percent"),
        ("2026-06-30", "melbourne", "hvi_change_yoy", -0.9, "percent"),
    ])}, {"vic_hvi": {"frequency": "daily"}})
    out = findings.build_findings(ls, lm)
    assert out["hvi_melbourne"]["melbourne"] == \
        "Melb dwelling values fell 1.0% in Jun 2026 (-0.9% over the year)"


def test_accord_finding_vs_target():
    ls, lm = _loaders({"au_accord": _df([
        ("2026-03-31", "australia", "accord_cumulative_actual", 133455, "dwellings"),
        ("2026-03-31", "australia", "accord_cumulative_target", 180000, "dwellings"),
    ])}, {"au_accord": {"frequency": "quarterly"}})
    out = findings.build_findings(ls, lm)
    assert out["accord"]["australia"] == \
        "Completions trail the Accord track by 46,545 homes as at Mar qtr 2026"


def test_median_rent_by_type_finding_uses_3br_house_primary():
    ls, lm = _loaders({"vic_rents": _df([
        ("2025-06-30", "melbourne", "rent_3br_house", 540, "AUD/week"),
        ("2025-09-30", "melbourne", "rent_3br_house", 550, "AUD/week"),
        ("2025-09-30", "melbourne", "rent_1br_flat", 500, "AUD/week"),
    ])}, {"vic_rents": {"frequency": "quarterly"}})
    out = findings.build_findings(ls, lm)
    assert out["median_rent_by_type"]["melbourne"] == \
        "The median 3-bedroom-house rent rose 1.9% to $550/wk in Sep qtr 2025"


def test_failed_series_produces_no_findings_entries_for_any_geo():
    """Under the per-geo model a chart with no data at all has no geos
    (chart_geos), so build_findings produces an empty per-geo dict rather
    than a NO_DATA_FINDING sentinel string — the front end renders its own
    no-data state per geo instead."""
    ls, lm = _loaders({}, {"vic_auctions": {"frequency": "weekly", "status": "failed"}})
    out = findings.build_findings(ls, lm)
    assert out["auctions"] == {}


def test_exactly_nine_charts_carry_a_note():
    noted = {c["id"]: c["note"] for c in findings.CHARTS if c.get("note")}
    assert set(noted) == {"hvi_melbourne", "hvi_australia",
                           "median_rent", "median_rent_by_type",
                           "population_gccsa", "au_rent_index", "output_costs",
                           "social_housing_rogs", "land"}
    assert noted["hvi_melbourne"] == noted["hvi_australia"] == (
        "Daily index — the free Cotality feed covers a rolling year; "
        "history accumulates from Jul 2025.")
    assert noted["median_rent"] == noted["median_rent_by_type"] == (
        "Metro/Non-Metro medians from DFFH's LGA tables; grouping differs "
        "slightly from pre-2026 snapshot figures.")
    assert noted["population_gccsa"] == (
        "Annual ABS data (components of population change by GCCSA) — a "
        "separate, less-frequent series from the quarterly Victoria/"
        "Australia population figures above.")
    assert noted["au_rent_index"] == (
        "ABS CPI rents index for the weighted average of eight capital "
        "cities — an index, not a bond-based median; not comparable "
        "with the Victorian median rents above.")
    # Task 12: OUTPUT price index (what builders charge) is a different
    # concept from input_costs (what builders pay) — the note keeps them
    # from being mistaken for one another.
    assert noted["output_costs"] == (
        "ABS OUTPUT price index — what builders charge, not what they "
        "pay for materials (see input costs above); a different measure, "
        "never combined with it.")
    # Task 14: RoGS' cross-jurisdiction public-housing count is a different
    # figure from the VHR waitlist above (Homes Victoria's own count) — the
    # note keeps them from being mistaken for one another.
    assert noted["social_housing_rogs"] == (
        "Productivity Commission Report on Government Services (RoGS), "
        "annual — public housing only, not all social housing; a "
        "separate figure from the Victorian Housing Register above.")
    # Task 15: land's region_mode flipped fixed:melbourne -> geo so
    # regional_vic's Task 9 rows stop sitting dormant — the note discloses
    # the two regions' different reporting cadences (not annualised away).
    assert noted["land"] == (
        "Melbourne and Regional Victoria publish on different cadences — "
        "Melbourne a full year to Dec, Regional a half-year \"Titled H1\" "
        "snapshot to Jun — not annualised to match.")
    cash_rate = next(c for c in findings.CHARTS if c["id"] == "cash_rate")
    assert cash_rate["note"] is None


def test_au_rent_index_is_a_separate_index_series_never_merged_with_median_rent():
    """Task 11: au_rents (ABS CPI rents index, weighted average of eight
    capital cities) must be a wholly separate series/chart from vic_rents'
    median_rent (DFFH bond-lodgement dollar medians) — different series_id,
    different unit ("index" vs "aud_per_week"), never combined, and its
    finding sentence must never read as a dollar figure."""
    median_rent = next(c for c in findings.CHARTS if c["id"] == "median_rent")
    au_rent_index = next(c for c in findings.CHARTS if c["id"] == "au_rent_index")
    assert median_rent["series_id"] == "vic_rents"
    assert au_rent_index["series_id"] == "au_rents"
    assert median_rent["series_id"] != au_rent_index["series_id"]
    assert au_rent_index["metrics"] == ["rent_index"]
    assert au_rent_index["title"] == "Rent price index — capital cities"
    assert au_rent_index["region_mode"] == "fixed:australia"
    assert au_rent_index["scope"] == "geo"

    ls, lm = _loaders(
        {"au_rents": _df([
            ("2026-04-30", "australia", "rent_index", 101.90, "index"),
            ("2026-05-31", "australia", "rent_index", 102.33, "index"),
        ])},
        {"au_rents": {"frequency": "monthly"}},
    )
    # Only the Australia-wide geo this source publishes — no melbourne/vic
    # fallback, and never combined with vic_rents' geos.
    assert export.chart_geos(au_rent_index, ls) == ["australia"]
    out = findings.build_findings(ls, lm)
    assert set(out["au_rent_index"]) == {"australia"}
    # fmt_value's "index" branch (one-decimal, no currency sign) — proves the
    # finding sentence cannot be mistaken for a dollar median.
    sentence = out["au_rent_index"]["australia"]
    assert findings.fmt_value(102.33, "index") == "102.3"
    assert "102.3" in sentence and "$" not in sentence


def test_population_gccsa_is_annual_and_separate_from_the_quarterly_population_chart():
    """Task 10: vic_population_gccsa (Melbourne/Regional Vic components of
    change) must be a wholly separate series/chart from au_population
    (Victoria/Australia, quarterly) — never merged into one series, and its
    finding must read the year only (annual), not a quarter label."""
    pop = next(c for c in findings.CHARTS if c["id"] == "population")
    pop_gccsa = next(c for c in findings.CHARTS if c["id"] == "population_gccsa")
    assert pop["series_id"] == "au_population"
    assert pop_gccsa["series_id"] == "vic_population_gccsa"
    assert pop["series_id"] != pop_gccsa["series_id"]

    ls, lm = _loaders(
        {"vic_population_gccsa": _df([
            ("2024-12-31", "melbourne", "net_overseas_migration", 119037, "persons"),
            ("2025-12-31", "melbourne", "net_overseas_migration", 81168, "persons"),
            ("2024-12-31", "regional_vic", "net_overseas_migration", 8844, "persons"),
            ("2025-12-31", "regional_vic", "net_overseas_migration", 5991, "persons"),
        ])},
        {"vic_population_gccsa": {"frequency": "annual"}},
    )
    out = findings.build_findings(ls, lm)
    # Only the two geos this source genuinely publishes — never vic/australia.
    assert set(out["population_gccsa"]) == {"melbourne", "regional_vic"}
    # Annual period formatting (fmt_period) — a bare year, no quarter/month.
    assert out["population_gccsa"]["melbourne"] == (
        "Net overseas migration fell 31.8% to 81,168 in 2025"
    )


def test_hvi_charts_use_the_canonical_short_name_everywhere():
    """Design review d1: the Cotality HVI 'naming triple' — card caption
    (chart.title), finding subject (_hvi), and hero tile label
    (scoring.REGISTRY) must all read identically, not three different names
    for the same two series."""
    from pipeline import scoring
    charts_by_id = {c["id"]: c for c in findings.CHARTS}
    assert charts_by_id["hvi_melbourne"]["title"] == "Melb dwelling values"
    assert charts_by_id["hvi_australia"]["title"] == "AU dwelling values"
    # Independently re-derived from scoring.REGISTRY (cadence code stripped)
    # rather than re-asserting the same literal — proves the two can't drift.
    assert charts_by_id["hvi_melbourne"]["title"] == \
        findings._strip_cadence_code(scoring.REGISTRY["melb_dwelling_values"]["label"])
    assert charts_by_id["hvi_australia"]["title"] == \
        findings._strip_cadence_code(scoring.REGISTRY["au_dwelling_values"]["label"])

    ls, lm = _loaders({"vic_hvi": _df([
        # hvi_index row needed for chart_geos to detect the melbourne geo
        # (it filters on the chart's declared metrics, not mom/yoy).
        ("2026-06-30", "melbourne", "hvi_index", 183.4, "index"),
        ("2026-06-30", "melbourne", "hvi_change_mom", 0.5, "percent"),
        ("2026-06-30", "melbourne", "hvi_change_yoy", 2.1, "percent"),
    ])}, {"vic_hvi": {"frequency": "daily"}})
    assert findings.build_findings(ls, lm)["hvi_melbourne"]["melbourne"] \
        .startswith("Melb dwelling values ")

    ls2, lm2 = _loaders({"au_hvi": _df([
        ("2026-06-30", "australia", "hvi_index", 210.0, "index"),
        ("2026-06-30", "australia", "hvi_change_mom", -0.2, "percent"),
        ("2026-06-30", "australia", "hvi_change_yoy", 1.0, "percent"),
    ])}, {"au_hvi": {"frequency": "daily"}})
    assert findings.build_findings(ls2, lm2)["hvi_australia"]["australia"] \
        .startswith("AU dwelling values ")


def test_fred_charts_carry_distinct_per_chart_source_names():
    """Design review d2: the three FRED charts share one series_id
    (intl_fred), and thus one shared meta.source_name — each chart cites its
    own instrument via a per-chart source_name override instead of repeating
    the combined feed string on every card's detail modal."""
    charts_by_id = {c["id"]: c for c in findings.CHARTS}
    assert charts_by_id["brent"]["source_name"] == "FRED — Brent crude (DCOILBRENTEU)"
    assert charts_by_id["aud_usd"]["source_name"] == "FRED — AUD/USD (DEXUSAL)"
    assert charts_by_id["ust10"]["source_name"] == "FRED — US 10-year Treasury (DGS10)"
    names = {charts_by_id[c]["source_name"] for c in ("brent", "aud_usd", "ust10")}
    assert len(names) == 3, "all three must be distinct, not the shared feed string"
    # Everything else is untouched (None -> frontend falls back to the
    # series' own shared meta.source_name).
    assert charts_by_id["cash_rate"]["source_name"] is None
    assert charts_by_id["iron_ore"]["source_name"] is None


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
    assert out["credit"]["australia"] == "Housing credit growth held at 7.52% in May 2026"


def test_level_only_finding_uses_was_not_is():
    """Design review P1-copy: 'is X in YEAR' is wrong for two-year-old data —
    always use 'was', single point or zero-baseline alike."""
    ls, lm = _loaders({"vic_land": _df([
        ("2024-12-31", "melbourne", "greenfield_years_of_supply", 18.0, "years"),
    ])}, {"vic_land": {"frequency": "annual"}})
    out = findings.build_findings(ls, lm)
    assert out["land"]["melbourne"] == "Greenfield years of supply was 18.0 yrs in 2024"

    ls2, lm2 = _loaders({"vic_approvals": _df([
        ("2026-04-30", "vic", "approvals_dwellings_total", 0, "dwellings"),
        ("2026-05-31", "vic", "approvals_dwellings_total", 4400, "dwellings"),
    ])})
    out2 = findings.build_findings(ls2, lm2)
    assert out2["approvals"]["vic"] == "Dwelling approvals was 4,400 in May 2026"


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
    # T4 Step 4.4b: section_summaries is per-geo now ({section: {geo:
    # sentence}}), mirroring findings.
    assert all(isinstance(v, dict) and v for v in out.values())
    for per_geo in out.values():
        assert all(isinstance(s, str) and s for s in per_geo.values())
    from pipeline.export import UI_GEOS
    assert out["world"] == {g: findings.WORLD_QUIET_SUMMARY for g in UI_GEOS}
    assert out["prices"] == {g: "No notable moves in Prices this week." for g in UI_GEOS}
    assert out["people"] == {g: "No notable moves in People this week." for g in UI_GEOS}


def test_section_summaries_uses_the_sections_scoreable_chart():
    rows_cash = [(f"2026-0{m}-28", "australia", "cash_rate", 3.85, "percent")
                for m in range(1, 6)]
    rows_cash.append(("2026-06-28", "australia", "cash_rate", 3.60, "percent"))
    ls, lm = _loaders({"au_cash_rate": _df(rows_cash)},
                      {"au_cash_rate": {"frequency": "monthly"}})
    out = findings.build_section_summaries(ls, lm, date(2026, 7, 18))
    # T4 Step 4.4b: now the mover's OWN per-geo findings dict, not one
    # sentence collapsed from it — the fix for the Melbourne-first bias.
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
    # T4 Step 4.4b: World's single sentence is replicated across every UI
    # geo (genuinely geo-independent — see _world_summary's docstring).
    from pipeline.export import UI_GEOS
    assert out["world"] == {g: findings.WORLD_QUIET_SUMMARY for g in UI_GEOS}


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
    # World charts are all region_mode "fixed:global" — "global" is
    # deliberately outside UI_GEOS, so build_findings()["iron_ore"] is
    # always {} (see test_global_regions_never_appear_as_a_ui_geo in
    # test_export.py). The expected sentence is computed the same way
    # _world_summary computes it: directly via _finding_for — T4 Step 4.4b
    # replicates that one sentence across every UI geo.
    from pipeline.export import UI_GEOS
    iron_ore = next(c for c in findings.CHARTS if c["id"] == "iron_ore")
    expected = findings._finding_for(iron_ore, ls, lm, "global")
    assert out["world"] == {g: expected for g in UI_GEOS}


def test_section_summaries_are_per_geo_not_melbourne_first():
    """T4 Step 4.4b: the defect this step closes. median_rent (rents'
    scoreable mover chart, region_mode="geo") has genuinely different
    melbourne vs regional_vic data below — the section summary must carry
    BOTH sentences, not collapse to Melbourne's alone (the same bias Task 2
    already fixed for per-chart findings, recreated here one level up)."""
    rows = [
        ("2026-05-31", "melbourne", "median_rent", 560, "aud"),
        ("2026-06-30", "melbourne", "median_rent", 580, "aud"),
        ("2026-05-31", "regional_vic", "median_rent", 420, "aud"),
        ("2026-06-30", "regional_vic", "median_rent", 400, "aud"),
    ]
    ls, lm = _loaders({"vic_rents": _df(rows)},
                      {"vic_rents": {"frequency": "quarterly"}})
    text, quiet = findings.build_section_summaries_full(ls, lm, date(2026, 7, 18))
    assert quiet["rents"] is False
    # Same dict build_findings computes for median_rent directly — the
    # section summary no longer collapses it to one entry.
    assert text["rents"] == findings.build_findings(ls, lm)["median_rent"]
    assert set(text["rents"]) == {"melbourne", "regional_vic"}
    assert text["rents"]["melbourne"] != text["rents"]["regional_vic"]


# --- T6: section_summary_quiet — the honesty-override flag, derived in
# Python right where the sentinel strings are authored (not string-matched
# client-side, which broke the moment prose drifted from the sentinel). ---

def test_section_summaries_full_flags_every_section_quiet_when_no_data():
    ls, lm = _loaders({})
    text, quiet = findings.build_section_summaries_full(ls, lm, date(2026, 7, 18))
    assert set(quiet) == {"prices", "rents", "supply", "money", "people",
                         "social", "world"}
    assert all(quiet.values())
    # The thin wrapper's text output must match the full function's text dict
    # exactly — no divergence between the two entry points.
    assert text == findings.build_section_summaries(ls, lm, date(2026, 7, 18))


def test_section_summaries_full_flags_a_real_finding_section_not_quiet():
    rows_cash = [(f"2026-0{m}-28", "australia", "cash_rate", 3.85, "percent")
                for m in range(1, 6)]
    rows_cash.append(("2026-06-28", "australia", "cash_rate", 3.60, "percent"))
    ls, lm = _loaders({"au_cash_rate": _df(rows_cash)},
                      {"au_cash_rate": {"frequency": "monthly"}})
    text, quiet = findings.build_section_summaries_full(ls, lm, date(2026, 7, 18))
    assert quiet["money"] is False
    # T4 Step 4.4b: the mover's own per-geo findings dict, not one sentence
    # collapsed from it.
    assert text["money"] == findings.build_findings(ls, lm)["cash_rate"]
    # Sections with no scoreable chart at all stay flagged quiet.
    assert quiet["people"] is True


def test_section_summaries_full_world_quiet_vs_real_mover():
    quiet_ls, quiet_lm = _loaders({
        "intl_fred": _df([
            ("2026-06-30", "global", "brent_crude", 80.0, "USD/barrel"),
            ("2026-07-31", "global", "brent_crude", 80.2, "USD/barrel"),
        ]),
    })
    _, quiet = findings.build_section_summaries_full(quiet_ls, quiet_lm, date(2026, 7, 18))
    assert quiet["world"] is True

    mover_ls, mover_lm = _loaders({
        "intl_commodities": _df([
            ("2026-06-30", "global", "iron_ore", 95.0, "USD/tonne"),
            ("2026-07-31", "global", "iron_ore", 115.0, "USD/tonne"),
        ]),
    })
    _, quiet2 = findings.build_section_summaries_full(mover_ls, mover_lm, date(2026, 7, 18))
    assert quiet2["world"] is False


def test_world_summary_returns_text_and_quiet_flag_together():
    """Backlog cleanup: _world_summary chooses its bool flag WITH the text
    it returns (a (text, is_quiet) tuple) instead of the caller re-deriving
    "was this quiet?" by string-comparing the result against
    WORLD_QUIET_SUMMARY after the fact.

    _world_summary now takes (load_series, load_meta) directly — World's
    charts are all "fixed:global", permanently absent from build_findings'
    per-geo output (global is outside UI_GEOS), so there is no findings_out
    to hand it any more; it computes its own sentence via _finding_for."""
    quiet_ls, quiet_lm = _loaders({
        "intl_fred": _df([
            ("2026-06-30", "global", "brent_crude", 80.0, "USD/barrel"),
            ("2026-07-31", "global", "brent_crude", 80.2, "USD/barrel"),
        ]),
    })
    text, is_quiet = findings._world_summary(quiet_ls, quiet_lm)
    assert (text, is_quiet) == (findings.WORLD_QUIET_SUMMARY, True)

    mover_ls, mover_lm = _loaders({
        "intl_commodities": _df([
            ("2026-06-30", "global", "iron_ore", 95.0, "USD/tonne"),
            ("2026-07-31", "global", "iron_ore", 115.0, "USD/tonne"),
        ]),
    })
    text2, is_quiet2 = findings._world_summary(mover_ls, mover_lm)
    iron_ore = next(c for c in findings.CHARTS if c["id"] == "iron_ore")
    assert text2 == findings._finding_for(iron_ore, mover_ls, mover_lm, "global")
    assert is_quiet2 is False


def test_world_summary_names_the_biggest_mover_against_a_frozen_fixture():
    """The independent, PERMANENT regression guard on the World mover's
    sentence-building path (_finding_for -> _generic -> _primary_frame).

    This deliberately does NOT run against the committed data/ directory —
    data/ is rewritten every day by the scheduled GitHub Action
    (update.yml's cron), so any assertion pinning a specific number,
    percentage, or month against real data goes stale within a day of being
    written (a test that goes red daily trains everyone to ignore CI, and
    breaks on `main` the moment this branch merges). A hand-built,
    deterministic fixture — values chosen so the winner and its exact
    wording are knowable in advance — gives independence (the expected
    string below is typed out by hand from fmt_value/fmt_period's own
    documented rules, never obtained by calling _finding_for/_generic) AND
    permanent stability, since the fixture never changes. See
    test_world_summary_smoke_test_against_real_committed_data, below, for
    the complementary end-to-end guard that intentionally asserts nothing
    that a data refresh could invalidate."""
    ls, lm = _loaders({
        "intl_fred": _df([
            # 0.25% change: below WORLD_QUIET_PCT (1.0%) -> not a mover.
            ("2026-06-30", "global", "brent_crude", 80.0, "USD/barrel"),
            ("2026-07-31", "global", "brent_crude", 80.2, "USD/barrel"),
            # 0.01 pp change: below WORLD_QUIET_PP (0.15 pp) -> not a mover.
            ("2026-06-30", "global", "us_10y_treasury", 4.20, "percent"),
            ("2026-07-31", "global", "us_10y_treasury", 4.21, "percent"),
        ]),
        "intl_commodities": _df([
            # A genuine mover (~5.6%, above the 1.0% floor) but smaller than
            # iron ore's — proves the BIGGEST mover is picked, not just the
            # only one present.
            ("2026-06-30", "global", "copper", 9.00, "USD/tonne"),
            ("2026-07-31", "global", "copper", 9.50, "USD/tonne"),
            # The biggest mover: (115/95 - 1) * 100 = 21.0526...% -> "21.1%"
            # at the sentence's 1dp display precision.
            ("2026-06-30", "global", "iron_ore", 95.0, "USD/dmtu"),
            ("2026-07-31", "global", "iron_ore", 115.0, "USD/dmtu"),
        ]),
    })
    text, is_quiet = findings._world_summary(ls, lm)
    assert text == "Iron ore rose 21.1% to US$115 in Jul 2026"
    assert is_quiet is False


def test_world_summary_smoke_test_against_real_committed_data():
    """End-to-end guard that the real pipeline still produces a coherent
    World summary from the committed data/ directory — deliberately asserts
    NOTHING volatile (no number, percentage, or month), because that
    directory is rewritten daily by the scheduled GitHub Action
    (update.yml's cron): pinning any live value here would go stale within a
    day (see test_world_summary_names_the_biggest_mover_against_a_frozen_fixture,
    above, for the independent, permanent guard on the actual
    sentence-building logic that this smoke test intentionally does not
    duplicate)."""
    best = None
    for chart in findings.CHARTS:
        if chart["section"] != "world":
            continue
        geo = chart["region_mode"].split(":", 1)[1]
        df = findings._primary_frame(chart, export.load_series, geo)
        if len(df) < 2:
            continue
        v, p = float(df["value"].iloc[-1]), float(df["value"].iloc[-2])
        unit = str(df["unit"].iloc[-1])
        if unit == "percent":
            mag, floor = abs(v - p), findings.WORLD_QUIET_PP
        else:
            if p == 0:
                continue
            mag, floor = abs((v / p - 1) * 100), findings.WORLD_QUIET_PCT
        if mag < floor:
            continue
        if best is None or mag > best[0]:
            best = (mag, chart)
    assert best is not None, "sanity: real data must have a genuine mover today"

    text, is_quiet = findings._world_summary(export.load_series, export.load_meta)
    assert isinstance(text, str) and text
    assert is_quiet is False
    # The sentence must open with the winning chart's own subject — a real
    # sentence-source mismatch (wrong chart's text) still fails this test —
    # without pinning to any number/percentage/month a daily refresh would
    # change. World charts never use a custom builder (none are in
    # _CUSTOM), so every one's sentence is built by _generic, which always
    # opens with chart["noun"] (falling back to chart["title"] only when
    # noun is unset — never true for World's six charts). noun and title
    # diverge for two of them (aud_usd: title "AUD/USD" vs noun "The
    # Australian dollar"; ust10: title "US 10-year Treasury" vs noun "The
    # US 10-year yield"), so noun — not title — is the only prefix that's
    # correct regardless of which chart wins on a given day.
    winner = best[1]
    subject = winner["noun"] or winner["title"]
    assert text.startswith(subject)


def test_hvi_near_zero_mom_reads_as_held_flat_not_a_fake_move():
    """Backlog cleanup: an exact `v == 0` check missed the same near-zero-
    but-displays-as-0.0 case _generic's HELD_THRESHOLD_PP already covers
    elsewhere (design review P1-copy) — align _hvi with the same
    display-precision threshold. Both sides of the boundary."""
    def hvi_finding(mom):
        ls, lm = _loaders({"vic_hvi": _df([
            # hvi_index row needed for chart_geos to detect the melbourne geo.
            ("2026-06-30", "melbourne", "hvi_index", 183.4, "index"),
            ("2026-05-31", "melbourne", "hvi_change_mom", 1.0, "percent"),
            ("2026-06-30", "melbourne", "hvi_change_mom", mom, "percent"),
        ])}, {"vic_hvi": {"frequency": "daily"}})
        return findings.build_findings(ls, lm)["hvi_melbourne"]["melbourne"]

    # Just inside the threshold (0.03 < 0.05) -> "held flat", not "rose 0.0%".
    assert hvi_finding(0.03) == "Melb dwelling values held flat in Jun 2026"
    # Just outside it (0.06 >= 0.05) -> a real move, rounded to 1dp as usual.
    assert hvi_finding(0.06) == "Melb dwelling values rose 0.1% in Jun 2026"


def test_findings_are_keyed_by_geo_and_use_that_geo_s_own_data(tmp_path):
    import pandas as pd
    from pipeline.findings import build_findings

    df = pd.DataFrame([
        ("2026-03-31", "melbourne", "median_rent", 575.0, "aud_per_week"),
        ("2026-06-30", "melbourne", "median_rent", 590.0, "aud_per_week"),
        ("2026-03-31", "regional_vic", "median_rent", 460.0, "aud_per_week"),
        ("2026-06-30", "regional_vic", "median_rent", 470.0, "aud_per_week"),
    ], columns=["date", "region", "metric", "value", "unit"])

    out = build_findings(lambda _s: df, lambda _s: {"frequency": "quarterly"})
    mr = out["median_rent"]
    assert set(mr) >= {"melbourne", "regional_vic"}
    # The regional sentence must quote the REGIONAL number, never Melbourne's.
    assert "470" in mr["regional_vic"]
    assert "590" not in mr["regional_vic"]
    assert "590" in mr["melbourne"]


def test_no_finding_is_produced_for_a_geo_the_chart_has_no_data_for():
    import pandas as pd
    from pipeline.findings import build_findings

    df = pd.DataFrame([
        ("2026-06-30", "melbourne", "median_rent", 590.0, "aud_per_week"),
    ], columns=["date", "region", "metric", "value", "unit"])
    out = build_findings(lambda _s: df, lambda _s: {"frequency": "quarterly"})
    assert "regional_vic" not in out["median_rent"]


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
