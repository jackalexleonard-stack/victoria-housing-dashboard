import pandas as pd

from pipeline import common


def test_period_end_all_frequencies():
    assert common.period_end("2026-05") == "2026-05-31"
    assert common.period_end("2026-Q1") == "2026-03-31"
    assert common.period_end("2026-Q4") == "2026-12-31"
    assert common.period_end("2026") == "2026-12-31"
    assert common.period_end("2026-07-14") == "2026-07-14"


def _df(rows):
    return pd.DataFrame(rows, columns=common.TIDY_COLUMNS)


def test_write_series_append_and_overwrite(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "SERIES_DIR", tmp_path)

    a = _df([["2026-03-31", "vic", "approvals_total", 100, "dwellings"]])
    assert common.write_series("t", a) is True      # first write
    assert common.write_series("t", a) is False     # identical -> no change

    b = _df([["2026-06-30", "vic", "approvals_total", 110, "dwellings"]])
    assert common.write_series("t", b) is True       # new period appended

    # revision: same key, new value overwrites
    c = _df([["2026-03-31", "vic", "approvals_total", 105, "dwellings"]])
    assert common.write_series("t", c) is True

    out = pd.read_csv(tmp_path / "t.csv")
    assert len(out) == 2
    assert out.loc[out.date == "2026-03-31", "value"].iloc[0] == 105


def test_validate_tidy_rejects_bad_frames():
    import pytest

    good = _df([["2026-03-31", "vic", "m", 1.0, "u"]])
    common.validate_tidy(good)  # no raise

    with pytest.raises(ValueError):
        common.validate_tidy(_df([["2026-03", "vic", "m", 1.0, "u"]]))  # non-ISO date
    with pytest.raises(ValueError):
        common.validate_tidy(_df([["2026-03-31", "", "m", 1.0, "u"]]))  # blank region


def test_update_meta_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr(common, "META_DIR", tmp_path)
    m = common.update_meta(
        "t", source_name="ABS", source_url="http://x", frequency="quarterly",
        status="ok", changed=True, last_data_date="2026-03-31",
    )
    assert m["status"] == "ok"
    assert m["last_changed"] == m["last_fetched"]
    # a later failed run keeps last_data_date and clears nothing important
    m2 = common.update_meta(
        "t", source_name="ABS", source_url="http://x", frequency="quarterly",
        status="failed", error="boom",
    )
    assert m2["status"] == "failed"
    assert m2["error"] == "boom"
    assert m2["last_data_date"] == "2026-03-31"


def test_update_meta_derived_field_is_recorded_and_survives_a_failed_run(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(common, "META_DIR", tmp_path)
    formula = "lending_total = owner_occupier + investor"
    m = common.update_meta(
        "t", source_name="ABS", source_url="http://x", frequency="quarterly",
        status="ok", derived=formula,
    )
    assert m["derived"] == formula
    # a later run that doesn't pass derived (e.g. mark_failed) must not erase it
    m2 = common.update_meta(
        "t", source_name="ABS", source_url="http://x", frequency="quarterly",
        status="failed", error="boom",
    )
    assert m2["derived"] == formula
