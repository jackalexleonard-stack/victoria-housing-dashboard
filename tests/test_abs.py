from pathlib import Path

from pipeline import common
from pipeline.sources import abs as absrc

FIX = Path(__file__).parent / "fixtures"


def test_parse_approvals_offline():
    raw = (FIX / "abs_ba_gccsa_approvals.csv").read_text(encoding="utf-8")
    df = absrc.parse_approvals(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"vic", "melbourne", "regional_vic"}
    assert set(df.metric) == {
        "approvals_dwellings_total",
        "approvals_houses",
        "approvals_other_residential",
    }
    assert (df.unit == "dwellings").all()

    # Known values from the frozen fixture (May 2026).
    latest = df[df.date == "2026-05-31"].set_index(["region", "metric"])["value"]
    assert latest[("vic", "approvals_dwellings_total")] == 4704
    assert latest[("vic", "approvals_houses")] == 3011
    assert latest[("melbourne", "approvals_dwellings_total")] == 3343

    # Invariant (clean GCCSA era): houses + other residential == total.
    recent = df[df.date >= "2016-01-01"]
    piv = recent.pivot_table(index=["date", "region"], columns="metric", values="value")
    diff = (
        piv["approvals_houses"] + piv["approvals_other_residential"]
        - piv["approvals_dwellings_total"]
    ).dropna()
    assert (diff.abs() < 1e-6).all()


def test_approvals_key_requests_the_national_aggregate():
    from pipeline.sources.abs import _APPROVALS_KEY, _REGION_GCCSA_VIC
    assert "AUS" in _APPROVALS_KEY
    assert _REGION_GCCSA_VIC["AUS"] == "australia"


def test_parse_activity_offline():
    raw = (FIX / "abs_building_activity.csv").read_text(encoding="utf-8")
    df = absrc.parse_activity(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"vic", "australia"}
    assert set(df.metric) == {
        "dwellings_commenced",
        "dwellings_completed",
        "dwellings_under_construction",
    }
    assert (df.unit == "dwellings").all()

    latest = df[df.date == "2026-03-31"].set_index(["region", "metric"])["value"]
    assert latest[("vic", "dwellings_completed")] == 12214
    assert latest[("australia", "dwellings_completed")] == 38182
    assert latest[("vic", "dwellings_under_construction")] == 61356

    # quarterly period-end dates only
    assert df.date.str.endswith(("-03-31", "-06-30", "-09-30", "-12-31")).all()


