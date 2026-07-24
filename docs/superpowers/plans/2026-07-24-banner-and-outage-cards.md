# Geo-aware Banner + Outage-card Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The rotating headline banner appears for every geography and range (quoting that geography's own numbers); unavailable-source cards always sit at the end of their section as compact rows.

**Architecture:** `headlinePool` gains a `geo` argument (pool = hero-ordered charts with a finding for that geo); a new pure `latestForGeo` derives the per-geo value/delta line client-side, with a data-driven consistency check that omits the line for tiles whose export-side value isn't the chart's primary-metric level (never mis-format, never show another geo's number). The section grid splits on the existing `isBrokenSource` predicate (exported from `geoBands.ts`): healthy charts keep registry order and the D2(e) span logic; broken-source charts render after them as compact full-width rows (ChartCard auto-compacts when the source is broken).

**Tech Stack:** React 19 + TS, Vitest + Testing Library, Playwright. No pipeline changes — pytest untouched.

**Spec:** `docs/superpowers/specs/2026-07-24-banner-and-outage-cards-design.md` (approved 2026-07-24).

## Global Constraints

- Repo `C:\Users\OEM\Schemes\housing dashboard` (space in path — quote). Branch `feature/banner-and-outage-cards` exists with the spec committed — do NOT create/switch branches.
- Frontend from `web/`: `npm test` (baseline **277 passed, 1 skipped**), `npm run build`, `npm run e2e` (baseline **49 passed, 1 skipped**, both projects; use the existing `gotoDashboard` helper — it seeds the first-run-modal bypass).
- Python untouched: do not run or modify the pipeline (pytest baseline 171 stays as-is).
- **The authoritative honesty rule (spec §1): when in doubt, OMIT — never show another geo's or another metric's number.**
- The compact/last treatment keys on **`isBrokenSource` (source status)**, NOT on "chart is empty at this range" — a healthy chart that happens to be empty in the current range keeps today's behaviour (out of scope).
- The default (melbourne, 5y) view's banner must be byte-identical to today: at the default geo the cards keep using the EXPORT tile values, so every existing default-view test passes unchanged.
- Existing conveyor mechanics (5 s, pause/dots, reduced-motion, MIN_ROTATE) untouched.
- jsdom tests inherit `src/test/setup.ts` (reduced-motion ON ⇒ no auto-rotation in unit tests).
- Commit after every task, trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: Geo-aware pool + per-geo value line (pure lib)

**Files:**
- Modify: `web/src/lib/conveyor.ts` (`headlinePool` signature; new `latestForGeo`)
- Modify: `web/src/lib/geoBands.ts:19-21` (export `isBrokenSource` — Task 3 consumes it)
- Test: `web/src/lib/conveyor.test.ts`

**Interfaces:**
- Consumes: `SiteData` (per-geo findings), `TILE_CHART`.
- Produces (Tasks 2–3 rely on these exact names):
  - `headlinePool(site: SiteData, geo: Geo): string[]`
  - `latestForGeo(site: SiteData, tileKey: string, geo: Geo): { value: number; delta: number | null } | null`
  - `geoBands.ts` exports `isBrokenSource(series: SeriesEntry | undefined): boolean` (same body, now exported).

- [ ] **Step 1.1: Write the failing tests — append to `web/src/lib/conveyor.test.ts`**

The fixture (`site.edge.json`) at this branch has per-geo findings. Check which charts carry a
`regional_vic` finding in the CURRENT fixture before finalising the expected arrays — the tests below
name the shape; pin the exact expected keys from the fixture you actually have (print
`Object.entries(site.findings).filter(([,f]) => 'regional_vic' in f)` in a scratch run first, then
hardcode what you saw). The structure to add:

```ts
describe('headlinePool per geo (2026-07-24 banner batch)', () => {
  test('melbourne pool is unchanged from the legacy default-view pool', () => {
    // Regression pin: pool at the default geo must equal what the old
    // zero-arg headlinePool returned, so the default view cannot shift.
    expect(headlinePool(site, 'melbourne')).toEqual(
      ['melb_rent', 'cash_rate', 'melb_dwelling_values', 'oo_lending', 'mortgage_new'])
  })

  test('a geo pool contains only charts with a finding for THAT geo', () => {
    for (const key of headlinePool(site, 'regional_vic')) {
      const chartId = TILE_CHART[key]
      expect(site.findings[chartId]?.regional_vic, `${key} lacks a regional finding`).toBeTruthy()
    }
  })

  test('a chart without a finding for the geo is excluded', () => {
    // cash_rate's chart has no regional_vic finding in the fixture.
    expect(headlinePool(site, 'regional_vic')).not.toContain('cash_rate')
  })

  test('hero_lead leads only when it qualifies for the geo', () => {
    // Fixture hero_lead = melb_rent -> median_rent, which HAS regional data:
    expect(headlinePool(site, 'regional_vic')[0]).toBe('melb_rent')
  })
})

describe('latestForGeo', () => {
  test('returns the latest value and same-metric delta at the requested geo', () => {
    // Pin real numbers from the fixture's vic_rents series at regional_vic
    // (read them out of site.edge.json by hand — last two median_rent points).
    const r = latestForGeo(site, 'melb_rent', 'regional_vic')
    expect(r).not.toBeNull()
    expect(r!.value).toBe(/* latest regional median_rent from the fixture */ 0)
    expect(r!.delta).toBe(/* latest - previous, same metric same geo */ 0)
  })

  test('never returns another geo\'s number', () => {
    const melb = latestForGeo(site, 'melb_rent', 'melbourne')!
    const reg = latestForGeo(site, 'melb_rent', 'regional_vic')!
    expect(reg.value).not.toBe(melb.value)
  })

  test('returns null when the series has no point for that geo', () => {
    expect(latestForGeo(site, 'cash_rate', 'regional_vic')).toBeNull()
  })

  test('returns delta null (not a wrong number) when only one point exists at the geo', () => {
    // land at regional_vic carries a single snapshot in the fixture -> value
    // present, delta null. If the fixture lacks this shape, build a minimal
    // site object inline instead (assertSiteData not needed for a unit helper).
    const r = latestForGeo(site, 'greenfield_supply', 'regional_vic')
    if (r) expect(r.delta).toBeNull()
  })
})

describe('tileValueMatchesPrimary (the mis-format guard)', () => {
  test('true when the export tile value IS the primary-metric level (melb_rent)', () => {
    expect(tileValueMatchesPrimary(site, 'melb_rent')).toBe(true)
  })
  test('false for MoM-style tiles whose value is a different metric (melb_dwelling_values)', () => {
    // hvi tile value is the MoM %; the chart primary is the index level.
    expect(tileValueMatchesPrimary(site, 'melb_dwelling_values')).toBe(false)
  })
})
```
Replace the two `/* … */ 0` pins with values read from the fixture by hand (shared-template rule:
a spot value the parserless reader can verify). Import `latestForGeo`, `tileValueMatchesPrimary`
alongside the existing imports; import `TILE_CHART` if not already imported in the test file.

- [ ] **Step 1.2: Run to verify failure**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npx vitest run src/lib/conveyor.test.ts
```
Expected: FAIL — `headlinePool` takes one argument; `latestForGeo`/`tileValueMatchesPrimary` missing.

- [ ] **Step 1.3: Implement in `web/src/lib/conveyor.ts`**

Change `headlinePool` (keep the doc comment, amend it):

```ts
// The rotating headline pool, per geography (2026-07-24 banner batch):
// hero_lead first, then the remaining hero picks in exported order, deduped —
// but only keys whose chart carries a finding for the SELECTED geo, so the
// banner quotes that geography's own sentences and never another's.
export function headlinePool(site: SiteData, geo: Geo): string[] {
  const lead = site.hero_lead && site.hero_lead !== 'empty' ? [site.hero_lead] : []
  const seen = new Set<string>()
  const pool: string[] = []
  for (const k of [...lead, ...site.hero.map(t => t.key)]) {
    if (k === 'empty' || seen.has(k)) continue
    seen.add(k)
    const chartId = TILE_CHART[k]
    if (!chartId || !site.findings[chartId]?.[geo]) continue
    if (!site.hero.some(t => t.key === k)) continue
    pool.push(k)
  }
  return pool
}
```
(Import `Geo` from `./urlState`.) The zero-geo `{}` guard collapses into `?.[geo]` naturally.

Add the two helpers:

```ts
// The chart a tile key plots, and that chart's primary metric — the metric
// the banner's value line describes.
function primaryMetricOf(site: SiteData, tileKey: string):
    { chart: SiteData['charts'][number]; metric: string } | null {
  const chartId = TILE_CHART[tileKey]
  const chart = chartId ? site.charts.find(c => c.id === chartId) : undefined
  if (!chart) return null
  const entry = site.series[chart.series_id]
  const metric = chart.metrics?.[0] ?? (entry ? Object.keys(entry.units)[0] : undefined)
  return metric ? { chart, metric } : null
}

// Does the EXPORT tile's value equal the chart's primary-metric level at the
// default view? Some tiles pair a level chart with a rate value (the HVI MoM
// tiles) — for those, formatting a per-geo primary-metric level with the
// tile's formatter would misrepresent it, so the banner omits the line
// instead (spec §1: when in doubt, OMIT). Data-driven — no hand-kept list.
export function tileValueMatchesPrimary(site: SiteData, tileKey: string): boolean {
  const tile = site.hero.find(t => t.key === tileKey)
  const pm = primaryMetricOf(site, tileKey)
  if (!tile || tile.value == null || !pm) return false
  const geo0 = pm.chart.geos[0]
  const latest = latestForGeo(site, tileKey, geo0 as Geo)
  if (!latest) return false
  return Math.abs(latest.value - tile.value) < 1e-6 * Math.max(1, Math.abs(tile.value))
}

// Latest value (and same-metric delta) of the tile's chart primary metric at
// the requested geo. Null when the geo has no points; delta null when only
// one point exists — never another geo's or another metric's number.
export function latestForGeo(site: SiteData, tileKey: string, geo: Geo):
    { value: number; delta: number | null } | null {
  const pm = primaryMetricOf(site, tileKey)
  if (!pm) return null
  const entry = site.series[pm.chart.series_id]
  if (!entry) return null
  const pts = entry.points
    .filter(p => p.region === geo && p.metric === pm.metric && p.value != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length === 0) return null
  const value = pts[pts.length - 1].value
  const delta = pts.length >= 2 ? value - pts[pts.length - 2].value : null
  return { value, delta }
}
```

In `web/src/lib/geoBands.ts`, change `function isBrokenSource` to `export function isBrokenSource`
(body unchanged; extend its comment noting ChartCard/App now share it).

- [ ] **Step 1.4: Fix the two existing `headlinePool(...)` call sites' TYPES only if they break the build**

`TodaySection.tsx` still calls `headlinePool(site)` — it will fail typecheck. Do NOT rewire the
component here (that's Task 2); make the minimal legal call `headlinePool(site, 'melbourne')` with a
`// Task 2 threads the real geo` comment so this task stays green standalone.

- [ ] **Step 1.5: Run + commit**

```powershell
npx vitest run src/lib/conveyor.test.ts
npm test
npm run build
```
Expected: all PASS (default-view behaviour unchanged), build clean.

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git add web/src/lib/conveyor.ts web/src/lib/conveyor.test.ts web/src/lib/geoBands.ts web/src/components/TodaySection.tsx
git commit -m "feat(web): per-geo headline pool + client-side latest/delta with mis-format guard

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Thread geo through the banner (TodaySection + App)

**Files:**
- Modify: `web/src/components/TodaySection.tsx` (props, LeadCard, SecondaryCard, pool)
- Modify: `web/src/App.tsx` (~line 213 `filtersActive`, ~line 255 TodaySection props)
- Test: `web/src/components/TodaySection.test.tsx`

**Interfaces:**
- Consumes: Task 1's `headlinePool(site, geo)`, `latestForGeo`, `tileValueMatchesPrimary`.
- Produces: `TodaySection({ site, news, onOpen, now, geo, detailOpen })` — `filtersActive` prop DELETED. `LeadCard`/`SecondaryCard` gain `geo`.

- [ ] **Step 2.1: Write the failing tests — edit `web/src/components/TodaySection.test.tsx`**

(a) The existing `'filters active: no lead card…'` test asserts the old hiding behaviour — the spec
deletes it. REPLACE it with:

```tsx
test('non-default geo: the banner shows that geo\'s finding and value, never Melbourne\'s', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="regional_vic" />)
  const lead = screen.getByTestId('lead-finding')
  // Fixture: median_rent regional finding (read the exact sentence from
  // site.edge.json and pin a distinctive substring of it):
  expect(lead).toHaveTextContent(/* regional sentence substring */ '')
  // The value line is the REGIONAL number (pin from the fixture), not 575:
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).queryByText(/* Melbourne's formatted value e.g. '$575\/wk' */ '')).not.toBeInTheDocument()
})
```
Fill the pins from the fixture by hand (same rule as Task 1). Add alongside it:

```tsx
test('default geo: value line still comes from the export tiles (byte-identical default view)', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} geo="melbourne" />)
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('$580/wk')).toBeInTheDocument()   // the existing pinned tile value
})

test('mis-format guard: an hvi-style tile shows no value line off-default', () => {
  // melb_dwelling_values pairs a MoM tile value with an index-level chart —
  // under any non-default geo its cards must omit the line rather than
  // format an index level as a percentage. Drive the conveyor to that card
  // via a pool where it appears (or assert via SecondaryCard render), and
  // assert no stray '183' / mis-formatted number renders. If the fixture's
  // hvi chart has no non-melbourne geo (true today: geos=['melbourne']),
  // this guard is unreachable in production for that key — then instead
  // unit-assert the guard directly: tileValueMatchesPrimary === false and
  // TodaySection's value-line branch consults it (see Step 2.3 wiring).
  expect(tileValueMatchesPrimary(site, 'melb_dwelling_values')).toBe(false)
})
```
(b) Every other existing render of `<TodaySection …>` in this file passes no `geo` — add
`geo="melbourne"` to each (the default view), leaving their assertions untouched. Delete
`filtersActive` from any render that passes it.

- [ ] **Step 2.2: Run to verify failure**

```powershell
npx vitest run src/components/TodaySection.test.tsx
```
Expected: FAIL — no `geo` prop; the replaced test fails.

- [ ] **Step 2.3: Implement**

`TodaySection.tsx`:
- Props: `geo: Geo` replaces `filtersActive` (import `Geo` + `DEFAULT_GEO` from `../lib/urlState`).
- Pool: `const pool = useMemo(() => headlinePool(site, geo), [site, geo])`.
- Thread `geo` into `LeadCard`/`SecondaryCard`. Inside each, the finding resolves at the SELECTED
  geo — `site.findings[chartId]?.[geo] ?? ''` — and the value line becomes:

```tsx
  // Default view keeps the export tiles (byte-identical). Off-default, the
  // line is computed from the chart's own series at the selected geo — and
  // omitted entirely when the tile's export-side value isn't the primary-
  // metric level (never mis-format; spec §1).
  let valueText: string | null = null
  let deltaText: string | null = null
  if (geo === DEFAULT_GEO) {
    valueText = tile.value != null && fmt ? fmt.value(tile.value) : null
    deltaText = tile.delta != null && fmt ? fmt.delta(tile.delta) : null
  } else if (fmt && tileValueMatchesPrimary(site, leadKey)) {
    const latest = latestForGeo(site, leadKey, geo)
    if (latest) {
      valueText = fmt.value(latest.value)
      deltaText = latest.delta != null ? fmt.delta(latest.delta) : null
    }
  }
```
  (In `SecondaryCard` the same pattern with `tileKey`, valueText only — it never showed a delta.)
  `deltaColor(tile)` keeps using the registry tile's `delta_color` semantics but must colour the
  PER-GEO delta sign off-default: pass `{ delta: latest.delta, delta_color: tile.delta_color }` to
  `deltaColor` in that branch, not the export tile.
- The `motion.div` key must include the geo (`key={`${chartId}-${geo}`}`) so a geo switch replays
  the entrance animation with the new content.

`App.tsx`:
- Delete `filtersActive` (line ~213) if nothing else references it (grep first — as of this plan the
  TodaySection prop is its only consumer).
- TodaySection call: `geo={state.geo}` replaces `filtersActive={filtersActive}`.

- [ ] **Step 2.4: Run + commit**

```powershell
npx vitest run src/components/TodaySection.test.tsx
npm test
npm run build
```
Expected: PASS. (App.test.tsx renders App, which now always shows the banner — if any App test
asserted the banner ABSENT under a geo/range URL, update it to assert presence instead; report each.)

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git add web/src/components/TodaySection.tsx web/src/components/TodaySection.test.tsx web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): headline banner is geo-aware and always on

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Broken sources last + compact outage cards + e2e

