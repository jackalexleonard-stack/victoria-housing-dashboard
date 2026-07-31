# Honest Staleness Tags + Explainer Popovers + Height-Aware Grid — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charts with historical data never say "source unavailable" — they get age-based tags with click-to-explain popovers (curated cause notes exported by the pipeline); and the chart grid becomes height-aware so no row ever shows a void or an orphaned card.

**Architecture:** Frontend-only except one small pipeline addition (`status_note` curated notes exported per series). `staleness()` becomes age-only for series with data; a shared `Popover` (extracted from Masthead's disclosure) powers a new `StatusChip` + `ExplainerPanel`; a pure `buildRows()` walks each grid band in registry order pairing same-height cards and spanning mismatches.

**Tech Stack:** React 19 + TS + Tailwind v4 (web/), vitest + Testing Library, Playwright e2e, Python 3.12 pipeline + pytest.

**Spec:** `docs/superpowers/specs/2026-07-31-chip-popovers-and-grid-design.md`

## Global Constraints

- **Windows.** Use PowerShell syntax. Python is ONLY `.venv\Scripts\python.exe` from the repo root (bare `python` hits the Store stub). Frontend commands run from `web\`.
- Test commands: pytest = `.venv\Scripts\python.exe -m pytest tests\ -q` (repo root); vitest = `npm test` (in `web\`); e2e = `npm run e2e` (in `web\`; builds first).
- Branch: all work on `feature/chip-popovers-and-grid` off `main`. One commit per task, message style `feat(web): …` / `feat(pipeline): …` / `test: …` as fits.
- Copy style: typographic apostrophes (`’`) in user-facing strings, ASCII `-` for minus, `·` as separator — match existing strings exactly.
- Never pin a test literal against `data/` (the daily cron rewrites it) — tests use frozen fixtures (`web/src/test/fixtures/site.real.json`, `site.edge.json`, `tests/fixtures/…`) and a fixed `now` where staleness matters.
- e2e assertions must not depend on wall-clock `now` drifting against frozen fixtures — assert kind-independent text (e.g. `Latest data:`) and structure, never a specific ageing/stale kind.
- Do not touch `.github/workflows/` (deploy stays as-is), `app/` (Streamlit), or `pipeline/sources/`.
- 44px effective touch targets on coarse pointers via existing `pointer-coarse:` utility pattern.

---

### Task 1: Pipeline — curated `status_note` exported per series

**Files:**
- Modify: `pipeline/export.py` (META_KEYS at line ~25, `_series_entry` at ~71, `validate_site` at ~311)
- Test: `tests/test_export.py`

**Interfaces:**
- Produces: `site.json` series meta gains key `status_note: str | None`. Curated dict `STATUS_NOTES: dict[str, str]` in `pipeline/export.py` keyed by series_id.
- Consumed by: Task 4's `ExplainerPanel` (cause line), Task 5's dead-row body.

- [ ] **Step 1: Write the failing tests** — append to `tests/test_export.py`:

```python
def test_series_entry_carries_curated_status_note():
    from pipeline.export import _series_entry, STATUS_NOTES
    lm = lambda sid: {"source_name": "DFFH / Homes Victoria Rental Report",
                      "frequency": "quarterly", "status": "failed",
                      "last_data_date": "2025-09-30"}
    ls = lambda sid: None
    entry = _series_entry("vic_rents", ls, lm)
    assert entry["meta"]["status_note"] == STATUS_NOTES["vic_rents"]
    # a series with no curated note exports an explicit None, never a KeyError
    entry2 = _series_entry("cash_rate", ls, lm)
    assert entry2["meta"]["status_note"] is None


def test_validate_site_rejects_empty_status_note(site_fixture=None):
    import copy
    from pipeline.export import validate_site
    # reuse the module's existing minimal-valid-site helper if one exists in
    # this test file; otherwise build from the smallest passing site dict
    # already constructed by neighbouring validate_site tests.
    site = copy.deepcopy(_minimal_valid_site())   # existing helper in this file
    sid = next(iter(site["series"]))
    site["series"][sid]["meta"]["status_note"] = ""
    try:
        validate_site(site)
        assert False, "empty status_note should fail validation"
    except ValueError:
        pass
    site["series"][sid]["meta"]["status_note"] = None
    validate_site(site)   # None is fine
    site["series"][sid]["meta"]["status_note"] = "a real note"
    validate_site(site)   # non-empty string is fine
```

Note: `tests/test_export.py` already contains validate_site tests — reuse its existing minimal-site helper/fixture (whatever it is actually named; adjust `_minimal_valid_site()` above to the real name after reading the file).

- [ ] **Step 2: Run to verify failure**

Run: `.venv\Scripts\python.exe -m pytest tests\test_export.py -q -k status_note`
Expected: FAIL — `ImportError: cannot import name 'STATUS_NOTES'` (and/or KeyError on `status_note`).

- [ ] **Step 3: Implement** in `pipeline/export.py`:

Extend META_KEYS (line ~25):

```python
META_KEYS = ("source_name", "source_url", "frequency", "last_fetched",
             "last_changed", "last_data_date", "error", "status_note")
```

Add above `_series_entry` (curated, qualitative-only — quantitative "n releases behind" is computed client-side so it can never rot):

```python
# Curated per-source cause notes surfaced in the frontend's staleness-chip
# explainer popovers (spec 2026-07-31 §1.4). Qualitative ONLY — never bake in
# a count of missed releases or a specific edition; the frontend computes
# "~n releases behind" live from cadence + data age.
STATUS_NOTES = {
    "vic_rents": (
        "Homes Victoria hasn’t published a new Rental Report for several "
        "quarters — the publisher is running behind its usual quarterly "
        "schedule. Its site also blocks automated fetchers, so this series "
        "refreshes from a manual run once a new report appears."),
    "vic_vacancy": (
        "Vacancy comes from the Rental Report’s SQM-sourced sheet, and Homes "
        "Victoria hasn’t published a new edition for several quarters. Its "
        "site also blocks automated fetchers, so this series refreshes from "
        "a manual run once a new report appears."),
    "vic_social_waitlist": (
        "homes.vic.gov.au blocks automated fetchers, so this series refreshes "
        "from a manual run when the quarterly dashboard updates."),
    "vic_auctions": (
        "Melbourne auction results aren’t reachable from an automated source "
        "right now; this card will populate if that changes."),
    "vic_median_price": (
        "REIV blocks automated access; this card will populate if the source "
        "opens up."),
}
```

In `_series_entry`, after `out_meta = {k: meta.get(k) for k in META_KEYS}` add:

```python
    out_meta["status_note"] = STATUS_NOTES.get(sid)
```

(The `meta.get("status_note")` from META_KEYS is always absent in on-disk meta JSON — this line is the single source of truth.)

In `validate_site`, inside the `for sid, entry in site["series"].items():` loop (after the cadence check at line ~319):

```python
        sn = entry["meta"].get("status_note")
        if sn is not None and (not isinstance(sn, str) or not sn):
            _fail(f"bad status_note for {sid}")
```

- [ ] **Step 4: Run tests**

Run: `.venv\Scripts\python.exe -m pytest tests\test_export.py -q`
Expected: PASS (all, including pre-existing).

- [ ] **Step 5: Full pytest sweep** — `.venv\Scripts\python.exe -m pytest tests\ -q` → all pass, 0 warnings.

- [ ] **Step 6: Commit** — `git add pipeline/export.py tests/test_export.py` → `feat(pipeline): export curated status_note per series for chip explainers`

---

### Task 2: `staleness.ts` — age-only taxonomy, `releasesBehind`, overdue `nextUpdate`

**Files:**
- Modify: `web/src/lib/staleness.ts`
- Modify: `web/src/lib/types.ts` (SeriesMeta)
- Test: `web/src/lib/staleness.test.ts`

**Interfaces:**
- Produces: `staleness(e, now)` → `{kind: 'fresh'|'ageing'|'stale'|'failed', label: string}` where `kind==='failed'` ⇔ the series has NO `last_data_date` and `status==='failed'`. New `releasesBehind(e: SeriesEntry, now: Date): number`. `nextUpdate(e, now)` returns `"next update was due ~X"` when the estimate is past. `SeriesMeta` gains `status_note?: string | null`.
- Consumed by: Tasks 4/5/6/7 (StatusChip, ExplainerPanel, banner), App's masthead filter (unchanged code, new behaviour).

- [ ] **Step 1: Rewrite the failing tests** — replace the `failed only wins…` test in `web/src/lib/staleness.test.ts` and extend:

```ts
test('failed fetch never changes the label while data exists — age alone decides', () => {
  const s = staleness(entry({ last_data_date: null }, 'failed'), NOW)
  expect(s).toEqual({ kind: 'failed', label: 'No data · source unavailable' })
  // failed fetch, data current -> fresh, quiet
  expect(staleness(entry({}, 'failed'), NOW))
    .toEqual({ kind: 'fresh', label: 'Data to Jun 2026' })
  // failed fetch, data past 1.5x cadence -> ageing, same as an ok series
  expect(staleness(entry({ last_data_date: '2026-05-20' }, 'failed'), NOW))
    .toEqual({ kind: 'ageing', label: 'Data to May 2026 · ageing' })
  // failed fetch, data past 2.5x cadence -> stale, NEVER "source unavailable"
  expect(staleness(entry({ last_data_date: '2026-04-01' }, 'failed'), NOW))
    .toEqual({ kind: 'stale', label: 'Data to Apr 2026 · stale' })
})

test('releasesBehind grants one cadence of publication lag, then counts', () => {
  // gap 18d / 31d cadence -> 0 behind
  expect(releasesBehind(entry({}), NOW)).toBe(0)
  // gap ~48d -> floor(1.5)-1 = 0
  expect(releasesBehind(entry({ last_data_date: '2026-05-31' }), NOW)).toBe(0)
  // gap ~78d -> floor(2.5)-1 = 1
  expect(releasesBehind(entry({ last_data_date: '2026-05-01' }), NOW)).toBe(1)
  // quarterly example — the DFFH shape: ~304d gap / 92d cadence -> 2
  expect(releasesBehind(entry({ last_data_date: '2025-09-30', frequency: 'quarterly',
                                cadence_days: 92 }), NOW)).toBe(2)
  expect(releasesBehind(entry({ last_data_date: null }), NOW)).toBe(0)
})

test('nextUpdate flips to "was due" when the estimate is in the past', () => {
  expect(nextUpdate(entry({}), NOW)).toBe('next update ~Jul 2026')
  expect(nextUpdate(entry({ last_data_date: '2026-04-01' }), NOW))
    .toBe('next update was due ~May 2026')
  expect(nextUpdate(entry({ last_data_date: null }), NOW)).toBeNull()
})
```

Also add `releasesBehind` to the import at the top of the test file.

- [ ] **Step 2: Run to verify failure** — in `web\`: `npm test -- src/lib/staleness.test.ts`
Expected: FAIL (releasesBehind not exported; failed-with-data cases return old labels; nextUpdate has no past form).

- [ ] **Step 3: Implement** — replace `staleness()` and `nextUpdate()` in `web/src/lib/staleness.ts`, add `releasesBehind`:

```ts
export function staleness(e: SeriesEntry, now: Date) {
  const { last_data_date, frequency, cadence_days } = e.meta
  const period = last_data_date ? `Data to ${fmtPeriod(last_data_date, frequency)}` : null
  if (!period) {
    // Spec 2026-07-31 §1.1: "source unavailable" is reserved for a series
    // with no data at all — everything with history is tagged by age alone.
    return e.status === 'failed'
      ? { kind: 'failed' as const, label: 'No data · source unavailable' }
      : { kind: 'stale' as const, label: 'No data' }
  }
  const gap = (now.getTime() - Date.parse(`${last_data_date}T00:00:00Z`)) / DAY
  if (gap > 2.5 * cadence_days) return { kind: 'stale' as const, label: `${period} · stale` }
  if (gap > 1.5 * cadence_days) return { kind: 'ageing' as const, label: `${period} · ageing` }
  return { kind: 'fresh' as const, label: period }
}

// How many releases the publisher looks to be behind — floor(gap/cadence)
// minus one cadence of normal publication lag. Computed live so explainer
// copy never rots as a late publisher falls further behind.
export function releasesBehind(e: SeriesEntry, now: Date): number {
  const { last_data_date, cadence_days } = e.meta
  if (!last_data_date) return 0
  const gap = (now.getTime() - Date.parse(`${last_data_date}T00:00:00Z`)) / DAY
  return Math.max(0, Math.floor(gap / cadence_days) - 1)
}

export function nextUpdate(e: SeriesEntry, now: Date): string | null {
  const { last_data_date, frequency, cadence_days } = e.meta
  if (!last_data_date) return null
  const t = Date.parse(`${last_data_date}T00:00:00Z`) + cadence_days * DAY
  const period = fmtPeriod(new Date(t).toISOString(), frequency)
  return t < now.getTime() ? `next update was due ~${period}` : `next update ~${period}`
}
```

In `web/src/lib/types.ts`, add to `SeriesMeta` (optional — older fixtures/exports stay valid):

```ts
  status_note?: string | null
```

- [ ] **Step 4: Run the target file** — `npm test -- src/lib/staleness.test.ts` → PASS.

- [ ] **Step 5: Full vitest sweep** — `npm test`. Expected fallout to FIX IN THIS TASK (behaviour is this task's own change):
  - `web/src/App.test.tsx` line ~108: the masthead-count test — with the new taxonomy a failed series WITH data never has kind 'failed', so the count only includes no-data sources. Update that test's comment/expectations to match (the fixture's `vic_auctions` failed-no-data → still counts; `vic_rents` → never counts regardless of date).
  - `web/src/App.test.tsx` line ~530 (`trips vic_rents' failed gate`): the section notice still fires (kind 'stale' satisfies it) but the per-card quiet pill and banner wording DON'T change until Tasks 5/7 — if this test asserts the old chip label at the stale date, adjust only what this task changed (`source unavailable` label no longer exists for with-data series; the notice text itself is Task 7).
  Anything else red: investigate — don't blind-patch.

- [ ] **Step 6: Commit** — `feat(web): age-only staleness taxonomy; releasesBehind; overdue nextUpdate`

---

### Task 3: Extract shared `Popover`; refactor Masthead onto it

**Files:**
- Create: `web/src/components/Popover.tsx`
- Create: `web/src/components/Popover.test.tsx`
- Modify: `web/src/components/Masthead.tsx`
- Test (existing, must stay green unchanged): `web/src/components/Masthead.test.tsx`

**Interfaces:**
- Produces: `Popover({ trigger, ariaLabel?, triggerStyle?, triggerClassName?, panelLabel, align?, children })` — a keyboard-operable disclosure: `<button aria-expanded aria-haspopup>` + absolutely-positioned panel (`role="group"`, `aria-label={panelLabel}`); Escape closes (stopPropagation), focus leaving the whole control closes, click toggles; panel flips to right-aligned when it would overflow the right viewport edge.
- Consumed by: Masthead (this task), StatusChip (Task 4), section banner (Task 7).

- [ ] **Step 1: Write failing tests** — `web/src/components/Popover.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover } from './Popover'

const setup = () => render(
  <div>
    <Popover trigger="why?" panelLabel="Details"><p>the explanation</p></Popover>
    <button type="button">elsewhere</button>
  </div>)

test('closed by default; click opens; Escape closes and keeps focus on the trigger', async () => {
  setup()
  const btn = screen.getByRole('button', { name: 'why?' })
  expect(btn).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('the explanation')).not.toBeInTheDocument()
  await userEvent.click(btn)
  expect(btn).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('group', { name: 'Details' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(btn).toHaveAttribute('aria-expanded', 'false')
  expect(btn).toHaveFocus()
})

test('focus leaving the control closes the panel', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'why?' }))
  await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
  expect(screen.getByRole('button', { name: 'why?' })).toHaveAttribute('aria-expanded', 'false')
})

test('ariaLabel overrides the accessible name without changing the visible text', async () => {
  render(<Popover trigger="Sep qtr 2025 · stale" ariaLabel="Sep qtr 2025 · stale — why?"
                  panelLabel="Details"><p>x</p></Popover>)
  expect(screen.getByRole('button', { name: 'Sep qtr 2025 · stale — why?' }))
    .toHaveTextContent('Sep qtr 2025 · stale')
})
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/components/Popover.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** — `web/src/components/Popover.tsx`:

```tsx
import { useLayoutEffect, useRef, useState } from 'react'

// Shared disclosure mechanics, extracted from Masthead's FailedSourcesDisclosure
// (2.3) so the staleness-chip explainers (spec 2026-07-31 §1.3) and the section
// banner reuse ONE implementation: button with aria-expanded/haspopup, Escape
// and focus-leave both close, panel flips right when it would overflow the
// right viewport edge (jsdom rects are all zero, so the flip only ever
// engages in a real browser — covered by e2e, not vitest).
export function Popover({ trigger, ariaLabel, triggerStyle, triggerClassName,
                          panelLabel, align = 'left', children }: {
  trigger: React.ReactNode
  ariaLabel?: string
  triggerStyle?: React.CSSProperties
  triggerClassName?: string
  panelLabel: string
  align?: 'left' | 'right'
  children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) { setFlip(false); return }
    const r = panel.current?.getBoundingClientRect()
    if (r && r.width > 0 && r.right > window.innerWidth - 8) setFlip(true)
  }, [open])

  const close = () => setOpen(false)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }
  const onBlur = (e: React.FocusEvent) => {
    if (!root.current?.contains(e.relatedTarget as Node | null)) close()
  }
  const side = flip || align === 'right' ? 'right-0' : 'left-0'

  return (
    <span ref={root} className="relative inline-block" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button type="button" aria-expanded={open} aria-haspopup="true"
              aria-label={ariaLabel}
              onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
              className={triggerClassName} style={triggerStyle}>
        {trigger}
      </button>
      {open && (
        <div ref={panel} role="group" aria-label={panelLabel}
             className={`absolute ${side} z-30 mt-1 min-w-[240px] max-w-[320px]
                         rounded-md border border-line bg-card p-3 text-xs
                         shadow-md text-left font-normal normal-case`}>
          {children}
        </div>
      )}
    </span>
  )
}
```

Refactor `Masthead.tsx`: delete `FailedSourcesDisclosure`'s hand-rolled state/handlers and render via Popover, preserving the exact trigger text, pill styling and right alignment:

```tsx
import { fmtDate } from '../lib/format'
import { Chip } from './Chip'
import { Popover } from './Popover'
import { PALETTE } from '../theme/tokens'

