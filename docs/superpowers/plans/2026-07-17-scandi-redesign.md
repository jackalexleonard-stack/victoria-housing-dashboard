# Scandinavian Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the dashboard to the approved cream Scandinavian identity (spec: `docs/superpowers/specs/2026-07-17-scandi-redesign-design.md`) — palette, Inter, Material icons, chip badges, Economist-style charts — without touching any data/scoring logic.

**Architecture:** One new pure module `app/theme.py` holds every design token (palette, colorway, icon maps, chip styles), the Plotly `scandi_cream` template, and the injected CSS string — all unit-testable without Streamlit. `app/streamlit_app.py` consumes it: injects CSS once, registers the template once, swaps emoji for Material icons, and reworks `badge()` into tint chips. `.streamlit/config.toml` gains the `[theme]` block.

**Tech Stack:** Streamlit 1.40.1 (pinned — CSS `data-testid` selectors are version-locked), Plotly 5.24.1, Google Fonts (Inter + Material Symbols Rounded), pytest.

## Global Constraints

- Hexes verbatim from the spec: bg `#FAF7EF`, bg2 `#F2F0E5`, card `#FFFEFA`, hairline `#E6E4D9`, strong line `#DAD8CE`, ink `#1C1B1A`, muted `#575653`, faint `#6F6E69`, blue `#205EA6`, clay `#BC5215`, up `#00824D`, down `#AF3029`, warn `#AD8301`, chip tints `#DDF7CE`/`#FFE0E0`/`#FFEECC`, zeroline `#B7B5AC`.
- Chart colorway exactly `["#205EA6","#BC5215","#24837B","#66800B","#5E409D","#878580"]`.
- Font weights 400/500/600 only. Tabular numerals on KPI values. Sentence case; ALL-CAPS only for 12px eyebrow labels.
- No emoji anywhere in-page after Task 4 (browser favicon 🏘️ may stay). No `box-shadow` on cards/tiles.
- No new pip dependencies. All 69 existing tests must stay green after every task.
- `app/scoring.py` and everything under `pipeline/` must NOT be modified.
- Windows venv: run everything via `.venv\Scripts\python.exe` with `$env:PYTHONUTF8=1`.

---

### Task 1: `app/theme.py` — design tokens (palette, colorway, icons, chips)

**Files:**
- Create: `app/theme.py`
- Test: `tests/test_theme.py`

**Interfaces:**
- Produces: `PALETTE: dict[str,str]` (keys: bg, bg2, card, line, line2, ink, muted, faint, blue, clay, up, down, warn, chip_up, chip_down, chip_warn, zeroline), `COLORWAY: list[str]`, `TAB_ICONS: dict[str,str]`, `TAG_ICON: dict[str,str]`, `PLOTLY_CONFIG: dict`, `chip(text: str, kind: str) -> str` (kind ∈ {"good","warn","bad"}; returns an HTML `<span>`).

- [ ] **Step 1: Write the failing tests**

```python
# tests/test_theme.py
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_theme.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'app.theme'` (or ImportError).

- [ ] **Step 3: Write the implementation**

```python
# app/theme.py
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_theme.py -q`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add app/theme.py tests/test_theme.py
git commit -m "feat(theme): Scandi design tokens — palette, colorway, icons, chips"
```

---

### Task 2: `app/theme.py` — Plotly template + injected CSS

**Files:**
- Modify: `app/theme.py` (append)
- Test: `tests/test_theme.py` (append)

**Interfaces:**
- Consumes: `PALETTE`, `COLORWAY`, `FONT_STACK` from Task 1.
- Produces: `register_template() -> None` (registers `scandi_cream`, sets `pio.templates.default = "simple_white+scandi_cream"`), `CSS: str` (a complete `<style>…</style>` block).

- [ ] **Step 1: Write the failing tests (append to tests/test_theme.py)**

```python
import plotly.io as pio


def test_register_template_wires_scandi_cream():
    theme.register_template()
    assert "scandi_cream" in pio.templates
    assert pio.templates.default == "simple_white+scandi_cream"
    lay = pio.templates["scandi_cream"].layout
    assert list(lay.colorway) == theme.COLORWAY
    assert lay.paper_bgcolor == "rgba(0,0,0,0)" and lay.plot_bgcolor == "rgba(0,0,0,0)"
    assert lay.yaxis.gridcolor == "#E6E4D9" and lay.yaxis.showline is False
    assert lay.xaxis.showgrid is False and lay.xaxis.linecolor == "#1C1B1A"
    assert lay.font.family == theme.FONT_STACK and lay.font.size == 13
    assert lay.hoverlabel.bgcolor == "#FFFEFA"


