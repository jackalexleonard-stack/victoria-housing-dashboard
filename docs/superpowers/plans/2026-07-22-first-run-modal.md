# First-run Section Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 2.5 dismissible first-visit hint with a blocking first-run modal that dims the dashboard and forces a section choice before entry.

**Architecture:** A new `WelcomeModal` built on a native `<dialog>` opened with `.showModal()` (native backdrop dimming, background inert, focus trap, top layer). App gates it on a genuine first visit and, on either action, applies the chosen sections through the existing unified `setAllSections` path and marks a `vh.welcomeSeen` flag so it never reappears. Because the modal blocks a cold load, all tests that assume direct dashboard access seed `vh.welcomeSeen` first via a shared bypass helper.

**Tech Stack:** React 19 + TS + Tailwind v4, Vitest + Testing Library, Playwright. Python untouched.

**Spec:** `docs/superpowers/specs/2026-07-22-first-run-modal-design.md`.

## Global Constraints

- Repo `C:\Users\OEM\Schemes\housing dashboard` (path has a space — always quote). Branch: `feature/first-run-modal` (already created; the spec is already committed on it). Run `git pull --ff-only` on `main` was done before branching — do NOT re-branch.
- Frontend commands from `web/`: `npm test` (vitest), `npm run e2e` (build + Playwright, 2 projects), `npm run build`.
- Python: never bare `python`; from repo root via PowerShell `& "C:\Users\OEM\Schemes\housing dashboard\.venv\Scripts\python.exe" -m pytest -q` (expect **142 passed, 0 warnings**; this feature never touches `pipeline/`).
- Every colour flows through `theme/tokens.{css,ts}` — no new hardcoded hexes. Interactive = `blue`, dialogs use the native-`<dialog>` idiom of `SectionsControl.tsx`.
- **No opacity/scale entrance animation on the modal** — an opacity fade is what tripped the axe scan on the conveyor; the modal must present at full contrast immediately.
- 44px coarse-pointer targets on the modal's action buttons (`pointer-coarse:py-2.5`).
- Storage keys: `vh.welcomeSeen` (new, "onboarded" flag — never cleared by Reset), `vh.sections` (`SECTIONS_KEY`), `vh.sectionsHintDismissed` (`HINT_KEY`, retained ONLY as a legacy suppressor). URL param `?sections=`.
- jsdom needs `HTMLDialogElement.prototype.showModal/close` polyfilled (done in `App.test.tsx`'s `beforeAll`; component test adds its own, as `SectionsControl.test.tsx` does).
- Commit after every task; message trailer:
  `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: WelcomeModal component

**Files:**
- Create: `web/src/components/WelcomeModal.tsx`
- Test: `web/src/components/WelcomeModal.test.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: `WelcomeModal({ sections, onEnter })` — `sections: [string, string][]` (excludes `today`, caller-filtered); `onEnter: (openIds: string[]) => void`. Opens itself on mount via `showModal()`.

- [ ] **Step 1.1: Write the failing test — create `web/src/components/WelcomeModal.test.tsx`**

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeModal } from './WelcomeModal'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  HTMLDialogElement.prototype.close ??= function () { this.open = false }
})

const SECTIONS: [string, string][] = [
  ['prices', 'Prices'], ['rents', 'Rents & vacancy'], ['money', 'Money & credit'],
]

test('opens on mount and lists every section as an unchecked checkbox', () => {
  render(<WelcomeModal sections={SECTIONS} onEnter={() => {}} />)
  expect(screen.getByRole('dialog', { name: /choose your sections/i })).toBeInTheDocument()
  for (const [, label] of SECTIONS) {
    expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
  }
})

test('"Enter dashboard" is disabled until at least one section is checked', async () => {
  render(<WelcomeModal sections={SECTIONS} onEnter={() => {}} />)
  const enter = screen.getByRole('button', { name: 'Enter dashboard' })
  expect(enter).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
  expect(enter).toBeEnabled()
})

