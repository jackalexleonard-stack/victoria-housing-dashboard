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