def test_css_carries_the_load_bearing_rules():
    css = theme.CSS
    assert css.startswith("<style>") and css.endswith("</style>")
    assert "fonts.googleapis.com/css2?family=Inter" in css
    assert "Material+Symbols+Rounded" in css
    assert "'tnum'" in css                                # tabular numerals on KPIs
    assert "uppercase" in css and "0.06em" in css         # eyebrow metric labels
    assert "#FFFEFA" in css and "#E6E4D9" in css          # card surface + hairline
    assert "box-shadow:none" in css.replace(" ", "")
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `.venv\Scripts\python.exe -m pytest tests/test_theme.py -q`
Expected: 2 new FAILs (`AttributeError: ... no attribute 'register_template'`), 6 pass.

- [ ] **Step 3: Append the implementation to app/theme.py**

```python
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `.venv\Scripts\python.exe -m pytest tests/test_theme.py -q`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add app/theme.py tests/test_theme.py
git commit -m "feat(theme): scandi_cream Plotly template + injected CSS block"
```

---

### Task 3: config.toml theme + app wiring (CSS, template, chart config)

**Files:**
- Modify: `.streamlit/config.toml`
- Modify: `app/streamlit_app.py` (imports block; the two lines after `st.set_page_config`; `line_block`; `bar_latest_block`)

**Interfaces:**
- Consumes: `theme.CSS`, `theme.register_template()`, `theme.PLOTLY_CONFIG` (Task 1-2).
- Produces: every `st.plotly_chart` call renders with the template + hidden modebar; single-series charts have no legend.

- [ ] **Step 1: Add the `[theme]` block to `.streamlit/config.toml`** (keep existing sections)

```toml
[theme]
base = "light"
primaryColor = "#205EA6"
backgroundColor = "#FAF7EF"
secondaryBackgroundColor = "#F2F0E5"
textColor = "#1C1B1A"
```

- [ ] **Step 2: Wire theme into the app.** In `app/streamlit_app.py`, extend the scoring import to also import theme:

```python
try:  # pytest imports the package; `streamlit run` has app/ on sys.path
    from app import scoring, theme
except ImportError:  # pragma: no cover
    import scoring
    import theme
```

Immediately AFTER the `st.set_page_config(...)` line add:

```python
theme.register_template()
st.markdown(theme.CSS, unsafe_allow_html=True)
```

- [ ] **Step 3: Chart blocks use the template.** In `line_block`, replace the `fig.update_layout(...)` call with (template now owns legend/margins; legend only when multi-series):

```python
    fig.update_layout(height=320, hovermode="x unified",
                      showlegend=df["series"].nunique() > 1)
```

and change its `st.plotly_chart` line to:

```python
    st.plotly_chart(fig, use_container_width=True, key=f"{series_id}-{title}",
                    config=theme.PLOTLY_CONFIG)
```

In `bar_latest_block`, replace `fig.update_layout(height=300, margin=dict(l=0, r=0, t=6, b=0))` with:

```python
    fig.update_layout(height=300, showlegend=False, bargap=0.35)
```

and add `config=theme.PLOTLY_CONFIG` to its `st.plotly_chart` call the same way.

- [ ] **Step 4: Verify — tests + headless smoke + eyes on it**

Run: `.venv\Scripts\python.exe -m pytest -q` → Expected: 77 passed (69 + 8).
Run this AppTest smoke check:

```python
# scratch (not committed): verify the app still renders end-to-end
from streamlit.testing.v1 import AppTest
at = AppTest.from_file("app/streamlit_app.py", default_timeout=60)
at.run()
assert not at.exception, at.exception
print("smoke OK")
```

Then restart the `dashboard` preview and confirm visually: cream page background, Inter rendering, charts transparent with horizontal-only gridlines and no modebar.

- [ ] **Step 5: Commit**