test('"Enter dashboard" calls onEnter with exactly the checked ids', async () => {
  const onEnter = vi.fn()
  render(<WelcomeModal sections={SECTIONS} onEnter={onEnter} />)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Money & credit' }))
  await userEvent.click(screen.getByRole('button', { name: 'Enter dashboard' }))
  expect(onEnter).toHaveBeenCalledWith(['prices', 'money'])
})

test('"Show everything" is always enabled and passes all ids', async () => {
  const onEnter = vi.fn()
  render(<WelcomeModal sections={SECTIONS} onEnter={onEnter} />)
  const showAll = screen.getByRole('button', { name: 'Show everything' })
  expect(showAll).toBeEnabled()
  await userEvent.click(showAll)
  expect(onEnter).toHaveBeenCalledWith(['prices', 'rents', 'money'])
})

test('Esc (the dialog cancel event) is prevented — the modal does not close on cancel', () => {
  render(<WelcomeModal sections={SECTIONS} onEnter={() => {}} />)
  const dialog = screen.getByRole('dialog')
  const evt = new Event('cancel', { cancelable: true })
  fireEvent(dialog, evt)
  expect(evt.defaultPrevented).toBe(true)
})
```

- [ ] **Step 1.2: Run to verify it fails**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npx vitest run src/components/WelcomeModal.test.tsx
```
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement — create `web/src/components/WelcomeModal.tsx`**

```tsx
import { useEffect, useRef, useState } from 'react'

// First-run onboarding gate (spec §2): a native <dialog> opened with
// showModal() — backdrop dimming, background inert, focus containment and
// top-layer stacking are all native. It forces a section choice before the
// dashboard is usable. `onEnter` is the single commit path (App applies the
// ids through setAllSections and marks the modal seen). No entrance
// animation on purpose: an opacity fade is exactly what an axe scan reads as
// a transient contrast failure (see the conveyor deflake), so the modal is
// fully opaque from frame one.
export function WelcomeModal({ sections, onEnter }: {
  sections: [string, string][]
  onEnter: (openIds: string[]) => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  useEffect(() => { dlg.current?.showModal() }, [])
  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const checkedIds = () => sections.map(([id]) => id).filter(id => checked.has(id))
  return (
    <dialog ref={dlg} aria-labelledby="welcome-title"
            onCancel={e => e.preventDefault()}
            className="rounded-xl border border-line2 bg-card text-ink p-6 w-[min(420px,92vw)] backdrop:bg-black/70">
      <h2 id="welcome-title" className="font-display text-2xl leading-snug">
        Welcome — choose your sections</h2>
      <p className="text-sm text-muted mt-1.5 max-w-[42ch]">
        Pick the housing data you follow. Today always shows; you can change these
        anytime from the <span className="text-blue">Sections</span> control.</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-4">
        {sections.map(([id, label], i) => (
          <li key={id}>
            <label className="flex items-center gap-2 text-sm py-1 pointer-coarse:py-2.5">
              <input type="checkbox" checked={checked.has(id)} autoFocus={i === 0}
                     onChange={() => toggle(id)} />
              {label}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 mt-5">
        <button type="button" disabled={checked.size === 0}
                onClick={() => onEnter(checkedIds())}
                className="bg-blue text-bg rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
          Enter dashboard</button>
        <button type="button" onClick={() => onEnter(sections.map(([id]) => id))}
                className="text-blue border border-line rounded-md px-3 py-2.5 text-sm">
          Show everything</button>
      </div>
    </dialog>
  )
}
```
Note: `checkedIds()` derives the order from `sections`, so `onEnter` always receives ids in section-declaration order (the test asserts `['prices', 'money']`, not click order).

- [ ] **Step 1.4: Run to verify it passes**

```powershell
npx vitest run src/components/WelcomeModal.test.tsx
```
Expected: PASS (5 tests).

- [ ] **Step 1.5: Commit**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git add web/src/components/WelcomeModal.tsx web/src/components/WelcomeModal.test.tsx
git commit -m "feat(web): WelcomeModal — forced first-run section picker (native dialog)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: App gating + wiring (replace the hint)

