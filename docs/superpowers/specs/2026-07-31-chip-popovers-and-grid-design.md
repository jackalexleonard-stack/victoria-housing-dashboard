# Honest staleness tags + explainer popovers, and a height-aware grid

**Date:** 2026-07-31 · **Status:** approved-pending-review
**Origin:** user feedback with screenshots — (1) "source unavailable" chips on charts
visibly full of data; (2) grid voids/misalignment (stat tile beside tall chart,
orphaned cards in "Wider context" bands, double-panel mortgage card dwarfing its
row-mate).

Verified context (2026-07-31): DFFH/Homes Victoria genuinely has not published a
rental report newer than Sep qtr 2025 (live index + data.vic CKAN both confirm), so
the rent/vacancy/waitlist family is ~2 releases behind through no fault of the
pipeline; additionally dffh.vic.gov.au / homes.vic.gov.au time out for GitHub
runners (daily cron logs `ReadTimeout`), so refreshes happen from local runs.

---

## Part 1 — Staleness taxonomy and clickable explainer popovers

### 1.1 New taxonomy (`web/src/lib/staleness.ts`)

The fetch-status branch no longer affects labelling when data exists. For a series
**with data**, the tag is a pure function of data age vs `cadence_days`:

| condition | kind | label | style |
|---|---|---|---|
| gap ≤ 1.5× cadence | `fresh` | `Data to {period}` | plain text, inert |
| gap > 1.5× cadence | `ageing` | `Data to {period} · ageing` | amber chip |
| gap > 2.5× cadence | `stale` | `Data to {period} · stale` | red chip |

`kind: 'failed'` → **only** when the series has no data at all:
`No data · source unavailable` (red). This is the compact outage-row case
(auctions, REIV) and nothing else.

Consequences that fall out automatically:
- Masthead `failedSources` (filters `kind === 'failed'`) shrinks to genuinely dead
  sources. Wording stays "N sources unavailable" — now honest.
- The DFFH family reads `Data to Sep qtr 2025 · stale` (gap ≈ 3.3× quarterly).

`nextUpdate()` gains an overdue form: when the estimate is in the past, consumers
render "next update was due ~{period}" instead of "next update ~{period}".

### 1.2 Quiet pill + section banner (`ChartCard.tsx`, `lib/sections.ts`, `App.tsx`)

- `quietOutage` per-card pill changes from `{period} · unavailable` to
  `{period} · {kind word}` (e.g. `Sep qtr 2025 · stale`), still the quiet warn
  style, now clickable (§1.3).