```bash
git add .streamlit/config.toml app/streamlit_app.py
git commit -m "feat(app): cream theme config + CSS/template wiring into charts"
```

---

### Task 4: Emoji purge — Material icons in title/tabs/cards, chip badges

**Files:**
- Modify: `app/streamlit_app.py` (title; tabs; section headings; `TAG_EMOJI`→`theme.TAG_ICON`; `news_card` placeholder; `badge()`)

**Interfaces:**
- Consumes: `theme.TAB_ICONS`, `theme.TAG_ICON`, `theme.chip`, `theme.PALETTE`.
- Produces: zero emoji rendered in-page; `badge()` renders chips for ageing/stale/failed.

- [ ] **Step 1: Title.** Replace `st.title("🏘️ Victorian Housing Dashboard")` with:

```python
st.title(":material/home_work: Victorian Housing Dashboard")
```

(`st.set_page_config` keeps `page_icon="🏘️"` — favicon only, allowed by spec.)

- [ ] **Step 2: Tabs.** Replace the `st.tabs([...])` list with:

```python
tab_today, tab_vic, tab_nat, tab_intl, tab_news = st.tabs(
    [f":material/{theme.TAB_ICONS[n]}: {n}"
     for n in ("Today", "Victoria", "National", "International", "News")]
)
```

- [ ] **Step 3: Section headings.** Remove the emoji from the two Today-tab headings: `"#### 📊 What's new in the data"` → `"#### What's new in the data"`, `"#### 📰 Top stories"` → `"#### Top stories"`.

- [ ] **Step 4: News-card placeholder.** Delete the `TAG_EMOJI` dict from `app/streamlit_app.py`. In `news_card`, replace the emoji placeholder markdown with:

```python
            tag = (item.get("tags") or ["international"])[0]  # sorted -> deterministic
            icon = theme.TAG_ICON.get(tag, "newspaper")
            st.markdown(
                "<div style='text-align:center;height:110px;line-height:110px;"
                f"background:{theme.PALETTE['bg2']};border-radius:8px'>"
                f"<span class='material-symbols-rounded' style='font-size:44px;"
                f"line-height:110px'>{icon}</span></div>",
                unsafe_allow_html=True,
            )
```

- [ ] **Step 5: Chip badges.** Rewrite `badge()` — same signature, no dot emoji, chips only when attention is needed:

```python
def badge(series_id: str) -> None:
    """Staleness caption: plain text when fresh; a tint chip when ageing,
    stale, or failed (spec: encode status with quiet chips, not dots)."""
    meta = load_meta(series_id)
    if not meta:
        st.caption("no metadata")
        return
    freq = meta.get("frequency", "monthly")
    status = meta.get("status", "ok")
    last_data = meta.get("last_data_date")
    lead, note = "", ""
    if last_data:
        gap = (pd.Timestamp.utcnow().tz_localize(None) - pd.Timestamp(last_data)).days
        cad = NORMAL_CADENCE.get(freq, 31)
        period = _fmt_period(pd.Timestamp(last_data), freq)
        if status == "failed":
            lead = theme.chip(f"Data to {period} · source unavailable", "bad")
        elif gap > 2.5 * cad:
            lead = theme.chip(f"Data to {period} · stale", "bad")
        elif gap > 1.5 * cad:
            lead = theme.chip(f"Data to {period} · ageing", "warn")
        else:
            lead = f"Data to {period}"
    else:
        lead = theme.chip("no data · source unavailable", "bad") if status == "failed" \
            else "no data"
    if status == "failed" and meta.get("error"):
        note = f" · {meta.get('error', '')[:60]}"
    nxt = _next_release(last_data, freq)
    url = meta.get("source_url", "")
    src = f" · <a href='{url}'>{meta.get('source_name', 'source')}</a>" if url else ""
    st.markdown(
        f"<div style='font-size:12px;color:{theme.PALETTE['faint']};margin:-6px 0 4px'>"
        f"{lead} · fetched {_ago(meta.get('last_fetched'))}{note}{nxt}{src}</div>",
        unsafe_allow_html=True,
    )
```