**Files:**
- Modify: `web/src/App.tsx`
- Modify: `web/src/App.test.tsx`

**Interfaces:**
- Consumes: `WelcomeModal` (Task 1); the existing `setAllSections`, `contentSections`, `SECTIONS_KEY`, `HINT_KEY`.
- Produces: no new exports; behaviour change (modal instead of hint).

- [ ] **Step 2.1: Write the failing tests — edit `web/src/App.test.tsx`**

(a) Add a top-level seed so the many cold-load dashboard tests bypass the modal. Immediately AFTER the existing top-level `beforeAll(() => { … })` block, add:

```tsx
// The first-run modal blocks a cold load; every test that drives the
// dashboard directly seeds the "already onboarded" flag so the modal is
// suppressed. The modal's own describe clears it (see below) to see it.
beforeEach(() => { try { localStorage.setItem('vh.welcomeSeen', '1') } catch { /* ignore */ } })
```

(b) The three describes that reset storage run their `localStorage.clear()` AFTER that top-level seed, so they must re-seed. Change each of these `beforeEach` hooks:
- `describe('collapsible sections', …)` → `beforeEach(() => { localStorage.clear(); localStorage.setItem('vh.welcomeSeen', '1') })`
- `describe('default-closed sections (2.5)', …)` → same
- `describe('sections URL param (2.5)', …)` → same

(c) DELETE the entire `describe('first-visit hint (2.5)', …)` block (the modal replaces the hint).

(d) Add a new describe for the modal (note: its `beforeEach` clears WITHOUT re-seeding, so the modal shows):

```tsx
describe('first-run welcome modal', () => {
  beforeEach(() => localStorage.clear())

  const modal = () => screen.getByRole('dialog', { name: /choose your sections/i })

  test('shows on a true first visit (no saved state, no preset link)', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(modal()).toBeInTheDocument()
  })

  test.each([
    ['vh.welcomeSeen present', () => localStorage.setItem('vh.welcomeSeen', '1'), '/'],
    ['vh.sections present', () => localStorage.setItem('vh.sections', JSON.stringify({ money: 'open' })), '/'],
    ['legacy hint dismissed', () => localStorage.setItem('vh.sectionsHintDismissed', '1'), '/'],
    ['preset link', () => {}, '/?sections=money'],
  ])('suppressed when %s', async (_label, seed, url) => {
    seed()
    history.replaceState(null, '', url)
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    expect(screen.queryByRole('dialog', { name: /choose your sections/i })).not.toBeInTheDocument()
  })

  test('Enter opens exactly the checked sections, persists, and closes the modal', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(within(modal()).getByRole('checkbox', { name: 'Money & credit' }))
    await userEvent.click(within(modal()).getByRole('button', { name: 'Enter dashboard' }))
    // Section opened
    const money = screen.getByRole('region', { name: 'Money & credit' })
    expect(within(money).getByRole('button', { name: 'Money & credit' }))
      .toHaveAttribute('aria-expanded', 'true')
    // Persisted + mirrored + marked seen
    expect(localStorage.getItem('vh.welcomeSeen')).toBe('1')
    expect(new URLSearchParams(location.search).get('sections')).toBe('money')
    // Modal gone
    expect(screen.queryByRole('dialog', { name: /choose your sections/i })).not.toBeInTheDocument()
  })

  test('Show everything opens all themed sections, persists, and closes', async () => {
    history.replaceState(null, '', '/')
    mockFetch()
    render(<App now={new Date('2026-07-18T10:00:00Z')} />)
    await screen.findByText('Victorian Housing')
    await userEvent.click(within(modal()).getByRole('button', { name: 'Show everything' }))
    for (const name of ['Prices', 'Money & credit', 'World', 'News']) {
      const s = screen.getByRole('region', { name })
      expect(within(s).getByRole('button', { name })).toHaveAttribute('aria-expanded', 'true')
    }
    expect(localStorage.getItem('vh.welcomeSeen')).toBe('1')
    expect(screen.queryByRole('dialog', { name: /choose your sections/i })).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2.2: Run to verify failure**

```powershell
npx vitest run src/App.test.tsx
```
Expected: the new modal tests FAIL (no modal yet); the old hint describe is gone.

- [ ] **Step 2.3: Implement — `web/src/App.tsx` gating**

Add the import at the top with the other component imports:

```tsx
import { WelcomeModal } from './components/WelcomeModal'
```

Below `const HINT_KEY = 'vh.sectionsHintDismissed'` add:

```tsx
const WELCOME_KEY = 'vh.welcomeSeen'
```

Replace the `hintVisible` `useState` initializer and `dismissHint` (currently ~lines 117–127) with:

```tsx
  // First-run modal gate (spec §3): show only on a genuine first visit —
  // no saved section state, no preset link, and not already onboarded
  // (WELCOME_KEY, or the legacy 2.5 hint's HINT_KEY — a user who dismissed
  // that hint must not be re-onboarded). Same order-dependency as before:
  // this read must run after the `overrides` initializer's vh.collapsed ->
  // vh.sections migration side effect.
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) == null &&
        localStorage.getItem(SECTIONS_KEY) == null &&
        localStorage.getItem(HINT_KEY) == null &&
        new URLSearchParams(location.search).get('sections') == null
    } catch { return false }
  })
