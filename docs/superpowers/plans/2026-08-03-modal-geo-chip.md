# Modal Geography Chip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every chart modal always shows its plotted geography as a chip (card-badge vocabulary), and cross-geography compare lines carry a region suffix.

**Architecture:** Two pure additions to `web/src/lib/geoBands.ts` (`REGION_BADGE`, `modalRegion`) consumed by `DetailView.tsx`; no pipeline changes.

**Tech Stack:** React 19 + TS (web/), vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-03-modal-geography-chip-design.md`

## Global Constraints

- **Windows.** Frontend commands from `web\`; vitest = `npm test`; e2e = `npm run e2e`. Python (if ever needed) ONLY `.venv\Scripts\python.exe` from repo root.
- Branch `feature/modal-geo-chip` off `main`. One commit per task, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- REGION_BADGE values verbatim: `melbourne: 'Melbourne', regional_vic: 'Regional Vic', vic: 'Victoria-wide', australia: 'Australia', global: 'Global'` (ASCII hyphen in Victoria-wide).
- Compare suffix separator is ` — ` (space, em dash U+2014, space).
- e2e assertions must be time-independent (frozen fixtures vs wall clock): assert label text/structure, never staleness kinds or dates.
- Do not touch pipeline/, app/, .github/.

---

### Task 1: `REGION_BADGE` + `modalRegion` in geoBands

**Files:**
- Modify: `web/src/lib/geoBands.ts` (append below `SCOPE_BADGE`)
- Test: `web/src/lib/geoBands.test.ts` (create if absent; if a geoBands test file already exists under another name, extend that instead)

**Interfaces:**
- Produces: `REGION_BADGE: Record<string, string>` and `modalRegion(chart: ChartSpec, geo: Geo): string` — Tasks 2–3 import both from `../lib/geoBands`.

- [ ] **Step 1: Write the failing tests**

```ts
import { modalRegion, REGION_BADGE, SCOPE_BADGE } from './geoBands'
import type { ChartSpec } from './types'

const chart = (region_mode: string): ChartSpec => ({
  id: 'x', section: 's', title: 'x', series_id: 'x', metrics: null,
  region_mode, scope: 'geo', geos: ['melbourne'],
  percent: false, markers: false, annotate: false })

test('modalRegion: fixed charts pin their region, geo charts follow the modal geo', () => {
  expect(modalRegion(chart('fixed:australia'), 'melbourne')).toBe('australia')
  expect(modalRegion(chart('fixed:global'), 'vic')).toBe('global')
  expect(modalRegion(chart('geo'), 'regional_vic')).toBe('regional_vic')
})

test('REGION_BADGE speaks the card-badge vocabulary — pinned against SCOPE_BADGE', () => {
  expect(REGION_BADGE.vic).toBe(SCOPE_BADGE.state)
  expect(REGION_BADGE.australia).toBe(SCOPE_BADGE.national)
  expect(REGION_BADGE.global).toBe(SCOPE_BADGE.global)
  expect(REGION_BADGE.melbourne).toBe('Melbourne')
  expect(REGION_BADGE.regional_vic).toBe('Regional Vic')
})
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/geoBands.test.ts` → FAIL (no such exports).

- [ ] **Step 3: Implement** — append to `web/src/lib/geoBands.ts`:

```ts
// Spec 2026-08-03: the modal's always-on geography chip. IDENTICAL wording to
// the card badges where those exist (SCOPE_BADGE — pinned by unit test) so what
// a reader saw before opening never changes after; per-region names otherwise.
export const REGION_BADGE: Record<string, string> = {
  melbourne: 'Melbourne', regional_vic: 'Regional Vic', vic: 'Victoria-wide',
  australia: 'Australia', global: 'Global',
}

// The ONE geography a chart plots inside the detail modal: fixed-region charts
// pin their region; geo-scoped charts plot the geo the modal was opened at
// (App's detailGeo already resolved coverage fallbacks).
export function modalRegion(chart: ChartSpec, geo: Geo): string {
  return chart.region_mode.startsWith('fixed:')
    ? chart.region_mode.slice('fixed:'.length)
    : geo
}
```

(`Geo` is already imported in geoBands.ts.)

- [ ] **Step 4: Run** — target file green, then full `npm test`.
- [ ] **Step 5: Commit** — `feat(web): REGION_BADGE + modalRegion for the modal geography chip`

---

### Task 2: DetailView always-on geography chip

**Files:**
- Modify: `web/src/components/DetailView.tsx`
- Test: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: Task 1's exports.
- Produces: modal DOM contract — a neutral chip with the region label directly under the `<h2>`; `dialog` aria-label `${chart.title} — ${label}`; DetailView's caption-row scopeNote chip REMOVED (ChartCard's stays).

- [ ] **Step 1: Write the failing tests** — add to `App.test.tsx` (reuse the file's mockFetch/openSection/modal-open helpers):

```tsx
test('every modal names its geography: fixed:australia chart under melbourne shows Australia', async () => {
  // open the cash-rate card (context band under melbourne) → modal chip 'Australia'
  // dialog accessible name ends with '— Australia'
})
test('a geo-scoped chart opened under melbourne shows Melbourne in the modal', async () => { /* … */ })
test('the modal caption no longer repeats the scopeNote chip', async () => {
  // fixed:melbourne chart opened under a different geo: exactly ONE region chip
  // (the new one under the headline), none in the caption row
})
```

Write these as real tests against the fixture (the sketch above states intent; follow the file's existing idioms — `within(dialog)`, `getByRole('dialog', { name: /… — Australia$/ })`).

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** in `DetailView.tsx`:

```tsx
import { modalRegion, REGION_BADGE } from '../lib/geoBands'
// inside the component, before the return:
const region = modalRegion(chart, geo)
const regionLabel = REGION_BADGE[region] ?? region
```

- `<dialog … aria-label={`${chart.title} — ${regionLabel}`}>`
- Directly after the header `<div className="flex items-start gap-2">…</div>`, insert:

```tsx
      <div className="mt-1">
        <Chip kind="neutral">{regionLabel}</Chip>
      </div>
