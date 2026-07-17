# Scandinavian identity redesign — design spec

**Date:** 2026-07-17 · **Status:** approved by user (direction + decisions below)

## Context

The dashboard is feature-complete (20 series, Today landing page, rotating hero, News story
cards) but visually stock: default Streamlit theme, emoji icons, default Plotly colours. The
user wants an overall identity change grounded in Scandinavian design philosophy — simplicity,
functionality, user-centric utility — with **cream as the base colour** and grown-up icons,
producing something genuinely cool to look at.

Design tokens below were synthesized by a 5-agent web-research workflow from primary sources:
Norway's Designsystemet, NAV Aksel, Nord (Nordhealth, FI), Statistics Norway, Bang & Olufsen's
production CSS, the Flexoki ink-on-paper palette, and Economist/FT chart doctrine. Every colour
is WCAG-checked against the cream base; every icon name verified against Streamlit's Material
allowlist.

## Locked decisions (user-confirmed)

1. **Thumbnails stay** on the top-story cards (user feature from 2026-07-17), restyled Scandi:
   flat, 1px hairline border, 8px radius; emoji placeholders become a quiet Material icon on a
   cream tint. The flat news list below stays text-only rows.
2. **Light/cream locked** — `base="light"` in config; no dark variant. One committed identity.
3. Philosophy: *lagom*. No shadows anywhere (hairlines + tint shifts separate surfaces). No
   emoji anywhere. Hierarchy via size/weight/gray-tier only.

## Tokens

### Palette (Flexoki-derived, warm)

| Role | Hex | Notes |
|---|---|---|
| Page background | `#FAF7EF` | cream paper |
| Secondary background | `#F2F0E5` | widget/secondary surfaces |
| Card surface | `#FFFEFA` | hero tiles, cards |
| Hairline border | `#E6E4D9` | 1px everywhere |
| Strong border | `#DAD8CE` | tab rule, hover |
| Ink (text) | `#1C1B1A` | 16.06:1 on cream (AAA); never pure #000 |
| Muted text | `#575653` | 6.86:1 — safe on all surfaces; use for all muted text on `#F2F0E5` |
| Faint text | `#6F6E69` | 12px captions/axis on base cream ONLY (fails AA on `#F2F0E5`) |
| Primary accent | `#205EA6` | blue — the only muted Scandi accent passing AA as text (6.1:1); Streamlit `primaryColor` |
| Secondary accent | `#BC5215` | clay — charts + rare emphasis |
| Delta positive | `#00824D` | render at weight 500/600; chip tint `#DDF7CE` |
| Delta negative | `#AF3029` | chip tint `#FFE0E0` |
| Warning/stale | `#AD8301` | badge/chart only, never body text; chip tint `#FFEECC` |

`config.toml [theme]`: `base="light"`, `primaryColor="#205EA6"`, `backgroundColor="#FAF7EF"`,
`secondaryBackgroundColor="#F2F0E5"`, `textColor="#1C1B1A"`.

### Typography

- **Inter** (Google Fonts, weights 400/500/600 — never 700). Provenance: Designsystemet.no
  standardises Inter 400/500/600. Stack: `'Inter','Helvetica Neue',Arial,sans-serif`.
- On Streamlit 1.40: CSS `@import` + `font-family` override via injected `<style>`.
- Scale: 12px captions/axis · 13-14px body · 16px/600 section headers · 28px/600 page title ·
  ~34px/600 KPI values with `letter-spacing:-0.01em`.
- `font-feature-settings:'tnum' 1` on KPI values, deltas, table cells, and Plotly fonts —
  highest-leverage single rule for a data product.
- Sentence case everywhere; ALL-CAPS only for 11-12px eyebrow labels at `+0.06em` in `#575653`.
- Line heights 1.3 headings / 1.5 body.

### Icons (Material Symbols via Streamlit-native `:material/name:`)

Outline style, ink-coloured, one size per context (18-20px inline, 24px page title). All emoji
removed — tabs, tag placeholders, staleness dots, page title.

| Concept | Icon |
|---|---|
| Today | `:material/today:` |
| Victoria | `:material/location_city:` |
| National | `:material/map:` |
| International | `:material/public:` |
| News | `:material/newspaper:` |
| prices | `:material/trending_up:` |
| rents | `:material/key:` |
| supply_construction | `:material/construction:` |
| policy | `:material/account_balance:` |
| construction_costs | `:material/receipt_long:` |
| international (tag) | `:material/public:` |
| staleness | `:material/schedule:` in chip |

Avoid `:material/policy:` (reads as a privacy shield). Implementation note: verify `st.tabs`
label icon rendering on 1.40; fallback is text-only tab labels (acceptable — restraint).
Browser favicon may remain an emoji (`st.set_page_config page_icon`) if Material isn't
supported there on 1.40; no in-page emoji regardless.