- `sectionOutageNotice` trigger logic unchanged (every distinct series stale or
  failed + one shared source_url + one vintage). Banner text reworded:
  `{token} — awaiting new release · data to {period}`, and the banner becomes a
  button opening the same popover (fed by the notice's primary series entry).

### 1.3 Clickable chips → explainer popover

Every non-fresh status chip becomes a keyboard-operable `<button>` opening a small
popover. Fresh plain-text labels stay inert. Scope: **ChartCard caption rows, the
compact outage rows, DetailView's caption row, and the section banner.** Hero tiles
and World KPI tiles keep their existing inert vintage badges — their whole surface
is already a button opening the detail modal (nesting a second button is an a11y
fault), and the modal carries the clickable chip.

Structural note: the compact outage row currently nests `statusChip` inside the
row's own `<button>` — restructure to a flex row where title+body remain the
open-details button and the chip is a sibling button.

**Component:** extract the Masthead disclosure's open/close mechanics
(aria-expanded, aria-haspopup, Escape, outside-click, focus return) into a shared
`components/Popover.tsx`; Masthead, chips, and the banner all use it. Panel is
absolutely positioned, `max-w` bounded, side-switches near the viewport edge
(reuse the measured-clamp approach from the 2.2 tooltips). ≥44px effective target
on coarse pointers (existing pattern). Chip buttons get a hover ring/cursor and
`aria-label="{label} — why?"`.

**Popover content, top to bottom:**
1. Title by kind — "Ageing data" / "Stale data" / "Source unavailable".
2. One-sentence meaning, e.g. stale: "Well past this series' expected release
   date." (exact copy in implementation, kept short)
3. Vintage line: `Latest data: {period} · published {frequency}` plus, when
   `releasesBehind ≥ 1`, `· ~{n} release(s) behind`.
   `releasesBehind = max(0, floor(gapDays / cadence_days) − 1)` — the −1 grants
   one cadence of normal publication lag; **computed, never hardcoded**, so the
   DFFH copy stays true as the publisher falls further behind.
4. Cause — curated `status_note` from the pipeline when present (§1.4), else an
   honest generated fallback:
   - status `failed`: "The source hasn't responded to the daily updater. Last
     attempt: {last_fetched}."
   - status `ok`: "The publisher hasn't released newer figures yet."
5. `nextUpdate()` line (overdue form when past, §1.1).

### 1.4 Pipeline: curated per-source notes

- New module-level dict (in `pipeline/export.py` or a small `status_notes.py`)
  keyed by series_id. Initial entries:
  - `vic_rents`, `vic_vacancy` (and `vic_social_waitlist`, homes.vic-worded):
    Homes Victoria hasn't published newer editions — publisher behind its own
    schedule; the site also blocks automated fetchers, so this data refreshes
    from a manual run once a new report appears. (Qualitative only — the
    quantitative "n releases behind" is computed client-side, §1.3.)
  - `vic_auctions`, `vic_median_price`: move the existing frontend
    `DEAD_CARD_BODY` copy here — single source of truth; ChartCard's dict and
    fallback string are deleted and the dead-row body renders
    `status_note ?? generated fallback`.
- `META_KEYS` gains `status_note`; `_series_entry` passes it through;
  `validate_site` accepts optional string; site fixtures updated.

---

## Part 2 — Height-aware, order-preserving grid

### 2.1 Height classes (`web/src/lib/rows.ts`, pure + unit-tested)

`heightClassFor(site, chart, range, geo) → 'tile' | 'tall' | 'standard'`, reusing
the same pure selector logic ChartCard uses today:
- `tile` — the stat-tile condition (every visible line < 2 points; range/geo
  dependent, same inputs the card renders with).
- `tall` — the double-panel mortgage card (`mortgage_rates`), while it renders
  stacked minis at half width.
- `standard` — everything else. (Dead charts never reach the row builder — they
  keep their existing full-width slim rows at the section's end.)

### 2.2 Row builder

`buildRows(cards, classFn, { leadSpans }) → Row[]`, walking the band **in registry
order** (reading order never changes):
- `leadSpans` (main grid only): first card takes a full-width row, unchanged.
- Two consecutive same-class cards → pair 2-up.
- Class mismatch → current card takes a full-width row (no void).
- Trailing odd card → full-width row — **now in both the main grid and the
  "Wider context" band** (the band's deliberate no-span rule is repealed; its
  tests updated).
- `tall` always takes a full row; when full-width the mortgage card renders its
  New/Outstanding panels **side-by-side** (`sm:` up; stacked on mobile), which
  collapses it to ~standard height. ChartCard gains a `fullWidth` prop for this.
- A lone `tile` spans as a slim full-width row (body stays short and centred).

### 2.3 Equal-height rows

Cards fill their grid cell (`h-full`, flex column); the stat-tile body centres
vertically in the available space. Chart plot heights are unchanged — stretching
only aligns card borders within a row.

Expected results on the reported screenshots: supply section → slim Greenfield
row / full-width input costs / commencements+Accord pair / full-width output
prices; money band → three full-width rows (cash rate / mortgage with
side-by-side panels / credit). No voids anywhere.

---

## Testing

- **vitest:** staleness rewrite (failed-with-data → age-only; failed-no-data
  unchanged; releasesBehind boundaries), sections wording, `rows.ts` builder
  (pair / mismatch-span / tall / trailing / leadSpans; order preservation),
  Popover open/Escape/outside-click/focus-return, ChartCard chip-button +
  restructured outage row, DetailView chip.
- **App tests:** D2e span tests updated to the new band rule; quiet-pill wording;
  banner is a button; masthead count now excludes has-data failures.
- **pytest:** `status_note` passthrough + validation + fixture coverage;
  DEAD_CARD_BODY migration.
- **e2e (Playwright):** tab to a chip → Enter opens popover (text asserted) →
  Escape closes and returns focus; axe clean with a popover open; odd
  context-band card carries the span class; mobile project: mortgage panels
  stacked, popover clamped in-viewport. No pixel snapshots (project policy).

## Non-goals

- No masonry / no uniform fixed card heights (rejected in brainstorm).
- Hero/World tiles' badges stay inert (rationale §1.3).
- No Streamlit changes; no new data sources; no changes to when the section
  banner fires (wording/interaction only).

## Rollout

Feature branch off `main` → subagent-driven TDD per plan → whole-branch review →
merge --no-ff → CI + Pages deploy via update.yml → live verification via run
conclusion (never the local browser pane).