```

- Delete the caption row's `{scopeNote && <Chip kind="neutral">{scopeNote}</Chip>}` and drop `scopeNote` from the `useChartData` destructuring.

- [ ] **Step 4: Run** — targeted then full `npm test`; `npm run build` clean.
- [ ] **Step 5: Commit** — `feat(web): always-on geography chip in the chart modal`

---

### Task 3: Compare-line region suffix

**Files:**
- Modify: `web/src/components/DetailView.tsx` (compare derivation, lines ~42-54)
- Test: `web/src/App.test.tsx` (extend the existing compare tests)

**Interfaces:**
- Consumes: Task 1's exports (already imported by Task 2).
- Produces: when `modalRegion(cmpChart, geo) !== modalRegion(chart, geo)`, the compare line's NAME is `` `${cmpChart.title} — ${REGION_BADGE[cmpRegion] ?? cmpRegion}` `` and that SAME string keys `unitByName` — legend, tooltip, data table, and CSV all inherit it. Same-region compares keep the bare title.

- [ ] **Step 1: Write the failing tests** — extend App.test's compare coverage: select a cross-region compare (e.g. a melbourne-geo primary + `fixed:australia` compare) and assert the data table/legend shows `<title> — Australia`; assert a same-region compare stays bare.

- [ ] **Step 2: Run to verify failure.**

- [ ] **Step 3: Implement** — replace the compare block:

```tsx
  const cmpChart = compare ? site.charts.find(c => c.id === compare) : null
  const cmpEntry = cmpChart ? site.series[cmpChart.series_id] : null
  const cmpMetrics = cmpChart ? (cmpChart.metrics ?? (cmpEntry ? Object.keys(cmpEntry.units) : [])) : []
  const cmpUnit = cmpEntry ? (cmpEntry.units[cmpMetrics[0]] ?? Object.values(cmpEntry.units)[0] ?? '') : ''
  // A compare overlay from a DIFFERENT geography must say so (spec 2026-08-03
  // §4): suffix the region, and key unitByName with the SAME suffixed name so
  // legend, tooltip, table and CSV can never disagree about what it is.
  const cmpName = cmpChart
    ? (modalRegion(cmpChart, geo) !== region
        ? `${cmpChart.title} — ${REGION_BADGE[modalRegion(cmpChart, geo)] ?? modalRegion(cmpChart, geo)}`
        : cmpChart.title)
    : ''
  const cmpLines = cmpChart
    ? chartPoints(site, cmpChart, localRange, geo, now).lines.slice(0, 1)
      .map(l => ({ ...l, name: cmpName }))
    : []
  const unitByName = cmpChart ? { ...primaryUnits, [cmpName]: cmpUnit } : primaryUnits
```

(`region` comes from Task 2. `y2Lines={cmpChart ? cmpLines.map(l => l.name) : undefined}` and `toCsv` both key off the line name, so they inherit the suffix with no further change — verify, don't re-implement.)

- [ ] **Step 4: Run** — targeted then full `npm test`.
- [ ] **Step 5: Commit** — `feat(web): compare lines name their region when it differs`

---

### Task 4: e2e + full verification

**Files:**
- Modify: `web/e2e/smoke.spec.ts`

- [ ] **Step 1: Add e2e tests** (time-independent; follow the file's section-open + `exact: true` idioms):

```ts
test('the chart modal always names its geography', async ({ page }) => {
  // open Money & credit → open the cash-rate card's modal
  // expect dialog accessible name to match / — Australia$/
  // expect a chip with text 'Australia' visible inside the dialog
})
```

- [ ] **Step 2: Run** — `npm run e2e` all green; `npx playwright test -g "geography" --repeat-each=5` for the new test.
- [ ] **Step 3: Full sweep** — from web\: `npm test`, `npm run lint` (4-warning baseline), `npm run build`; from root: `.venv\Scripts\python.exe -m pytest tests\ -q` (untouched but cheap insurance).
- [ ] **Step 4: Commit** — `test(e2e): modal geography chip`

---

### Task 5: Branch review, merge, deploy, live verification

- [ ] Whole-branch review (requesting-code-review template; most capable model).
- [ ] Fix wave if needed; re-review.
- [ ] `git checkout main; git pull --ff-only; git merge --no-ff feature/modal-geo-chip; git push`; delete branch.
- [ ] Watch CI + deploy runs to success; verify live via run conclusion (never the local browser pane); ask the user to eyeball a modal on their device.
