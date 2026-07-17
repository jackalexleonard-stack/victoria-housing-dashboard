"""Design tokens for the cream Scandinavian identity (spec 2026-07-17).

Pure module — no streamlit import. Everything visual lives here: palette,
chart colorway, Material icon maps, chip builder, Plotly template and the
injected CSS. Values come verbatim from the approved spec; tests pin them.
"""
from __future__ import annotations

PALETTE = {
    "bg": "#FAF7EF", "bg2": "#F2F0E5", "card": "#FFFEFA",
    "line": "#E6E4D9", "line2": "#DAD8CE",
    "ink": "#1C1B1A", "muted": "#575653", "faint": "#6F6E69",
    "blue": "#205EA6", "clay": "#BC5215",
    "up": "#00824D", "down": "#AF3029", "warn": "#AD8301",
    "chip_up": "#DDF7CE", "chip_down": "#FFE0E0", "chip_warn": "#FFEECC",
    "zeroline": "#B7B5AC",
}

COLORWAY = ["#205EA6", "#BC5215", "#24837B", "#66800B", "#5E409D", "#878580"]

FONT_STACK = "'Inter','Helvetica Neue',Arial,sans-serif"

# Streamlit-native :material/<name>: strings are built from these names.
TAB_ICONS = {
    "Today": "today", "Victoria": "location_city", "National": "map",
    "International": "public", "News": "newspaper",
}
TAG_ICON = {
    "prices": "trending_up", "rents": "key", "supply_construction": "construction",
    "policy": "account_balance", "construction_costs": "receipt_long",
    "international": "public",
}

PLOTLY_CONFIG = {"displayModeBar": False}

_CHIP_STYLES = {
    "good": (PALETTE["chip_up"], PALETTE["up"]),
    "warn": (PALETTE["chip_warn"], PALETTE["warn"]),
    "bad": (PALETTE["chip_down"], PALETTE["down"]),
}


def chip(text: str, kind: str) -> str:
    """A pale-tint status pill (spec: never solid fills, radius 999px)."""
    bg, fg = _CHIP_STYLES[kind]
    return (
        f"<span style=\"background:{bg};color:{fg};border-radius:999px;"
        f"padding:2px 10px;font-size:12px;font-weight:500\">{text}</span>"
    )


def register_template() -> None:
    """Register the scandi_cream Plotly template and make it the default.
    Idempotent — safe to call on every Streamlit rerun."""
    import plotly.graph_objects as go
    import plotly.io as pio

    pio.templates["scandi_cream"] = go.layout.Template(layout=dict(
        colorway=COLORWAY,
        paper_bgcolor="rgba(0,0,0,0)", plot_bgcolor="rgba(0,0,0,0)",
        font=dict(family=FONT_STACK, size=13, color=PALETTE["ink"]),
        hoverlabel=dict(bgcolor=PALETTE["card"], bordercolor=PALETTE["line2"],
                        font=dict(family=FONT_STACK, color=PALETTE["ink"])),
        xaxis=dict(showgrid=False, showline=True, linecolor=PALETTE["ink"],
                   linewidth=1.25, ticks="outside", tickcolor=PALETTE["ink"],
                   tickfont=dict(size=12, color=PALETTE["muted"])),
        yaxis=dict(showgrid=True, gridcolor=PALETTE["line"], gridwidth=1,
                   showline=False, ticks="",
                   tickfont=dict(size=12, color=PALETTE["muted"]),
                   zerolinecolor=PALETTE["zeroline"], zerolinewidth=1),
        legend=dict(orientation="h", yanchor="bottom", y=1.02, x=0,
                    font=dict(size=12, color=PALETTE["muted"])),
        margin=dict(t=24, r=8, b=40, l=48),
    ))
    pio.templates.default = "simple_white+scandi_cream"


CSS = """<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,400,0,0&display=swap');
html, body, [data-testid="stAppViewContainer"] * { font-family:'Inter','Helvetica Neue',Arial,sans-serif; }
.material-symbols-rounded { font-family:'Material Symbols Rounded' !important; font-weight:400;
  font-variation-settings:'FILL' 0,'wght' 400,'GRAD' 0,'opsz' 40; color:#575653; }
h1,h2,h3,h4 { font-weight:600; color:#1C1B1A; }
h4 { margin-top:2rem; }
[data-testid="stMetricValue"] { font-feature-settings:'tnum' 1; font-weight:600;
  letter-spacing:-0.01em; font-size:34px; color:#1C1B1A; }
[data-testid="stMetricLabel"] p { text-transform:uppercase; letter-spacing:0.06em;
  font-size:12px; font-weight:500; color:#575653; }
[data-testid="stMetricDelta"] { font-weight:500; font-feature-settings:'tnum' 1; }
div[data-testid="stVerticalBlockBorderWrapper"] { background:#FFFEFA;
  border:1px solid #E6E4D9 !important; border-radius:8px; box-shadow:none; }
button[data-baseweb="tab"] { color:#575653; font-weight:400; }
button[data-baseweb="tab"][aria-selected="true"] { color:#1C1B1A; font-weight:500; }
div[data-baseweb="tab-border"] { background-color:#DAD8CE; }
div[data-baseweb="tab-highlight"] { background-color:#205EA6; height:2px; }
[data-testid="stCaptionContainer"], [data-testid="stCaptionContainer"] p { color:#6F6E69; }
.stMarkdown a { color:#1C1B1A; text-decoration:none; }
.stMarkdown a:hover { color:#205EA6; }
[data-testid="stImage"] img { border-radius:8px; }
header[data-testid="stHeader"] { background:transparent; }
#MainMenu, footer { visibility:hidden; }
</style>"""