def test_parse_input_costs_offline():
    raw = (FIX / "abs_ppi_house_inputs.csv").read_text(encoding="utf-8")
    df = absrc.parse_input_costs(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne"}
    assert set(df.metric) == {"input_all_groups", "input_timber", "input_steel", "input_cement"}
    assert (df.unit == "index").all()

    latest = df[df.date == "2026-03-31"].set_index("metric")["value"]
    assert latest["input_all_groups"] == 166.6
    assert latest["input_timber"] == 171.0
    assert df.date.str.endswith(("-03-31", "-06-30", "-09-30", "-12-31")).all()


def test_parse_lending_offline():
    raw = (FIX / "abs_lending_housing.csv").read_text(encoding="utf-8")
    df = absrc.parse_lending(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"vic", "australia"}
    assert set(df.metric) == {
        "lending_owner_occupier",
        "lending_investor",
        "lending_first_home_buyer",
        "lending_total",
    }
    assert (df.unit == "aud_million").all()

    latest = df[df.date == "2026-03-31"].set_index(["region", "metric"])["value"]
    assert latest[("australia", "lending_owner_occupier")] == 61421.6
    assert latest[("australia", "lending_total")] == 102959.2
    assert latest[("vic", "lending_first_home_buyer")] == 5502.5

    # OO + investor == total (national), and FHB is a subset of OO.
    au = df[df.region == "australia"].pivot_table(index="date", columns="metric", values="value")
    add = (au["lending_owner_occupier"] + au["lending_investor"] - au["lending_total"]).dropna()
    assert (add.abs() < 1.0).all()
    fhb = au[["lending_first_home_buyer", "lending_owner_occupier"]].dropna()
    assert (fhb["lending_first_home_buyer"] <= fhb["lending_owner_occupier"]).all()


def test_parse_population_offline():
    raw = (FIX / "abs_erp_comp_q.csv").read_text(encoding="utf-8")
    df = absrc.parse_population(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"vic", "australia"}
    assert set(df.metric) == {
        "population_erp",
        "net_overseas_migration",
        "natural_increase",
        "population_growth_qtr",
    }
    assert (df.unit == "persons").all()

    latest = df[df.date == "2025-12-31"].set_index(["region", "metric"])["value"]
    assert latest[("australia", "population_erp")] == 27801000
    assert latest[("australia", "net_overseas_migration")] == 56600
    assert latest[("vic", "population_erp")] == 7121900

    # National identity: growth == natural increase + NOM (net internal ~0 nationally).
    assert latest[("australia", "population_growth_qtr")] == (
        latest[("australia", "natural_increase")]
        + latest[("australia", "net_overseas_migration")]
    )

    # ERP is a large positive level; quarterly period-ends.
    assert (df[df.metric == "population_erp"].value > 1e6).all()
    assert df.date.str.endswith(("-03-31", "-06-30", "-09-30", "-12-31")).all()


def test_res_dwell_parses_the_fixture_into_tidy_rows_with_the_expected_regions():
    from pipeline.sources.abs import parse_res_dwell

    raw = (FIX / "abs_res_dwell.csv").read_text(encoding="utf-8")
    df = parse_res_dwell(raw)

    # Schema is fixed law for every series in this repo.
    assert list(df.columns) == ["date", "region", "metric", "value", "unit"]
    # (1) The regions this source is being added FOR — the whole point of the task.
    assert set(df["region"]) == {"melbourne", "regional_vic"}
    # (2) Metrics are the ones the chart will plot, nothing stray (the raw
    # fixture also carries transfer-count measures 1/2 — dropped, not charted).
    assert set(df["metric"]) == {"median_price_house", "median_price_attached"}
    # (3) A spot value hand-verified against the fixture (MEASURE=3 "Median
    # Price of Established House Transfers", REGION=2GMEL, TIME_PERIOD=2026-Q1,
    # OBS_VALUE=850, UNIT_MULT=3 -> 850 * 10**3 = 850000).
    row = df[(df.region == "melbourne") & (df.date == "2026-03-31")
             & (df.metric == "median_price_house")]
    assert len(row) == 1 and row.iloc[0]["value"] == 850000

    assert df["value"].notna().all()
    assert not df.duplicated(["date", "region", "metric"]).any()


def test_population_gccsa_parses_the_fixture_into_tidy_rows_with_the_expected_regions():
    from pipeline.sources.abs import parse_population_gccsa

    raw = (FIX / "abs_erp_gccsa.csv").read_text(encoding="utf-8")
    df = parse_population_gccsa(raw)

    # Schema is fixed law for every series in this repo.
    assert list(df.columns) == ["date", "region", "metric", "value", "unit"]
    # (1) The regions this source is being added FOR — the whole point of the task.
    assert set(df["region"]) == {"melbourne", "regional_vic"}
    # (2) Metrics are the ones the chart will plot, nothing stray.
    assert set(df["metric"]) == {
        "population_erp",
        "net_overseas_migration",
        "net_internal_migration",
        "natural_increase",
    }
    assert (df.unit == "persons").all()

    # (3) A spot value hand-verified against the fixture (POP_COMP=10 "ERP",
    # REGION=2GMEL, TIME_PERIOD=2025, OBS_VALUE=5435590 — this dataflow has no
    # UNIT_MULT column, so OBS_VALUE is already whole persons, no scaling).
    row = df[(df.region == "melbourne") & (df.date == "2025-12-31")
             & (df.metric == "population_erp")]
    assert len(row) == 1 and row.iloc[0]["value"] == 5435590

    assert df["value"].notna().all()
    assert not df.duplicated(["date", "region", "metric"]).any()

    # This dataflow is ANNUAL — period-end dates must land on 31 Dec only.
    assert df.date.str.endswith("-12-31").all()


def test_parse_dwelling_stock_offline():
    raw = (FIX / "abs_res_dwell_st.csv").read_text(encoding="utf-8")
    df = absrc.parse_dwelling_stock(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"vic", "australia"}
    assert set(df.metric) == {"dwelling_count", "mean_price"}
    assert set(df.unit) == {"dwellings", "aud"}

    latest = df[df.date == "2026-03-31"].set_index(["region", "metric"])["value"]
    assert latest[("australia", "dwelling_count")] == 11495200
    assert latest[("australia", "mean_price")] == 1111100
    assert latest[("vic", "mean_price")] == 947100

    # units attach per metric; quarterly period-ends
    assert (df[df.metric == "mean_price"].unit == "aud").all()
    assert (df[df.metric == "dwelling_count"].unit == "dwellings").all()
    assert df.date.str.endswith(("-03-31", "-06-30", "-09-30", "-12-31")).all()


def test_au_rents_parses_the_fixture_into_tidy_rows_with_the_expected_regions():
    from pipeline.sources.abs import parse_au_rents

    raw = (FIX / "abs_cpi_rents.csv").read_text(encoding="utf-8")
    df = parse_au_rents(raw)

    # Schema is fixed law for every series in this repo.
    assert list(df.columns) == ["date", "region", "metric", "value", "unit"]
    # (1) The regions this source is being added FOR — the whole point of the task.
    # REGION=50 on this dataflow ("weighted average of eight capital cities")
    # is the only Australia-wide code that exists here — there is no plain
    # "AUS" code on CPI. REGION=2 (Melbourne) was fetched alongside for live
    # confirmation only and must be dropped, not relabelled.
    assert set(df["region"]) == {"australia"}
    # (2) Metrics are the ones the chart will plot, nothing stray. This is a
    # PRICE INDEX (MEASURE=1 "Index numbers"), not a median in dollars — the
    # fixture also carries MEASURE=3 (%-change-from-previous-year) and two
    # unrelated INDEX groups (131186 "New dwelling purchase by
    # owner-occupiers", 20003 the parent "Housing" group), all fetched for
    # live confirmation only and must be dropped, not blended in.
    assert set(df["metric"]) == {"rent_index"}
    assert (df["unit"] == "index").all()
    # (3) A spot value hand-verified against the fixture (REGION=50,
    # MEASURE=1, INDEX=115522 "Rents", TIME_PERIOD=2026-05, OBS_VALUE=102.33).
    row = df[(df.region == "australia") & (df.date == "2026-05-31")
             & (df.metric == "rent_index")]
    assert len(row) == 1 and row.iloc[0]["value"] == 102.33

    assert df["value"].notna().all()
    assert not df.duplicated(["date", "region", "metric"]).any()
