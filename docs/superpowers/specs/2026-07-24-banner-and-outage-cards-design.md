# Geo-aware banner + outage-card placement — design

**Date:** 2026-07-24 · **Status:** design approved (user), pending build
**Feedback:** (1) the rotating headline banner should appear for every geography, not just Melbourne;
(2) unavailable-source cards must always sit at the END of a section, never the beginning;
(3) unavailable-source cards should be much smaller so they don't waste page space.

## 1. Geo-aware, always-on headline banner

Today `TodaySection` zeroes the conveyor pool whenever `filtersActive` (range ≠ 5y OR geo ≠
melbourne) — a 2.0-era rule from when findings existed only for the default view. Geo scoping made
findings per-geo (`site.findings[chartId][geo]`), so the guard is obsolete. User decisions: show for
**all geos AND all ranges** (headline sentences quote latest values, which are range-independent);
the value line under each headline is **computed per-geo client-side**.

- `headlinePool(site, geo)` (`web/src/lib/conveyor.ts`): hero-ordered chart keys whose chart has a
  finding for the selected geo — `site.findings[TILE_CHART[key]]?.[geo]` non-empty. `hero_lead`
  stays first when it qualifies. The `filtersActive ? [] : …` guard is deleted; `TodaySection`
  receives `geo` (and drops `filtersActive`).
- Lead/secondary cards resolve their finding at the selected geo. The value/delta line is derived
  client-side from the chart's own series at that geo: latest point (and previous, for the delta) of
  the chart's primary metric, filtered `p.region === geo` — a new pure helper
  `latestForGeo(site, chartKey, geo): { value, delta } | null` in `conveyor.ts`. Formatting reuses
  `TILE_FMT[key]`; delta colour reuses `deltaColor` with the hero registry entry's `delta_color`
  semantics (normal/inverse/off). Delta rule: `latest − previous` of the SAME primary metric at the
  same geo. Some export-side hero tiles pair a level value with a delta from a DIFFERENT metric
  (e.g. an index level + a MoM% metric) — do NOT replicate that per-key logic client-side; where the
  simple same-metric delta would misrepresent the tile's export-side semantics (i.e. `TILE_FMT`'s
  delta formatter expects a different quantity), omit the delta rather than mis-format it. The
  authoritative rule everywhere: when in doubt, OMIT — never show another geo's or another metric's
  number. If the series has no point for that geo at all (belt-and-braces; the pool requires a
  finding), the whole value line is omitted.
- The compact hero-tile STRIP and "changed this week" chips stay default-view (explicitly labelled
  tiles — honest as-is). Out of scope: making the strip geo-aware.
- Rotation mechanics (5 s conveyor, pause/dots, reduced-motion static, MIN_ROTATE fallback) are
  untouched; pool size just varies by geo (regional ≈ 5 today, growing as sources land).

## 2. Failed sources sort last in their section

The grid currently renders in registry order, so a dead card (e.g. Auction clearance) can lead a
section. Change: within each section's grid, order = healthy charts (registry order preserved),
then broken-source charts (registry order preserved among themselves). "Broken" uses the SAME
predicate `geoBands.ts` already uses for the footnote exemption (missing series entry or
`status === 'failed'` with no usable points) — one definition, exported and shared, never two
drifting copies. Consequence: the D2(e) "first card spans full width" lead-card logic naturally
applies to the first HEALTHY chart; the dangling-card logic operates on the healthy sublist only.

## 3. Compact outage cards

`ChartCard`'s `failedEmpty` branch renders a slim, full-width row instead of a full-height card:
chart title + the existing red staleness chip + the one-line honest body (`DEAD_CARD_BODY` /
default), single row on desktop (wrapping on narrow screens), no chart area, no stat block. Still a
button opening the detail modal (which keeps the source link + error provenance). Placement: compact
cards render after the healthy grid, each spanning full width, above the geo footnote. Note: after
geo scoping, `failedEmpty` in the grid can ONLY mean a failed source (geography gaps are hidden by
`bandFor`), so this compaction cannot swallow a healthy-but-filtered chart.

## 4. Testing

- Vitest: `headlinePool(site, geo)` per-geo membership + hero_lead precedence; `latestForGeo` value/
  delta correctness and the no-point omission; banner renders under `geo=regional_vic` with the
  regional finding + regional value (and NOT the Melbourne value — the D1-class regression guard);
  banner visible with a non-default range; grid sort (broken last, healthy registry-order stable);
  compact card renders slim (no chart svg) and stays clickable; full-width-lead applies to the first
  healthy chart.
- E2e: under `?geo=regional_vic`, the banner is present and rotates (clock), and the Prices section
  renders Auction clearance as a compact row at the END of the section.
- Existing conveyor/default-view tests must keep passing (offset 0 on melbourne is unchanged).

## 5. Rejected / out of scope

Geo-aware hero-tile strip and "changed this week" chips (explicitly labelled, honest as-is — YAGNI);
per-geo scoring/reordering of the pool (hero order suffices); removing `filtersActive` from anything
other than the banner path.