export interface FailedSource { source: string; vintage: string }

function FailedSourcesDisclosure({ failed }: { failed: FailedSource[] }) {
  return (
    <Popover align="right" panelLabel="Unavailable sources"
             trigger={`${failed.length} source${failed.length === 1 ? '' : 's'} unavailable`}
             triggerStyle={{ background: PALETTE.chip_warn, color: PALETTE.warn,
                             borderRadius: 999, padding: '2px 10px', fontSize: 12,
                             fontWeight: 500, border: 0, cursor: 'pointer' }}>
      <ul className="space-y-1.5">
        {failed.map(f => (
          <li key={f.source} className="flex items-center justify-between gap-3">
            <span>{f.source}</span>
            <span className="text-faint whitespace-nowrap">{f.vintage}</span>
          </li>
        ))}
      </ul>
    </Popover>
  )
}
```

(`Masthead` export itself unchanged.)

- [ ] **Step 4: Run** — `npm test -- src/components/Popover.test.tsx src/components/Masthead.test.tsx`
Expected: PASS — Masthead's existing four tests pass UNCHANGED (that's the refactor gate).

- [ ] **Step 5: Commit** — `refactor(web): extract shared Popover from masthead disclosure`

---

### Task 4: `StatusChip` + `ExplainerPanel`

**Files:**
- Create: `web/src/components/StatusChip.tsx`
- Create: `web/src/components/StatusChip.test.tsx`
- Modify: `web/src/components/Chip.tsx` (export the style map)

**Interfaces:**
- Consumes: `Popover` (Task 3), `staleness`/`releasesBehind`/`nextUpdate` (Task 2), `meta.status_note` (Tasks 1–2).
- Produces:
  - `CHIP_STYLES` exported from `Chip.tsx` (the existing `STYLES` const, renamed export; `Chip` itself unchanged).
  - `StatusChip({ entry, st, now, quiet? })` — `st` is `ReturnType<typeof staleness> | null`. Renders: null when `st` null; inert `<span>{label}</span>` when fresh; otherwise a Popover-wrapped chip. Quiet form (`quiet` && kind stale|failed): warn-styled pill labelled `{period} · {kindWord}`.
  - `ExplainerPanel({ entry, kind, now })` — the popover body; exported for the section banner (Task 7).

- [ ] **Step 1: Write failing tests** — `web/src/components/StatusChip.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusChip } from './StatusChip'
import { staleness } from '../lib/staleness'
import type { SeriesEntry } from '../lib/types'