### Charts (Plotly template `scandi_cream`, registered once, default = `simple_white+scandi_cream`)

- Colorway `["#205EA6","#BC5215","#24837B","#66800B","#5E409D","#878580"]` — Flexoki 600s, all
  ≥3:1 on cream. `#878580` is reserved for context/"Other" series. Max 4 coloured series.
- `paper_bgcolor`/`plot_bgcolor` transparent — charts sit in the page.
- Gridlines: horizontal only (`yaxis showgrid`, `xaxis showgrid=False`), `#E6E4D9`, width 1.
- X-axis: visible dark baseline (`linecolor #1C1B1A`, width 1.25, ticks outside). Y-axis: no
  line, no ticks; zeroline `#B7B5AC` only when data spans 0. No rotated y-titles — units live
  in the chart's markdown subtitle.
- Font: Inter 13 `#1C1B1A`; ticks 12 `#575653`. Line width 2.25. Bars borderless, bargap ~0.35.
- Hover: `bgcolor #FFFEFA`, border `#DAD8CE`, Inter.
- Margins `t24 r8 b40 l48`. `displayModeBar=False` on every chart.
- Legends: `showlegend=False` for single-series; multi-series keep a horizontal legend above
  the plot (12px `#575653`) — accepted deviation from strict direct-labelling (Plotly
  annotation-per-line-end is brittle across our 20+ charts).
- Future (maps/heat): diverging `#AF3029→#DAD8CE→#205EA6`; sequential SSB teal ramp.

### Components

- **Hero/What's-new tiles:** `#FFFEFA`, 1px `#E6E4D9`, 8px radius, 16-20px padding; 12px/500
  uppercase eyebrow label `#575653`; ~34px/600 value with tnum; 13px/500 delta coloured by
  *meaning* (Streamlit `delta_color` semantics already encode this per metric).
- **Cards:** flat only; `box-shadow:none` globally (overlay shadows stay for dropdowns).
- **Tabs:** transparent list, 1px `#DAD8CE` bottom rule; inactive 14px/400 `#575653`; active
  14px/500 `#1C1B1A` with 2px `#205EA6` underline (Streamlit's active-tab indicator recoloured
  via `primaryColor` + CSS).
- **Chips (staleness/status):** pale tint bg + dark text, radius 999px, padding 2px 10px,
  12px/500. Green/amber/red dots in `badge()` become: fresh → plain caption; ageing → `#FFEECC`/
  `#AD8301` chip; stale/failed → `#FFE0E0`/`#AF3029` chip.
- **News:** top-story cards keep thumbnails (decision 1); placeholder = category Material icon
  centred on `#F2F0E5` tint, 8px radius. Flat list below: 1px `#E6E4D9` dividers, headline
  14px/500 ink (hover `#205EA6`), meta 12px `#6F6E69`.
- **Spacing:** 4/8/16/24/32/48 scale; 24px between cards, 48px between sections; delete
  `st.divider` wherever a spacing step replaces it.
- **Chrome:** hide Streamlit header decoration/footer via CSS.

## Implementation surface

1. `.streamlit/config.toml` — `[theme]` block (values above).
2. `app/streamlit_app.py` — one injected `<style>` block (Inter import; tnum; tile/tab/chip/
   news polish via `data-testid` selectors — version-brittle but Streamlit is pinned 1.40.1);
   Material icon strings replace emoji in tabs/titles/cards; `badge()` reworked to chips;
   `TAG_EMOJI` → `TAG_ICON` (Material names).
3. New `app/theme.py` (pure): palette constants + the Plotly `scandi_cream` template + a
   `plotly_config` dict — imported by the app; keeps styling testable and in one place.
4. `app/scoring.py` — no changes (logic untouched).

## Out of scope

Dark variant; sidebar styling (no sidebar exists); direct labelling of every multi-series
chart; restyling the GitHub Actions/README.

## Verification

1. `pytest -q` — all 69 existing tests stay green (styling must not touch logic); a light
   AppTest smoke run confirms the app still renders exception-free.
2. Visual pass per tab against this spec (cream base, Inter, icons, chips, chart template).
3. **Adversarial design-review workflow** (user-requested): parallel reviewer agents audit the
   implemented code + screenshots against this spec's token tables (palette fidelity, contrast,
   typography rules, icon usage, chart doctrine, spacing/no-shadow/no-emoji rules) and file
   confirmed violations; fix and re-run until clean.

## References

Flexoki (stephango.com/flexoki) · Nord Design System (nordhealth.design) · Designsystemet.no
typography · Aksel/NAV design tokens · Statistics Norway component library · Bang & Olufsen
(live cream CSS) · The Economist chart style guide (2017) · FT g-chartcolour.
