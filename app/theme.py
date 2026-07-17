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
