from pathlib import Path

from pipeline import common

FIX = Path(__file__).parent / "fixtures"


def test_rogs_parses_the_fixture_into_tidy_rows_with_the_expected_regions():
    from pipeline.sources.rogs import parse_rogs_csv

    raw = (FIX / "rogs_housing.csv").read_text(encoding="utf-8")
    df = parse_rogs_csv(raw)

    # Schema is fixed law for every series in this repo.
    assert list(df.columns) == ["date", "region", "metric", "value", "unit"]
    # (1) The regions this source is being added FOR — the whole point of the task.
    assert set(df["region"]) == {"vic", "australia"}
    # (2) Metrics are the ones the chart will plot, nothing stray.
    assert set(df["metric"]) == {"social_dwellings_public", "social_waitlist_public"}
    # (3) Spot values hand-verified against the fixture (rogs_housing.csv), so
    #     the test would fail if the parser mis-maps a column or an axis.
    #     Table 18A.3, "Public housing" / "Dwellings; at 30 June", Year 2025:
    #     Vic=64277, Aust=296541.
    row = df[(df.region == "vic") & (df.date == "2025-06-30")
             & (df.metric == "social_dwellings_public")]
    assert len(row) == 1 and row.iloc[0]["value"] == 64277

    row2 = df[(df.region == "australia") & (df.date == "2025-06-30")
              & (df.metric == "social_dwellings_public")]
    assert len(row2) == 1 and row2.iloc[0]["value"] == 296541

    # Table 18A.5, "Applicants on waitlist at 30 June" / "Total (excluding
    # applicants for transfer)", Year 2025: Vic=56230, Aust=189536.
    row3 = df[(df.region == "vic") & (df.date == "2025-06-30")
              & (df.metric == "social_waitlist_public")]
    assert len(row3) == 1 and row3.iloc[0]["value"] == 56230

    assert df["value"].notna().all()
    assert not df.duplicated(["date", "region", "metric"]).any()


def test_rogs_series_metadata_is_annual():
    from pipeline.sources.rogs import SERIES

    assert len(SERIES) == 1
    s = SERIES[0]
    assert s.id == "au_social_housing"
    assert s.frequency == "annual"


def test_rogs_skips_placeholder_tokens_and_keeps_units():
    from pipeline.sources.rogs import parse_rogs_csv

    raw = (FIX / "rogs_housing.csv").read_text(encoding="utf-8")
    df = parse_rogs_csv(raw)

    common.validate_tidy(df)
    units = df.drop_duplicates("metric").set_index("metric")["unit"]
    assert units["social_dwellings_public"] == "dwellings"
    assert units["social_waitlist_public"] == "applicants"