```

Where `applySections`/`setAllSections`/`resetSections` are defined (after `const { site, news } = data` and `contentSections`), add the commit handler right after `resetSections`:

```tsx
  const enterFromWelcome = (openIds: string[]) => {
    setAllSections(openIds)
    try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* ignore */ }
    setShowWelcome(false)
  }
```

Delete the hint render block (the `{hintVisible && ( <p data-testid="sections-hint" …/> )}`). Add the modal render just before the `{detailChart && ( <DetailView … /> )}` block near the end of `<main>`:

```tsx
      {showWelcome && (
        <WelcomeModal sections={contentSections} onEnter={enterFromWelcome} />
      )}
```

- [ ] **Step 2.4: Run to verify pass**

```powershell
npx vitest run src/App.test.tsx
npm test
```
Expected: all PASS. Then `npm run build` — must be clean (no dangling `hintVisible`/`dismissHint`/`sections-hint` references; grep to be sure):

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard"
git grep -n "hintVisible\|dismissHint\|sections-hint" -- web/src
```
Expected: **zero hits**.

- [ ] **Step 2.5: Commit**

```powershell
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): gate the first-run modal, retire the dismissible hint

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: E2E bypass + modal e2es + full verification

**Files:**
- Modify: `web/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the testids/labels from Tasks 1–2 (dialog name "choose your sections", "Enter dashboard", "Show everything").
- Produces: green `npm run e2e` across both projects.

- [ ] **Step 3.1: Add the dashboard bypass helper**

Near the top of `web/e2e/smoke.spec.ts` (beside the existing `expandAllSections` helper), add:

```ts
// The first-run modal blocks a cold load. Every test that drives the
// dashboard navigates through this helper, which seeds the "already
// onboarded" flag BEFORE any page script runs (addInitScript), so the modal
// is suppressed. The modal's own tests navigate with a plain page.goto to
// see it.
async function gotoDashboard(page: import('@playwright/test').Page, url = '/') {
  await page.addInitScript(() => {
    try { localStorage.setItem('vh.welcomeSeen', '1') } catch { /* ignore */ }
  })
  await page.goto(url)
}
```

- [ ] **Step 3.2: Route dashboard tests through the helper**

Replace every `await page.goto('/')` and `await page.goto('/?...')` in the EXISTING tests (the collapse-defaults, conveyor, jump, axe, keyboard, and `sections personalisation` describes, and the top-level tests) with `await gotoDashboard(page, '<same url>')` — e.g. `await page.goto('/')` → `await gotoDashboard(page)`, and `await page.goto('/?sections=rents,money')` → `await gotoDashboard(page, '/?sections=rents,money')`.

