from pathlib import Path

import pytest

from pipeline import common
from pipeline.sources import sqm

FIX = Path(__file__).parent / "fixtures"


def test_parse_vacancy_offline():
    # Reuses the DFFH Rental Report workbook fixture (Fig 7 = SQM-sourced vacancy).
    raw = (FIX / "dffh_rental_report.xlsx").read_bytes()
    df = sqm.parse_vacancy(raw)

    common.validate_tidy(df)
    assert set(df.region) == {"melbourne", "regional_vic"}
    assert set(df.metric) == {"vacancy_rate"}
    assert (df.unit == "percent").all()

    assert df.date.min() == "1999-09-30"
    assert df.date.max() == "2025-09-30"
    assert (df.date.str.match(r"^\d{4}-\d{2}-\d{2}$")).all()

    latest = df[df.date == "2025-09-30"].set_index("region")["value"]
    assert latest["melbourne"] == pytest.approx(2.51, abs=0.05)
    assert latest["regional_vic"] == pytest.approx(1.87, abs=0.05)

    # Vacancy rates are small positive percentages.
    assert df.value.between(0, 15).all()


def test_missing_sheet_raises():
    import io
    import openpyxl

    wb = openpyxl.Workbook()
    wb.active.title = "Other"
    buf = io.BytesIO()
    wb.save(buf)
    with pytest.raises(ValueError):
        sqm.parse_vacancy(buf.getvalue())