const NOW = new Date('2026-07-31T00:00:00Z')
const entry = (over: Partial<SeriesEntry['meta']> = {},
               status: 'ok' | 'failed' = 'ok'): SeriesEntry => ({
  status, units: {}, points: [],
  meta: { source_name: 'DFFH / Homes Victoria Rental Report', source_url: 'u',
    frequency: 'quarterly', last_fetched: '2026-07-30T05:39:44Z', last_changed: null,
    last_data_date: '2025-09-30', error: null, cadence_days: 92,
    status_note: 'Homes Victoria hasn’t published a new Rental Report for several quarters.',
    ...over },
})
const chip = (e: SeriesEntry, quiet = false) =>
  render(<StatusChip entry={e} st={staleness(e, NOW)} now={NOW} quiet={quiet} />)

test('fresh renders inert text, no button', () => {
  chip(entry({ last_data_date: '2026-06-30' }))
  expect(screen.getByText('Data to Jun qtr 2026')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('stale chip is a button; popover explains cause, releases behind, next due', async () => {
  chip(entry({}, 'failed'))
  const btn = screen.getByRole('button',
    { name: 'Data to Sep qtr 2025 · stale — why?' })
  await userEvent.click(btn)
  const panel = screen.getByRole('group', { name: 'Stale data — details' })
  expect(panel).toHaveTextContent('Well past this series’ expected release date.')
  expect(panel).toHaveTextContent('Latest data: Sep qtr 2025 · published quarterly · ~2 releases behind')
  expect(panel).toHaveTextContent('Homes Victoria hasn’t published a new Rental Report')
  expect(panel).toHaveTextContent('next update was due ~Dec qtr 2025')
})

test('without a curated note, a failed fetch explains itself honestly', async () => {
  chip(entry({ status_note: null, last_data_date: null }, 'failed'))
  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('group', { name: 'Source unavailable — details' }))
    .toHaveTextContent('The source hasn’t responded to the daily updater. Last attempt: 30 Jul 2026.')
})

test('without a curated note, an ok-but-old series blames the publisher', async () => {
  chip(entry({ status_note: null, last_data_date: '2026-01-31' }, 'ok'))
  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('group'))
    .toHaveTextContent('The publisher hasn’t released newer figures yet.')
})

test('quiet form shows the short pill but the same popover', async () => {
  chip(entry({}, 'failed'), true)
  const btn = screen.getByRole('button', { name: 'Sep qtr 2025 · stale — why?' })
  expect(btn).toHaveTextContent('Sep qtr 2025 · stale')
  await userEvent.click(btn)
  expect(screen.getByRole('group', { name: 'Stale data — details' })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/components/StatusChip.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement.** In `Chip.tsx` rename the const and export it (update the one internal reference):

```tsx
export const CHIP_STYLES = {
  good: { bg: PALETTE.chip_up, fg: PALETTE.chip_up_text },
  warn: { bg: PALETTE.chip_warn, fg: PALETTE.chip_warn_text },
  bad: { bg: PALETTE.chip_down, fg: PALETTE.chip_down_text },
  neutral: { bg: PALETTE.bg2, fg: PALETTE.muted },
} as const
```

`web/src/components/StatusChip.tsx`:

```tsx
import { Popover } from './Popover'
import { CHIP_STYLES } from './Chip'
import { releasesBehind, nextUpdate, staleness } from '../lib/staleness'
import { fmtDate, fmtPeriod } from '../lib/format'
import type { SeriesEntry } from '../lib/types'

type St = ReturnType<typeof staleness>
type BadKind = 'ageing' | 'stale' | 'failed'

const TITLE: Record<BadKind, string> = {
  ageing: 'Ageing data', stale: 'Stale data', failed: 'Source unavailable',
}
const MEANING: Record<BadKind, string> = {
  ageing: 'The newest figures are older than this series’ usual release rhythm.',
  stale: 'Well past this series’ expected release date.',
  failed: 'The daily updater can’t retrieve this series, and there’s no history to show.',
}

// The popover body — what a tag means, how far behind the data is (computed
// live, spec §1.3), why (curated pipeline status_note, else an honest
// generated fallback), and when new data is expected/was due. Also used by
// the section-level banner (App.tsx).
export function ExplainerPanel({ entry, kind, now }: {
  entry: SeriesEntry; kind: BadKind; now: Date }) {
  const m = entry.meta
  const behind = releasesBehind(entry, now)
  const cause = m.status_note ?? (entry.status === 'failed'
    ? `The source hasn’t responded to the daily updater. Last attempt: ${
        m.last_fetched ? fmtDate(m.last_fetched) : 'unknown'}.`
    : 'The publisher hasn’t released newer figures yet.')
  const next = nextUpdate(entry, now)
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-ink">{TITLE[kind]}</p>
      <p className="text-muted">{MEANING[kind]}</p>
      {m.last_data_date && (
        <p className="text-muted">
          Latest data: {fmtPeriod(m.last_data_date, m.frequency)}
          {m.frequency ? ` · published ${m.frequency}` : ''}
          {behind >= 1 ? ` · ~${behind} release${behind === 1 ? '' : 's'} behind` : ''}
        </p>
      )}
      <p className="text-muted">{cause}</p>
      {next && <p className="text-faint">{next}</p>}
    </div>
  )
}

// Every non-fresh staleness tag in the app renders through this one
// component, so "clickable chip with an explanation" can't drift per
// call-site (spec §1.3). Fresh stays an inert span — nothing to explain.
export function StatusChip({ entry, st, now, quiet }: {
  entry: SeriesEntry | undefined; st: St | null; now: Date; quiet?: boolean }) {
  if (!st) return null
  if (st.kind === 'fresh') return <span>{st.label}</span>
  if (!entry) return null
  const kind = st.kind as BadKind
  const useQuiet = !!quiet && (kind === 'stale' || kind === 'failed')
  const label = useQuiet && entry.meta.last_data_date
    ? `${fmtPeriod(entry.meta.last_data_date, entry.meta.frequency)} · ${
        kind === 'failed' ? 'unavailable' : kind}`
    : st.label
  const s = CHIP_STYLES[useQuiet || kind === 'ageing' ? 'warn' : 'bad']
  return (
    <Popover trigger={label} ariaLabel={`${label} — why?`}
             panelLabel={`${TITLE[kind]} — details`}
             triggerClassName="pointer-coarse:py-2.5 pointer-coarse:px-4"
             triggerStyle={{ background: s.bg, color: s.fg, borderRadius: 999,
                             padding: '2px 10px', fontSize: 12, fontWeight: 500,
                             border: 0, cursor: 'pointer' }}>
      <ExplainerPanel entry={entry} kind={kind} now={now} />
    </Popover>
  )
}
```

- [ ] **Step 4: Run** — `npm test -- src/components/StatusChip.test.tsx src/components/Chip.test.tsx` (include Chip tests if they exist; harmless if not) → PASS. Then full `npm test` → no regressions (nothing consumes StatusChip yet).

- [ ] **Step 5: Commit** — `feat(web): StatusChip + ExplainerPanel — clickable staleness tags`

---

### Task 5: ChartCard integration — clickable chips, restructured outage row, `status_note` body

**Files:**
- Modify: `web/src/components/ChartCard.tsx`
- Modify: `web/src/test/fixtures/site.real.json`, `web/src/test/fixtures/site.edge.json` (add `status_note` to the meta of `vic_auctions`, `vic_median_price` [if present], `vic_rents` — the exact curated strings from Task 1)
- Test: `web/src/components/ChartCard.test.tsx`, `web/src/App.test.tsx` (quiet-pill assertions)

**Interfaces:**
- Consumes: `StatusChip` (Task 4), `meta.status_note` (Task 2 types).
- Produces: outage row = `<div data-testid="outage-row">` containing a title/body `<button>` (opens detail) and a SIBLING `StatusChip` button — never nested buttons. `DEAD_CARD_BODY` dict deleted; dead body = `entry?.meta.status_note ?? DEFAULT_DEAD_BODY`.

- [ ] **Step 1: Update/extend the failing tests** in `ChartCard.test.tsx`:
  - The dead-row tests (lines ~29–69): the row is now a `div[data-testid="outage-row"]`, whose FIRST button (accessible name `${title} — open details`) opens the modal, and whose chip is a SEPARATE button (`No data · source unavailable — why?`). Assert both buttons exist, no nesting (`btn.closest('button')` of the chip must be itself), body text comes from the fixture's `status_note` (auction copy: `Melbourne auction results aren’t reachable…`).
  - The quiet-pill test (line ~147–152): label becomes `Sep qtr… · stale`-form → with the frozen `now` of `2027-01-01` and the fixture's vic_rents `last_data_date` (`2026-03-31`), expect `Mar qtr 2026 · stale` and NOT `/source unavailable/i`.
  - Add: clicking the caption chip opens a popover (getByRole group) and does NOT open the detail modal (onOpen not called).

Example for the new assertions:

```tsx
test('caption chip opens the explainer without opening the modal', async () => {
  const onOpen = vi.fn()
  const stale = new Date('2027-01-01T00:00:00Z')
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f"
                    range="all" geo="melbourne" now={stale} onOpen={onOpen} />)
  await userEvent.click(screen.getByRole('button', { name: /· stale — why\?$/ }))
  expect(screen.getByRole('group', { name: 'Stale data — details' })).toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
})
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/components/ChartCard.test.tsx` → FAIL.

- [ ] **Step 3: Implement in `ChartCard.tsx`:**
  - Delete `DEAD_CARD_BODY` (keep `DEFAULT_DEAD_BODY`); everywhere it was used: `const deadBody = entry?.meta.status_note ?? DEFAULT_DEAD_BODY`.
  - Replace the `statusChip` const with: `const statusChip = <StatusChip entry={entry} st={st} now={now} quiet={quietOutage} />` (import StatusChip; remove the now-unused `Chip` import if nothing else uses it — `scopeBadge`/`scopeNote` still use `Chip`, so keep it).
  - Restructure the dead-row branch:

```tsx
  if (isDeadChart(chart, entry)) {
    return (
      <div data-testid="outage-row"
           className="w-full bg-card border border-line rounded-lg px-4 py-2.5
                      flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => onOpen(chart.id)}
                aria-label={`${chart.title} — open details`}
                className="text-left cursor-pointer group flex-1 min-w-[12rem]">
          <span className="font-medium text-sm group-hover:text-blue">{chart.title}</span>{' '}
          <span className="text-xs text-faint">{deadBody}</span>
        </button>
        {statusChip}
      </div>
    )
  }
```

  - `failedEmpty` body paragraph (line ~216): `{deadBody}`.
  - Update fixtures: in both site fixture JSONs, add `"status_note": "<the Task-1 curated string>"` inside `series.<sid>.meta` for `vic_auctions`, `vic_rents` (+ `vic_median_price` if the fixture carries it), and `"status_note": null` is NOT required elsewhere (the field is optional).

- [ ] **Step 4: Run** — `npm test -- src/components/ChartCard.test.tsx` → PASS. Full `npm test` — App.test quiet-pill/outage-row assertions may need the same label updates; fix them to the new contract.

- [ ] **Step 5: Commit** — `feat(web): clickable staleness chips on cards; outage row un-nests its chip; dead-card copy from pipeline status_note`

---

### Task 6: DetailView integration

**Files:**
- Modify: `web/src/components/DetailView.tsx` (line ~154)
- Test: `web/src/App.test.tsx` (modal assertions, if any touch the chip)

**Interfaces:** Consumes `StatusChip`. The modal's caption row renders `<StatusChip entry={entry} st={st} now={now} />` (never quiet). `nextUpdate(entry, now)` already renders the "was due" form via Task 2 — no change needed on that line.

- [ ] **Step 1: Write the failing test** — add to `App.test.tsx` (find the existing describe that opens the detail modal and reuse its open helper):

```tsx
test('the detail modal chip opens the explainer popover', async () => {
  mockFetch()
  const stale = new Date('2027-01-01T00:00:00Z')
  render(<App now={stale} />)
  await screen.findByText('Victorian Housing')
  const section = await openSection('Rents & vacancy')
  await userEvent.click(within(section).getAllByRole('button', { name: /open details/ })[0])
  const dialog = await screen.findByRole('dialog')
  await userEvent.click(within(dialog).getByRole('button', { name: /— why\?$/ }))
  expect(within(dialog).getByRole('group', { name: /details$/ })).toBeInTheDocument()
})
```

(Adapt the section/card selection to the file's existing helpers — the point under test: a chip button inside the dialog opens a `role="group"` explainer.)

- [ ] **Step 2: Run to verify failure** — `npm test -- src/App.test.tsx -t "detail modal chip"` → FAIL (chip is a plain Chip span).

- [ ] **Step 3: Implement** — in `DetailView.tsx` replace line ~154-155 with:

```tsx
        <StatusChip entry={entry} st={st} now={now} />
```

(import `StatusChip`; drop the now-unused `Chip` import only if `scopeNote`'s Chip at line ~158 is also… it is still used — keep `Chip`.)

- [ ] **Step 4: Run** — the new test + full `npm test` → PASS.

- [ ] **Step 5: Commit** — `feat(web): explainer chip in the detail modal`

---

### Task 7: Section banner — reword + make it open the explainer

**Files:**
- Modify: `web/src/lib/sections.ts` (SectionOutage + return), `web/src/App.tsx` (banner render, line ~271-276)
- Test: `web/src/lib/sections.test.ts`, `web/src/App.test.tsx` (lines ~530-550 wording)

**Interfaces:**
- `SectionOutage` becomes `{ token: string; period: string; seriesId: string }` (seriesId = the notice's primary series, so App can feed `ExplainerPanel`).
- Banner render: a `Popover` whose trigger is the full-width warn banner reading `{token} — awaiting new release · data to {period}`, panel = `ExplainerPanel`.

- [ ] **Step 1: Update failing tests:**
  - `sections.test.ts`: the notice assertion gains `seriesId` (e.g. `expect(notice).toEqual({ token: 'DFFH', period: 'Mar qtr 2026', seriesId: 'vic_rents' })` — match the file's existing fixture values).
  - `App.test.tsx` line ~534: text becomes `/DFFH — awaiting new release · data to Mar qtr 2026/`; additionally assert it is a **button** and clicking it shows `role="group"`.

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/sections.test.ts src/App.test.tsx` → FAIL.

- [ ] **Step 3: Implement:**

`sections.ts` — extend the interface and final return:

```ts
export interface SectionOutage { token: string; period: string; seriesId: string }
// …
  return { token: shortSource(primary.meta.source_name),
           period: fmtPeriod(lastDate, primary.meta.frequency), seriesId: primaryId }
```

`App.tsx` — replace the banner `<p role="status">` block (lines ~271-276):

```tsx
                {outageNotice && (() => {
                  const nEntry = site.series[outageNotice.seriesId]
                  const nSt = nEntry ? staleness(nEntry, now) : null
                  if (!nEntry || !nSt || nSt.kind === 'fresh') return null
                  return (
                    <div className="mb-3">
                      <Popover panelLabel="Why this section’s data is old"
                               trigger={`${outageNotice.token} — awaiting new release · data to ${outageNotice.period}`}
                               triggerClassName="text-sm rounded-md px-3 py-2 w-full text-left cursor-pointer border-0"
                               triggerStyle={{ background: PALETTE.chip_warn, color: PALETTE.chip_warn_text }}>
                        <ExplainerPanel entry={nEntry}
                                        kind={nSt.kind as 'ageing' | 'stale' | 'failed'}
                                        now={now} />
                      </Popover>
                    </div>
                  )
                })()}
```

(imports: `Popover`, `ExplainerPanel`. The `Popover` root is `inline-block`; the wrapping `div` keeps it in flow with the old spacing. A notice whose primary series somehow reads fresh renders nothing — honest by construction.)

- [ ] **Step 4: Run** — targeted files, then full `npm test` → PASS.

- [ ] **Step 5: Commit** — `feat(web): section outage banner reworded + opens the explainer`

---

### Task 8: `rows.ts` — height classes + row builder

**Files:**
- Create: `web/src/lib/rows.ts`
- Create: `web/src/lib/rows.test.ts`

**Interfaces:**
- Produces:
  - `type HeightClass = 'tile' | 'tall' | 'standard'`
  - `heightClassFor(site: SiteData, chart: ChartSpec, range: Range, geo: Geo, now: Date): HeightClass` — `'tall'` for `chart.id === 'mortgage_rates'`; `'tile'` when the chart's visible lines are non-empty and every line has <2 points (exactly ChartCard's stat-tile condition); else `'standard'`.
  - `type Row = { cards: ChartSpec[]; span: boolean }` (`cards.length` 1 with `span: true`, or 2 with `span: false`)
  - `buildRows(cards: ChartSpec[], classFn: (c: ChartSpec) => HeightClass, opts: { leadSpans: boolean }): Row[]` — registry order preserved; lead spans when opted; consecutive same-class non-tall cards pair; anything else spans.
- Consumed by: Task 9 (App), which renders `ChartCard fullWidth={row.span}`.

- [ ] **Step 1: Write failing tests** — `web/src/lib/rows.test.ts`:

```ts
import { buildRows, type HeightClass } from './rows'
import type { ChartSpec } from './types'

const c = (id: string): ChartSpec => ({ id, section: 's', title: id, series_id: id,
  metrics: null, region_mode: 'geo', scope: 'geo', geos: ['melbourne'],
  percent: false, markers: false, annotate: false })
const classes: Record<string, HeightClass> = {}
const fn = (x: ChartSpec) => classes[x.id] ?? 'standard'
const ids = (rows: ReturnType<typeof buildRows>) =>
  rows.map(r => ({ ids: r.cards.map(x => x.id), span: r.span }))

test('lead spans, then same-class neighbours pair, trailing odd card spans', () => {
  const rows = buildRows([c('a'), c('b'), c('d'), c('e')], fn, { leadSpans: true })
  expect(ids(rows)).toEqual([
    { ids: ['a'], span: true }, { ids: ['b', 'd'], span: false },
    { ids: ['e'], span: true }])
})

test('context band (no lead): pairs then spans the orphan — the wider-context fix', () => {
  const rows = buildRows([c('a'), c('b'), c('d')], fn, { leadSpans: false })
  expect(ids(rows)).toEqual([{ ids: ['a', 'b'], span: false }, { ids: ['d'], span: true }])
})

test('class mismatch spans the current card instead of leaving a void', () => {
  classes.tile1 = 'tile'
  const rows = buildRows([c('tile1'), c('a'), c('b')], fn, { leadSpans: false })
  expect(ids(rows)).toEqual([
    { ids: ['tile1'], span: true }, { ids: ['a', 'b'], span: false }])
})

test('two adjacent tiles pair; tall always gets its own row, even next to a twin', () => {
  classes.t1 = 'tile'; classes.t2 = 'tile'; classes.m1 = 'tall'; classes.m2 = 'tall'
  expect(ids(buildRows([c('t1'), c('t2')], fn, { leadSpans: false })))
    .toEqual([{ ids: ['t1', 't2'], span: false }])
  expect(ids(buildRows([c('m1'), c('m2')], fn, { leadSpans: false })))
    .toEqual([{ ids: ['m1'], span: true }, { ids: ['m2'], span: true }])
})

test('the money band shape: standard + tall + standard → three spanning rows', () => {
  classes.mortgage_rates = 'tall'
  const rows = buildRows([c('cash'), c('mortgage_rates'), c('credit')], fn,
                         { leadSpans: false })
  expect(rows.every(r => r.span)).toBe(true)
  expect(rows).toHaveLength(3)
})

test('registry order is never reshuffled', () => {
  classes.x = 'tile'
  const rows = buildRows([c('a'), c('x'), c('b')], fn, { leadSpans: true })
  expect(rows.flatMap(r => r.cards.map(k => k.id))).toEqual(['a', 'x', 'b'])
})
```

Also test `heightClassFor` against the real fixture:

```ts
import { heightClassFor } from './rows'
import site from '../test/fixtures/site.real.json'
import { assertSiteData } from './types'

test('heightClassFor: mortgage is tall; single-point land is a tile; lending is standard', () => {
  const s = assertSiteData(site)
  const NOW = new Date('2026-07-18T00:00:00Z')
  const chart = (id: string) => s.charts.find(x => x.id === id)!
  expect(heightClassFor(s, chart('mortgage_rates'), 'all', 'australia', NOW)).toBe('tall')
  expect(heightClassFor(s, chart('land'), 'all', 'melbourne', NOW)).toBe('tile')
  expect(heightClassFor(s, chart('lending'), 'all', 'australia', NOW)).toBe('standard')
})
```

(Adjust ids/geos to the fixture's real content if `land`/`lending` differ — the intent: one known stat-tile chart, one known standard chart.)

- [ ] **Step 2: Run to verify failure** — `npm test -- src/lib/rows.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — `web/src/lib/rows.ts`:

```ts
import { chartPoints } from './selectors'
import type { ChartSpec, SiteData } from './types'
import type { Geo, Range } from './urlState'

// Spec 2026-07-31 §2.1: every card has an intrinsic height class, derived from
// the same data the card renders with — never a hardcoded chart list (except
// the one structurally-unique double-panel card).
export type HeightClass = 'tile' | 'tall' | 'standard'

export function heightClassFor(site: SiteData, chart: ChartSpec, range: Range,
                               geo: Geo, now: Date): HeightClass {
  if (chart.id === 'mortgage_rates') return 'tall'
  const { lines } = chartPoints(site, chart, range, geo, now)
  // Mirror of ChartCard's isStatTile gate: data present, but no line can draw
  // a segment — the card renders as a short stat tile.
  if (lines.length > 0 && lines.every(l => l.pts.length < 2)) return 'tile'
  return 'standard'
}

export interface Row { cards: ChartSpec[]; span: boolean }

// Walks a band in registry order (§2.2): pair only same-class neighbours,
// span everything else — a mismatch, a tall card, or a trailing orphan can
// never leave a half-empty row. Reading order is untouched by construction.
export function buildRows(cards: ChartSpec[],
                          classFn: (c: ChartSpec) => HeightClass,
                          opts: { leadSpans: boolean }): Row[] {
  const rows: Row[] = []
  let i = 0
  if (opts.leadSpans && cards.length > 0) {
    rows.push({ cards: [cards[0]], span: true })
    i = 1
  }
  while (i < cards.length) {
    const cls = classFn(cards[i])
    const next = i + 1 < cards.length ? cards[i + 1] : undefined
    if (cls !== 'tall' && next && classFn(next) === cls) {
      rows.push({ cards: [cards[i], next], span: false })
      i += 2
    } else {
      rows.push({ cards: [cards[i]], span: true })
      i += 1
    }
  }
  return rows
}
```

- [ ] **Step 4: Run** — `npm test -- src/lib/rows.test.ts` → PASS.

- [ ] **Step 5: Commit** — `feat(web): height classes + order-preserving row builder`

---

### Task 9: App grid integration + ChartCard `fullWidth`/equal-height

**Files:**
- Modify: `web/src/App.tsx` (grid + context band, lines ~313-361)
- Modify: `web/src/components/ChartCard.tsx` (fullWidth prop, h-full, mortgage side-by-side, stat-tile centring, caption pinning)
- Test: `web/src/App.test.tsx` (D2e describe ~331-380 + geo-banding spans ~614-637), `web/src/components/ChartCard.test.tsx`

**Interfaces:**
- Consumes: `buildRows`/`heightClassFor` (Task 8).
- Produces: `ChartCard` accepts `fullWidth?: boolean`; when set on the mortgage card its two minis render side-by-side ≥sm (`grid gap-3 sm:grid-cols-2`), stacked otherwise. Cards are `h-full flex flex-col` with the caption row pinned to the bottom (`mt-auto pt-2`).

- [ ] **Step 1: Update the failing tests:**
  - D2e describe in `App.test.tsx` (~331-380): keep the two grid-band cases (behaviour identical under buildRows); REWRITE the "context cards never span" assertions — under the new rule the fixture's money context band (cash_rate standard, mortgage_rates tall) renders BOTH spanning: `articles[2].parentElement` and `articles[3].parentElement` each have `sm:col-span-2`. Update the describe's comment block to cite spec §2.2 (the old no-span rule is repealed).
  - Add a ChartCard test: `fullWidth` mortgage renders the two minis inside a `grid sm:grid-cols-2` container; without `fullWidth` it renders the stacked `space-y-3` container.

```tsx
test('a full-width mortgage card lays its two minis side-by-side', () => {
  render(<ChartCard site={site} chart={chart('mortgage_rates')} finding="f" fullWidth
                    range="all" geo="australia" now={NOW} onOpen={() => {}} />)
  const minis = screen.getByText('New').parentElement!.parentElement!
  expect(minis.className).toContain('sm:grid-cols-2')
})
```

- [ ] **Step 2: Run to verify failure** — `npm test -- src/App.test.tsx src/components/ChartCard.test.tsx` → FAIL.

- [ ] **Step 3: Implement.**

`App.tsx` — inside the section IIFE (after `hidden` is computed), build rows and render:

```tsx
                  const classForGrid = (c: ChartSpec) =>
                    heightClassFor(site, c, state.range, state.geo, now)
                  return (
                    <>
                      <div className="grid sm:grid-cols-2 gap-4">
                        {buildRows(healthy, classForGrid, { leadSpans: true }).flatMap(row =>
                          row.cards.map(c => (
                            <div key={c.id} className={row.span ? 'sm:col-span-2' : ''}>
                              <ChartCard site={site} chart={c} finding={site.findings[c.id]?.[state.geo] ?? ''}
                                         range={state.range} geo={state.geo} now={now}
                                         onOpen={openDetail} quietOutage={!!outageNotice}
                                         fullWidth={row.span} />
                            </div>
                          )))}
                        {dead.map(c => (
                          /* unchanged sm:col-span-2 dead rows */
                        ))}
                      </div>
                      {context.length > 0 && (
                        <div data-testid="context-band" className="mt-6">
                          <h3 className="text-xs text-faint uppercase tracking-wide mb-2">
                            Wider context</h3>
                          <div className="grid sm:grid-cols-2 gap-4">
                            {buildRows(context,
                              c => heightClassFor(site, c, state.range,
                                (c.geos[0] ?? state.geo) as typeof state.geo, now),
                              { leadSpans: false }).flatMap(row =>
                              row.cards.map(c => {
                                const own = (c.geos[0] ?? state.geo) as typeof state.geo
                                return (
                                  <div key={c.id} className={row.span ? 'sm:col-span-2' : ''}>
                                    <ChartCard site={site} chart={c}
                                               finding={site.findings[c.id]?.[own] ?? ''}
                                               range={state.range} geo={own} now={now}
                                               onOpen={openDetail} quietOutage={!!outageNotice}
                                               scopeBadge={SCOPE_BADGE[c.scope]}
                                               fullWidth={row.span} />
                                  </div>
                                )
                              }))}
                          </div>
                        </div>
                      )}
```

CRITICAL: the context band's `classFn` must use the card's OWN geo (`c.geos[0] ?? state.geo`) — the same geo the card renders with — or a context chart with no rows at `state.geo` would misclassify as a tile. Keep the existing `own`-geo comment.

Imports: `buildRows`, `heightClassFor` from `./lib/rows`; `ChartSpec` type if not already imported.

`ChartCard.tsx`:
- Props: add `fullWidth?: boolean` (document: set by App when the card occupies a spanning row; the mortgage card uses it to lay its minis side-by-side).
- Article: `className="bg-card border border-line rounded-lg p-4 h-full flex flex-col"`.
- Main button: add `flex-1 flex flex-col` and give the chart-or-body wrapper the remaining space; concretely the stat-tile body becomes:

```tsx
          <div className="flex-1 min-h-24 flex items-center justify-center">
```

- Mortgage container: `<div className={fullWidth ? 'grid gap-3 sm:grid-cols-2' : 'space-y-3'}>`.
- Both caption rows: `mt-2` → `mt-auto pt-2` (pins provenance to the card's bottom edge so paired cards' captions align).

- [ ] **Step 4: Run** — `npm test` (full sweep) → PASS, including every D2e/geo-banding update. Then `npm run build` → clean.

- [ ] **Step 5: Commit** — `feat(web): height-aware grid rows in both bands; full-width mortgage side-by-side; equal-height cards`

---

### Task 10: e2e coverage + full verification

**Files:**
- Modify: `web/e2e/smoke.spec.ts`
- Possibly: `web/src/test/fixtures/*` already carry status_note from Task 5 (e2e serves these fixtures via `e2e/serve-fixtures.js`).

**Interfaces:** none new — locks in the shipped behaviour.

- [ ] **Step 1: Add e2e tests** to `smoke.spec.ts` (follow the file's existing helpers for section-opening and reduced-motion; NOTHING here may assert a specific ageing/stale kind, since e2e `now` is the wall clock against frozen fixtures):

```ts
test('staleness chip opens a keyboard-operable explainer popover', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Rents & vacancy' }).click()
  const chip = page.getByRole('button', { name: / — why\?$/ }).first()
  await chip.focus()
  await page.keyboard.press('Enter')
  const panel = page.getByRole('group', { name: / — details$/ }).first()
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('Latest data:')
  await page.keyboard.press('Escape')
  await expect(panel).toBeHidden()
  await expect(chip).toBeFocused()
})

test('axe: no serious violations with an explainer popover open', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Rents & vacancy' }).click()
  await page.getByRole('button', { name: / — why\?$/ }).first().click()
  await expect(page.getByRole('group', { name: / — details$/ }).first()).toBeVisible()
  // reuse the file's existing settled-opacity wait + AxeBuilder pattern
  // (post-2.5 lesson: axe must never scan mid-fade)
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical'))
    .toEqual([])
})

test('wider-context band never leaves a half-empty row', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Money & credit' }).click()
  const band = page.getByTestId('context-band').first()
  // every direct child of the band's grid is either paired or spanning:
  // count children with/without the span class; an unpaired non-spanning
  // child is the void this feature removes.
  const counts = await band.locator(':scope > div.grid > div').evaluateAll(els => {
    const spans = els.filter(e => e.className.includes('col-span-2')).length
    return { total: els.length, spans }
  })
  expect((counts.total - counts.spans) % 2).toBe(0)
})
```

Also extend the MOBILE project spec (the Pixel-7 project): after opening Money & credit, the mortgage card's two mini headings ('New' and 'Outstanding') have vertically separated bounding boxes (stacked), and on desktop with the card spanning they sit side-by-side (`boundingBox()` y-overlap check). Follow the file's existing per-project `test.skip` idiom if one applies.

- [ ] **Step 2: Run e2e** — in `web\`: `npm run e2e`
Expected: all pass, both projects (26+new; project-level skips unchanged). If the popover flake-checks matter: `npx playwright test -g "explainer" --repeat-each=10` → 10/10.

- [ ] **Step 3: Full local verification (all suites):**
  - repo root: `.venv\Scripts\python.exe -m pytest tests\ -q` → all pass, 0 warnings
  - `web\`: `npm test` → all pass
  - `web\`: `npm run lint` and `npm run build` → clean
  - regenerate the real export once to prove the pipeline round-trip: `.venv\Scripts\python.exe -m pipeline.export` → validation passes (status_note flows through real data)

- [ ] **Step 4: Commit** — `test(e2e): explainer popover, axe-with-popover, band void guard`

---

### Task 11: Branch review, merge, deploy, live verification

- [ ] **Step 1:** Whole-branch code review (superpowers:requesting-code-review / the project's adversarial review workflow). Address findings.
- [ ] **Step 2:** Merge: `git checkout main; git pull --ff-only; git merge --no-ff feature/chip-popovers-and-grid; git push` — then delete the branch.
- [ ] **Step 3:** Watch CI + the "Update housing data & deploy" run on the merge push: `gh run watch` / `gh run list --limit 3` → deploy job green. (Update job skipping on a merge-push is CORRECT behaviour.)
- [ ] **Step 4:** Live verification via run conclusion + `curl` of the Pages site.json for `status_note` presence — NEVER via the local browser pane (known-broken vantage). Ask the user to eyeball the grid + a popover on their device.