Do NOT convert the two navigations inside the modal describe you add in Step 3.4 (those must stay plain `page.goto` to see the modal). The `?sections=` deep-link test already suppresses the modal via its URL param, but route it through `gotoDashboard` too for uniformity (the seed is harmless alongside the param).

- [ ] **Step 3.3: Delete the old hint e2e**

Remove the `test('first-visit hint shows once and dismisses', …)` test from the `sections personalisation (2.5)` describe.

- [ ] **Step 3.4: Add the modal e2es**

Append a new describe:

```ts
test.describe('first-run welcome modal', () => {
  test('blocks a cold load; Show everything enters and does not re-show on reload', async ({ page }) => {
    await page.goto('/')   // plain: no bypass, so the modal appears
    const dialog = page.getByRole('dialog', { name: /choose your sections/i })
    await expect(dialog).toBeVisible()
    // Background is inert: a section heading behind the modal isn't clickable.
    await expect(dialog.getByRole('button', { name: 'Enter dashboard' })).toBeDisabled()
    await dialog.getByRole('button', { name: 'Show everything' }).click()
    await expect(dialog).not.toBeVisible()
    // Every themed section is now open.
    await expect(page.locator('section[aria-label="Prices"] h2 button'))
      .toHaveAttribute('aria-expanded', 'true')
    // Reload: onboarded, so no modal.
    await page.reload()
    await page.locator('nav[aria-label="Filters and sections"]').waitFor()
    await expect(page.getByRole('dialog', { name: /choose your sections/i })).not.toBeVisible()
  })

  test('Enter opens exactly the chosen section and Esc cannot skip', async ({ page }) => {
    await page.goto('/')
    const dialog = page.getByRole('dialog', { name: /choose your sections/i })
    await expect(dialog).toBeVisible()
    // Esc does not dismiss a required dialog.
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: 'Money & credit' }).check()
    await dialog.getByRole('button', { name: 'Enter dashboard' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('section[aria-label="Money & credit"] h2 button'))
      .toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('section[aria-label="Prices"] h2 button'))
      .toHaveAttribute('aria-expanded', 'false')
    expect(new URL(page.url()).searchParams.get('sections')).toBe('money')
  })

  test('the modal itself has no serious axe violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('dialog', { name: /choose your sections/i })).toBeVisible()
    // Scope axe to the OPEN dialog only (dialog[open] = the welcome modal;
    // the SectionsControl popover dialog is closed/display:none). This keeps
    // the dashboard CONVEYOR — which is fading in behind the modal on this
    // un-reduced, un-settled load — out of the scan, so the test measures the
    // modal's own contrast without re-inheriting the conveyor-fade race the
    // dashboard axe test guards against separately.
    const results = await new AxeBuilder({ page }).include('dialog[open]').analyze()
    const serious = results.violations.filter(v =>
      v.impact === 'serious' || v.impact === 'critical')
    expect(serious.map(v => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([])
  })
})
```

- [ ] **Step 3.5: Run everything**

```powershell
cd "C:\Users\OEM\Schemes\housing dashboard\web"
npm test
npm run e2e
cd "C:\Users\OEM\Schemes\housing dashboard"
& ".\.venv\Scripts\python.exe" -m pytest -q
```
Expected: vitest green; Playwright green on both projects (the existing count minus the deleted hint test, plus the new modal tests); pytest **142 passed, 0 warnings**. If an existing dashboard test now fails because it still hits the modal, it means a `page.goto` was missed in Step 3.2 — convert it to `gotoDashboard` and re-run. The dashboard axe test must stay green (it scans the dashboard via the bypass); the new modal axe test scans the modal.

- [ ] **Step 3.6: Commit**

```powershell
git add web/e2e/smoke.spec.ts
git commit -m "test(e2e): bypass helper for the first-run modal + modal coverage (block, enter, esc, axe)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

## Completion

After Task 3 is green: whole-branch review, then merge to `main` (which redeploys via `update.yml`). Post-deploy, live-verify on the production URL via the user's device (this machine's browser pane can't reach the Pages edge reliably).