**Files:**
- Modify: `web/src/App.tsx` (grid split), `web/src/components/ChartCard.tsx` (compact branch)
- Test: `web/src/App.test.tsx`, `web/src/components/ChartCard.test.tsx`, `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: `isBrokenSource` from `geoBands.ts` (Task 1 exported it).
- Produces: testid `outage-row` on the compact card.

- [ ] **Step 3.1: Write the failing tests**

`ChartCard.test.tsx` (use the file's existing helpers; `vic_auctions` in the fixture is `status:
'failed'`):

```tsx
test('a broken-source chart renders as a compact outage row — no chart area', () => {
  render(<ChartCard site={site} chart={auctionsChart} finding="" range="5y"
                    geo="melbourne" now={NOW} onOpen={() => {}} />)
  const row = screen.getByTestId('outage-row')
  expect(within(row).queryByRole('img')).not.toBeInTheDocument()      // no chart svg
  expect(within(row).getByText(/Auction clearance/)).toBeInTheDocument()
  expect(within(row).getByText(/source unavailable/i)).toBeInTheDocument()
})

test('the compact row still opens the detail modal', async () => {
  const onOpen = vi.fn()
  render(<ChartCard site={site} chart={auctionsChart} finding="" range="5y"
                    geo="melbourne" now={NOW} onOpen={onOpen} />)
  await userEvent.click(screen.getByTestId('outage-row'))
  expect(onOpen).toHaveBeenCalledWith(auctionsChart.id)
})
```
(Adapt the chip-text regex to the staleness chip's actual label in the fixture — read it first.)

`App.test.tsx` (geo-banding describe):

```tsx
test('broken-source charts sort to the end of their section', async () => {
  history.replaceState(null, '', '/?sections=prices')
  mockFetch()
  render(<App now={new Date('2026-07-18T10:00:00Z')} />)
  await screen.findByText('Victorian Housing')
  const prices = screen.getByRole('region', { name: 'Prices' })
  const cards = within(prices).getAllByRole('article')   // adjust to the card container role/testid actually used
  // The outage rows must come after every healthy card:
  const firstOutage = cards.findIndex(c => within(c).queryByTestId?.('outage-row') != null)
  // simpler robust form — assert the LAST card is the outage row and no
  // outage row appears before a healthy chart card; adapt selectors to the
  // DOM the section actually renders (read App.tsx's markup first).
  expect(firstOutage).toBeGreaterThan(0)
})
```
Write the assertion against the real DOM structure — the shape above is the intent, not literal
selectors; a reviewer will judge whether it genuinely proves ordering (a vacuous version of this
test has been caught before in this project — make the RED run prove it can fail, e.g. by
temporarily disabling the sort).

`e2e/smoke.spec.ts` (append to the geo/personalisation describes):

```ts
test('the banner rotates under Regional Vic with regional findings', async ({ page }) => {
  await page.clock.install()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await gotoDashboard(page, '/?geo=regional_vic')
  const lead = page.getByTestId('lead-finding')
  await lead.waitFor()
  const before = await lead.textContent()
  await page.clock.fastForward(5100)
  await expect(lead).not.toHaveText(before!)
})

