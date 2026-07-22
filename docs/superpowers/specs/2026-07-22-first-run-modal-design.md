# First-run section modal — design

**Date:** 2026-07-22 · **Status:** design approved (user), pending build
**Supersedes:** the 2.5 dismissible first-visit hint (`vh.sectionsHintDismissed` `<p>` line).

## 1. Context

2.5 shipped a non-blocking hint under the Today block pointing new visitors at the Sections
control. User feedback: make onboarding a **real blocking modal** that dims the dashboard and
**forces a section choice before entry**, rather than a suggestion hidden below the fold.

This deliberately overrides the 2.5 research (which favoured non-blocking onboarding: ~70% skip
wizards, no statistics portal forces one). Mitigation: the modal shows **exactly once ever** per
user, and always offers a one-click way through ("Show everything"), so daily users are never
re-gated and no one is trapped.

Non-goals: no change to the Sections popover, the `?sections=` URL param, section defaults, or any
other 2.5 behaviour. This swaps the hint for a modal and adds its gating; everything downstream of
"apply these open sections" is reused unchanged.

## 2. Component

New `web/src/components/WelcomeModal.tsx` — a native `<dialog>` opened imperatively with
`.showModal()` (via a ref + effect on mount). `showModal()` provides, natively: the dimmed
`::backdrop`, background inert-ing (no scroll/click behind), focus containment, and top-layer
stacking. Same native-`<dialog>` family as `SectionsControl`.

Props: `{ sections: [string, string][]; onEnter: (openIds: string[]) => void }` — `sections`
excludes `today` (filtered by the caller). `onEnter` is the single commit callback (App wires it
to "apply selection + mark seen").

Content (see mockup):
- Heading (`font-display`, `id` referenced by the dialog's `aria-labelledby`): "Welcome — choose
  your sections".
- Intro line: "Pick the housing data you follow. Today always shows; you can change these anytime
  from the Sections control." ("Sections" styled `text-blue`.)
- A checkbox per themed section (2-col grid on desktop, 1-col mobile), all **unchecked** by default
  (the user is choosing in; pre-checking would presume). Wrapping `<label>` per checkbox.
- Actions:
  - **Enter dashboard** — primary; `disabled` until ≥1 box is checked; calls `onEnter(checkedIds)`.
  - **Show everything** — secondary; always enabled; calls `onEnter(allIds)`.
- No opacity/scale entrance animation (deliberate — an opacity fade is exactly what tripped the
  axe scan on the conveyor; the modal must present at full contrast immediately).

Accessibility:
- `aria-labelledby` → heading id; native `<dialog role="dialog" aria-modal>` semantics from
  `showModal()`.
- Focus starts inside the modal (first checkbox carries `autofocus`; the Enter button starts
  disabled so it can't be the initial focus).
- **Esc must not skip the choice:** intercept the dialog's `cancel` event and `preventDefault()`
  it, so Esc cannot close the modal without a decision. Not a keyboard trap: Tab cycles within the
  dialog and both action buttons are keyboard-reachable, which is the WCAG-sanctioned dismissal
  mechanism for a required dialog.
- No backdrop-click-to-close (native `<dialog>` doesn't close on backdrop click by default — do
  not add a handler that does).
- 44px coarse-pointer targets on the two action buttons (matches spec-wide touch rule).

## 3. Gating & persistence (App.tsx)

Replace the `hintVisible`/`dismissHint`/hint-`<p>` block. New:

- `const WELCOME_KEY = 'vh.welcomeSeen'`.
- Show the modal iff a genuine first visit — computed once (try/catch → false on throw):
  ```
  localStorage.getItem(WELCOME_KEY) == null &&
  localStorage.getItem(SECTIONS_KEY) == null &&
  localStorage.getItem(HINT_KEY) == null &&           // legacy 2.5 hint = already onboarded
  new URLSearchParams(location.search).get('sections') == null
  ```
  (`HINT_KEY` = `vh.sectionsHintDismissed` is retained ONLY as a legacy suppressor so a user who
  already dismissed the 2.5 hint isn't re-onboarded. The hint UI and `dismissHint` are removed.)
- `enterFromWelcome(openIds: string[])`: `setAllSections(openIds)` (reuses the unified write path —
  overrides + localStorage + `?sections=` mirror), then `localStorage.setItem(WELCOME_KEY, '1')`
  (try/catch), then hide the modal. Because `WELCOME_KEY` is separate from `SECTIONS_KEY`, the
  Sections popover "Reset" (which removes `SECTIONS_KEY`) does **not** re-trigger the modal.
- The modal renders after the data-loaded guard (it needs `site.sections`), replacing where the
  hint `<p>` was. Order-dependency note (kept): the first-visit read must stay declared after the
  `overrides` initializer so the `vh.collapsed → vh.sections` migration has already run.

`Enter` with a subset opens exactly those; `Show everything` passes all themed ids. Both routes are
a real choice, so both mark `WELCOME_KEY` — the modal never reappears.

## 4. Testing

The modal blocks a cold load, so **every test that loads the app fresh must bypass it**:
- Shared helper (vitest `App.test.tsx` and e2e): pre-seed `localStorage['vh.welcomeSeen'] = '1'`
  before mount/navigation, so existing dashboard tests exercise the dashboard directly. e2e uses an
  `addInitScript` (runs before page scripts) to seed it; the modal-specific e2es omit the seed.
- Delete the old hint tests (`first-visit hint (2.5)` describe in `App.test.tsx`; the e2e hint
  test).

New `WelcomeModal` coverage (vitest component test + App-level integration + e2e):
- Shows on a true first visit (no seed); **suppressed** when any of `vh.welcomeSeen` /
  `vh.sections` / `vh.sectionsHintDismissed` present, or `?sections=` in the URL.
- "Enter dashboard" is disabled with 0 checked, enabled at ≥1; clicking it opens exactly the
  checked sections, writes `vh.sections` + `?sections=` + `vh.welcomeSeen`, and closes the modal.
- "Show everything" opens all themed sections and closes; marks seen.
- Reload after entering does not re-show (e2e).
- Esc does not close the modal (the `cancel` preventDefault) — assert it stays open.
- jsdom polyfills `HTMLDialogElement.showModal/close` (already done in `App.test.tsx`); the
  component test adds its own `beforeAll` polyfill (as `SectionsControl.test.tsx` does).

All suites stay green: vitest, Playwright (both projects), pytest untouched, build + axe clean.

## 5. Rejected / deferred

- Pre-checking some sections by default — rejected (presumes the choice the modal exists to elicit).
- Backdrop-click or Esc to skip — rejected (defeats "forces a choice"); "Show everything" is the
  fast path instead.
- A welcome/explainer step beyond the section picker — out of scope (YAGNI).
