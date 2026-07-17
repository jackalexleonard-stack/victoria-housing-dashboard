from app import theme
from pipeline.sources import news


def test_palette_matches_spec():
    p = theme.PALETTE
    assert p["bg"] == "#FAF7EF" and p["bg2"] == "#F2F0E5" and p["card"] == "#FFFEFA"
    assert p["line"] == "#E6E4D9" and p["line2"] == "#DAD8CE"
    assert p["ink"] == "#1C1B1A" and p["muted"] == "#575653" and p["faint"] == "#6F6E69"
    assert p["blue"] == "#205EA6" and p["clay"] == "#BC5215"
    assert p["up"] == "#00824D" and p["down"] == "#AF3029" and p["warn"] == "#AD8301"
    assert p["chip_up"] == "#DDF7CE" and p["chip_down"] == "#FFE0E0" and p["chip_warn"] == "#FFEECC"
    assert p["zeroline"] == "#B7B5AC"


def test_colorway_matches_spec():
    assert theme.COLORWAY == ["#205EA6", "#BC5215", "#24837B", "#66800B", "#5E409D", "#878580"]


def test_tag_icons_cover_every_news_tag():
    assert set(theme.TAG_ICON) == set(news.TAG_KEYWORDS)
    assert theme.TAG_ICON["prices"] == "trending_up"
    assert theme.TAG_ICON["policy"] == "account_balance"   # never :material/policy:


def test_tab_icons_named_for_all_tabs():
    assert set(theme.TAB_ICONS) == {"Today", "Victoria", "National", "International", "News"}
    assert theme.TAB_ICONS["News"] == "newspaper"


def test_chip_builds_tinted_pill():
    html = theme.chip("Data to Sep qtr 2025 · stale", "bad")
    assert "#FFE0E0" in html and "#AF3029" in html
    assert "border-radius:999px" in html and "Data to Sep qtr 2025" in html
    warn = theme.chip("ageing", "warn")
    assert "#FFEECC" in warn and "#AD8301" in warn


def test_plotly_config_hides_modebar():
    assert theme.PLOTLY_CONFIG == {"displayModeBar": False}