- [ ] **Step 6: Verify.** Run `.venv\Scripts\python.exe -m pytest -q` → 77 passed. Grep the app for leftover emoji: `Select-String -Path app/streamlit_app.py -Pattern "[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]"` should match ONLY the `page_icon="🏘️"` line. Reload the preview: title icon renders as a house glyph (if `home_work` renders as literal text, substitute `:material/home:`), tab icons render, placeholder icons render, badges show chips (vic_rents/vic_vacancy should show the red "stale" chip today; auctions/median show "source unavailable").

- [ ] **Step 7: Commit**

```bash
git add app/streamlit_app.py
git commit -m "feat(app): Material icons + chip badges replace all emoji"
```

---

### Task 5: Spacing polish — remove redundant dividers

**Files:**
- Modify: `app/streamlit_app.py` (three `st.divider()` calls; hero caption position)

**Interfaces:** none new — CSS `h4 { margin-top:2rem }` from Task 2 supplies the spacing that the dividers used to.

- [ ] **Step 1:** Delete the `st.divider()` line that sits between `render_hero(...)` and `st.tabs(...)`. Delete the `st.divider()` after the digest render in the Today tab. Delete the `st.divider()` after the News-tab hero row (keep the hero row's trailing blank spacing — the following caption + list separate naturally).

- [ ] **Step 2:** Run `.venv\Scripts\python.exe -m pytest -q` → 77 passed. Reload preview; confirm sections still separate cleanly by whitespace (no cramped seams between hero/tabs/sections).

- [ ] **Step 3: Commit**

```bash
git add app/streamlit_app.py
git commit -m "style(app): whitespace over dividers per Scandi spacing rules"
```

---

### Task 6: Full verification pass

**Files:** none modified (fixes only if something fails).

- [ ] **Step 1:** `.venv\Scripts\python.exe -m pytest -q` → 77 passed.
- [ ] **Step 2:** AppTest smoke (same scratch script as Task 3 Step 4) → "smoke OK".
- [ ] **Step 3:** Restart the `dashboard` preview. Per-tab visual check against the spec: Today (cream, tiles bordered `#E6E4D9` on `#FFFEFA`, uppercase eyebrows, tnum values), Victoria/National/International (charts: colorway order blue→clay→teal…, horizontal-only grids, dark x-baseline, no modebar, legends only on multi-series), News (thumbnail cards with icon placeholders, chip badges, hover-blue headlines).
- [ ] **Step 4:** Screenshot Today + Victoria + News tabs as proof.
- [ ] **Step 5:** Commit anything fixed during the pass with message `fix(app): visual-pass corrections against Scandi spec`.

---

### Task 7: Adversarial design-review workflow (user-requested check)

**Files:** none directly — findings drive fixes to `app/theme.py` / `app/streamlit_app.py` / `.streamlit/config.toml`.

- [ ] **Step 1:** Run a Workflow with 4 reviewer agents in parallel, each auditing the implemented files (`app/theme.py`, `app/streamlit_app.py`, `.streamlit/config.toml`) against the spec (`docs/superpowers/specs/2026-07-17-scandi-redesign-design.md`), one lens each: (a) palette fidelity + WCAG arithmetic (recompute contrast ratios for every fg/bg pair actually used), (b) typography rules (weights ≤600, tnum coverage, scale, sentence case), (c) icons + components (no emoji, correct Material names, chips not dots, borders/radii/no-shadow), (d) chart doctrine (template values, gridlines, legend policy, modebar). Each agent returns findings with file/line + severity via a structured schema; a final verify stage adversarially re-checks each finding (kill false positives).
- [ ] **Step 2:** Fix every CONFIRMED finding; re-run the failed lens until clean.
- [ ] **Step 3:** Run `.venv\Scripts\python.exe -m pytest -q` → 77 passed.
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "fix(design): resolve confirmed findings from adversarial design review"
```

---

## Self-review notes

- Spec coverage: palette→T1/T3, typography→T2 CSS, icons→T4, chips→T1/T4, charts→T2/T3, components/spacing→T2/T4/T5, verification→T6/T7. Favicon exception documented in T4. No gaps found.
- Type consistency: `theme.chip(text, kind)` used identically in T1 tests and T4 `badge()`; `PLOTLY_CONFIG` consumed in T3 both blocks; icon dicts consumed in T4 only.
- Known risk (explicit): `st.title`/`st.tabs` Material-icon rendering on 1.40 — T4 Step 6 carries the observable check + fallback (`:material/home:` / plain labels).