test('a dead source sits at the end of Prices as a compact row', async ({ page }) => {
  await gotoDashboard(page, '/?geo=melbourne&sections=prices')
  const prices = page.locator('section[aria-label="Prices"]')
  await prices.waitFor()
  const rows = prices.getByTestId('outage-row')
  await expect(rows.first()).toBeVisible()
  // No outage row before the last healthy card: the last grid children are the outage rows.
  const lastCard = prices.locator('[data-testid="outage-row"]').last()
  await expect(lastCard).toBeVisible()
})
```
(The regional banner e2e relies on the regenerated `site.real.json` carrying ≥3 regional findings —
verify with a scratch read first; if the pool is 2, assert static presence instead of rotation and
say so.)

- [ ] **Step 3.2: Run to verify failure** (vitest files above) — expected FAIL (no `outage-row`).

- [ ] **Step 3.3: Implement**

`ChartCard.tsx` — at the top of the render path (after `useChartData`), add the compact branch:

```tsx
  // 2026-07-24: a BROKEN source (missing series entry or failed fetch)
  // renders as a compact row — no chart area — so an outage never wastes a
  // full card of page space. Keyed on source status, NOT on lines.length:
  // a healthy chart that's merely empty at the current range keeps the
  // full-size treatment (pre-existing behaviour, out of scope here).
  if (isBrokenSource(entry)) {
    return (
      <article data-testid="outage-row"
               onClick={() => onOpen(chart.id)}
               className="bg-card border border-line rounded-lg px-4 py-2.5 cursor-pointer
                          flex flex-wrap items-center gap-x-3 gap-y-1 hover:border-blue">
        <span className="font-medium text-sm">{chart.title}</span>
        {st && st.kind !== 'fresh' &&
          <Chip kind={st.kind === 'ageing' ? 'warn' : 'bad'}>{st.label}</Chip>}
        <span className="text-xs text-faint">
          {DEAD_CARD_BODY[chart.id] ?? DEFAULT_DEAD_BODY}</span>
      </article>
    )
  }
