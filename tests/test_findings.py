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


def test_failed_series_gets_no_data_finding():
    ls, lm = _loaders({}, {"vic_auctions": {"frequency": "weekly", "status": "failed"}})
    out = findings.build_findings(ls, lm)
    assert out["auctions"] == "No recent data — source currently unavailable"


def test_fmt_value_units():
    assert findings.fmt_value(3.85, "percent") == "3.85%"
    assert findings.fmt_value(4400, "dwellings") == "4,400"
    assert findings.fmt_value(183.4, "index") == "183.4"
    assert findings.fmt_value(820000, "aud") == "$820,000"


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
