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