```
Make it keyboard-accessible the way the codebase does elsewhere: if other clickable cards use a
`<button>`, use the same idiom instead of `onClick` on an article (read the existing card markup
and follow it — a click-only div would fail the axe/keyboard standards this repo enforces).
Import `isBrokenSource` from `../lib/geoBands`.

`App.tsx` — split the grid render:

```tsx
                  const gridAll = sectionCharts.filter(c =>
                    bandFor(c, state.geo, site.series[c.series_id]) === 'grid')
                  // Broken sources always render LAST in their section, as
                  // compact rows — never as the section's lead card.
                  const healthy = gridAll.filter(c => !isBrokenSource(site.series[c.series_id]))
                  const broken = gridAll.filter(c => isBrokenSource(site.series[c.series_id]))
```
Render `healthy` with the existing D2(e) logic (`dangling` computed against `healthy.length`), then
`broken` after the healthy grid, before the context band, each wrapped in `sm:col-span-2`-equivalent
full-width (they're inside the same grid container as full-width rows, or a simple stacked div —
follow whichever needs fewer changes; the compact row itself is display-agnostic). Import
`isBrokenSource`.

- [ ] **Step 3.4: Run everything**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npm test
npm run build
npm run e2e
```
Expected: vitest green (277+1 baseline + new), build clean, e2e green both projects (49+1 + new).
If an existing test asserted the OLD full-size dead card (grep `DEAD_CARD_BODY`/`dead card` in
tests), update it to the compact row faithfully and report it.

- [ ] **Step 3.5: Commit**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git add web/src/App.tsx web/src/components/ChartCard.tsx web/src/components/ChartCard.test.tsx web/src/App.test.tsx web/e2e/smoke.spec.ts
git commit -m "feat(web): broken sources render last as compact outage rows

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Completion

Whole-branch review, then merge to `main` (auto-deploys). The default view must be visually
byte-identical except for outage-card placement/size — call that out to the reviewer.
