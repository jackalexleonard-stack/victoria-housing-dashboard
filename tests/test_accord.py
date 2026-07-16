from pathlib import Path

from pipeline import common
from pipeline.sources import accord

FIX = Path(__file__).parent / "fixtures"


def test_parse_accord_offline():
    # Reuses the Building Activity fixture (Accord derives from it).
    raw = (FIX / "abs_building_activity.csv").read_text(encoding="utf-8")
    df = accord.parse_accord(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"australia"}
    assert set(df.metric) == {
        "accord_quarterly_actual", "accord_quarterly_target",
        "accord_cumulative_actual", "accord_cumulative_target",
    }
    assert (df.unit == "dwellings").all()
    assert df.date.min() == "2024-09-30"  # first Accord quarter (Jul–Sep 2024)

    piv = df.pivot_table(index="date", columns="metric", values="value")
    # Straight-line 60k/quarter target.
    assert (piv["accord_quarterly_target"] == 60000).all()
    assert piv["accord_cumulative_target"].iloc[0] == 60000
    assert piv["accord_cumulative_target"].iloc[-1] == 60000 * len(piv)
    # Cumulative actual is the running sum of quarterly actual.
    assert abs(piv["accord_cumulative_actual"].iloc[-1] - piv["accord_quarterly_actual"].sum()) < 1e-6
    # Actuals are tracking behind target in this vintage.
    assert piv["accord_cumulative_actual"].iloc[-1] < piv["accord_cumulative_target"].iloc[-1]
