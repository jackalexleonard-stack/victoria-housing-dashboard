import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Design review P0-3: World starts collapsed on desktop, and EVERY section
// after Today starts collapsed on mobile (coarse pointer) — several tests
// below just need *some* chart DOM to exist/be clickable regardless of
// viewport, so they expand every collapsed section first rather than
// assuming the old "everything expanded by default" behaviour.
async function expandAllSections(page: Page) {
  await page.locator('nav[aria-label="Filters and sections"]').waitFor()
  const collapsed = page.locator('h2 button[aria-expanded="false"]')
  while (await collapsed.count() > 0) await collapsed.first().click()
}

test('loads the briefing with real fixture data', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Victorian Housing' })).toBeVisible()
  await expandAllSections(page)
  const charts = page.locator('article svg[role="img"]')
  expect(await charts.count()).toBeGreaterThan(10)      // chart-DOM invariant
  await expect(page.locator('article h3').first()).not.toBeEmpty() // findings non-empty
})

// --- 2.5: collapse defaults ---

test.describe('collapse defaults (2.5: closed everywhere)', () => {
  test('every themed section starts closed on both projects', async ({ page }) => {
    await page.goto('/')
    await page.locator('nav[aria-label="Filters and sections"]').waitFor()
    for (const name of ['Prices', 'Rents & vacancy', 'Supply & construction',
                        'Money & credit', 'People', 'Social housing', 'World', 'News']) {
      await expect(page.locator(`section[aria-label="${name}"] h2 button`))
        .toHaveAttribute('aria-expanded', 'false')
    }
  })

  test('a collapsed section is truly bare — heading only', async ({ page }) => {
    await page.goto('/')
    const prices = page.locator('section[aria-label="Prices"]')
    await prices.waitFor()
    expect(await prices.locator(':scope > *:not(h2)').count()).toBe(0)
  })

  test('News still lazy-mounts correctly when opened', async ({ page }) => {
    await page.goto('/')
    await page.locator('section[aria-label="News"] h2 button').click()
    await expect(page.locator('section[aria-label="News"]')
      .getByRole('button', { name: /show all \d+ stories/i })).toBeVisible()
  })
})

test('filters update the url and the charts', async ({ page }) => {
  await page.goto('/')
  // On narrow viewports the filter bar's radios live behind a "Filters"
  // disclosure button (a bottom sheet <dialog>) instead of being always
  // visible, per FilterBar.tsx's `hidden sm:flex` / `sm:hidden` split. Wait
  // for the bar to mount (data fetch is async) before checking which layout
  // is in play — isVisible() doesn't itself wait for the element to appear.
  await page.locator('nav[aria-label="Filters and sections"]').waitFor()
  const mobileFilters = page.getByRole('button', { name: 'Filters' })
  if (await mobileFilters.isVisible()) await mobileFilters.click()
  await page.getByRole('radio', { name: '1y' }).first().click()
  await expect(page).toHaveURL(/range=1y/)
})

test('section jump lands with the heading visible below the sticky bar', async ({ page }) => {
  // FilterBar is `sticky top-0` and overlaps the top of the viewport; a
  // scroll-into-view jump must leave the target heading BELOW the bar, not
  // hidden behind it. Both projects render the section chip row (it's
  // outside the `hidden sm:flex` / `sm:hidden` controls split), so this
  // holds on desktop and mobile alike.
  await page.goto('/')
  const nav = page.locator('nav[aria-label="Filters and sections"]')
  await nav.waitFor()
  // Scoped to the jump-chip row: since C1 (collapsible sections) the section
  // heading itself is now ALSO a same-named button (the disclosure toggle).
  // The chip carries its own `aria-label` ("Jump to Prices") specifically so
  // it no longer shares an accessible name with the disclosure toggle.
  await nav.getByRole('button', { name: 'Jump to Prices', exact: true }).click()
  // The jump animates (App.tsx's `jump()` only skips the animation when
  // `prefers-reduced-motion` is actually honoured, which isn't guaranteed
  // across every browser/emulation combination) — wait for window.scrollY
  // to stop moving before measuring, so this isn't a race against the
  // scroll animation still in flight.
  await page.waitForFunction(() => {
    const w = window as unknown as { __lastScrollY?: number }
    const y = window.scrollY
    if (w.__lastScrollY === y) return true
    w.__lastScrollY = y
    return false
  }, undefined, { timeout: 5000, polling: 100 }).catch(() => {})
  const heading = page.locator('section[aria-label="Prices"] h2')
  await expect(heading).toBeVisible()
  const navBox = await nav.boundingBox()
  const headingBox = await heading.boundingBox()
  expect(navBox).not.toBeNull()
  expect(headingBox).not.toBeNull()
  // The heading's top must sit at/below the bottom edge of the sticky bar —
  // i.e. not obscured behind it.
  expect(headingBox!.y).toBeGreaterThanOrEqual(navBox!.y + navBox!.height)
})

test('detail opens, deep-links and closes via back', async ({ page }) => {
  await page.goto('/')
  await expandAllSections(page)   // mobile starts every section collapsed
  await page.getByRole('button', { name: /open details/ }).first().click()
  // Anchored to the query-param boundary (?/&) rather than a bare /s=/:
  // expandAllSections (2.5) leaves a `?sections=...` param in the URL, whose
  // value legitimately contains the substring "s=" and would otherwise
  // false-match the loose regex this test used pre-2.5.
  await expect(page).toHaveURL(/[?&]s=/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/[?&]s=/)
})

test('shared deep link restores the modal', async ({ page }) => {
  await page.goto('/?s=cash_rate')
  await expect(page.getByRole('dialog')).toBeVisible()
})

test('axe scan has no serious violations', async ({ page }) => {
  await page.goto('/')
  const results = await new AxeBuilder({ page }).analyze()
  const serious = results.violations.filter(v =>
    v.impact === 'serious' || v.impact === 'critical')
  expect(serious.map(v => `${v.id}: ${v.nodes[0]?.target}`)).toEqual([])
})

// --- the four keyboard assertions ---
test('keyboard: tab reaches the filter bar radios', async ({ page }) => {
  await page.goto('/')
  // Same mobile bottom-sheet disclosure as above — open it so the radios
  // are actually in the rendered (and therefore tabbable) DOM.
  await page.locator('nav[aria-label="Filters and sections"]').waitFor()
  const mobileFilters = page.getByRole('button', { name: 'Filters' })
  if (await mobileFilters.isVisible()) await mobileFilters.click()
  await page.keyboard.press('Tab')
  for (let i = 0; i < 12; i++) {
    if (await page.evaluate(() =>
      document.activeElement?.getAttribute('role') === 'radio')) break
    await page.keyboard.press('Tab')
  }
  expect(await page.evaluate(() =>
    document.activeElement?.getAttribute('role'))).toBe('radio')
})

test('keyboard: modal traps focus and escape closes it', async ({ page }) => {
  await page.goto('/?s=cash_rate')
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  // Native <dialog>+showModal() is expected to make the rest of the document
  // inert, so repeated Tab presses should never move focus outside it.
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  const focusInside = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]')
    return !!d && d.contains(document.activeElement)
  })
  expect(focusInside).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).not.toBeVisible()
  await expect(page).not.toHaveURL(/s=/)
})

test('keyboard: charts are reachable as accessible images', async ({ page }) => {
  await page.goto('/')
  await expandAllSections(page)   // mobile starts every section collapsed
  const first = page.locator('article button').first()
  await first.focus()
  expect(await first.evaluate(el => el === document.activeElement)).toBe(true)
  await expect(page.locator('article svg[role="img"]').first())
    .toHaveAttribute('aria-label', /.+/)
})

test('keyboard/motion: reduced motion suppresses the draw-in', async ({ page }) => {
  // Both projects also declare reducedMotion: 'reduce' at the config level,
  // but that context option has been confirmed (via instrumented diagnostic
  // runs) to NOT reliably reach this page's `matchMedia` on this Playwright/
  // Chromium build — colorScheme propagates the same way and does take
  // effect, so this is specific to reducedMotion, not a general emulation
  // failure. Call emulateMedia explicitly so the emulation this test relies
  // on is actually real, not assumed from config.
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expandAllSections(page)   // mobile starts every section collapsed
  const first = page.locator('article svg[role="img"]').first()
  await first.waitFor()
  // Assert the precondition FIRST: if emulation ever silently stops working
  // again, this fails loudly with an obvious reason instead of racing on
  // IntersectionObserver timing and producing a confusing "Received: 1".
  expect(await page.evaluate(() =>
    matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  // Give the first chart's IntersectionObserver every chance to fire before
  // asserting the negative below — otherwise a pass is ambiguous between
  // "correctly suppressed" and "observer just hadn't run yet", which is
  // exactly the race that made this test flaky.
  await first.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  // LineChart's `reduced()` check must gate the class off entirely — assert
  // the DOM invariant directly rather than a CSS-derived proxy that's empty
  // either way.
  const drawInCount = await page.evaluate(() => document.querySelectorAll('.draw-in').length)
  expect(drawInCount).toBe(0)   // JS gate suppressed the animation entirely
})

// T3 acceptance test (design review P0-1): the approved lead-finding card
// must actually reach the fold. 393×852 is the owner's own phone size cited
// in the design review's evidence (offsetTop 1687 on the old build); the
// "mobile" project's Pixel 7 default (412×839) is close but not that exact
// figure, so this test pins the viewport explicitly rather than trusting
// the project default, and only runs once (under the mobile project) since
// the check is about a touch-device fold, not a breakpoint sweep.
test.describe('mobile fold: lead-finding card', () => {
  test.use({ viewport: { width: 393, height: 852 } })

  test('one full finding sentence is visible at scroll 0', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'phone-fold check, not a breakpoint sweep')
    await page.goto('/')
    const lead = page.getByTestId('lead-finding')
    await lead.waitFor()
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
    const box = await lead.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height).toBeLessThanOrEqual(852)
  })
})

// Companion to the reduced-motion test above: proves the draw-in class
// actually ships by default when motion IS allowed, so the assertion above
// can't pass simply because the feature was deleted.
test.describe('with motion enabled', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('charts animate in when motion is allowed', async ({ page }) => {
    // Mirrors the reduced-motion test: don't rely solely on the config-level
    // context option (see note above — it's not proven reliable), assert
    // the real, current state explicitly via emulateMedia + matchMedia.
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    await expandAllSections(page)   // mobile starts every section collapsed
    const first = page.locator('article svg[role="img"]').first()
    await first.waitFor()
    expect(await page.evaluate(() =>
      matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(false)
    // drawn only flips true once the IntersectionObserver reports the chart
    // in view — force that regardless of where it lands in the viewport.
    await first.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelectorAll('.draw-in').length > 0)
    const drawIn = await page.evaluate(() => document.querySelectorAll('.draw-in').length)
    expect(drawIn).toBeGreaterThan(0)
  })
})

// 2.5 headline conveyor. page.clock lets us fast-forward the 5s interval
// deterministically; install() must precede goto().
test.describe('headline conveyor', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('the lead finding advances after 5 s when motion is allowed', async ({ page }) => {
    await page.clock.install()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    const lead = page.getByTestId('lead-finding')
    await lead.waitFor()
    const before = await lead.textContent()
    await page.clock.fastForward(5100)
    await expect(lead).not.toHaveText(before!)
  })

  test('pause halts rotation', async ({ page }) => {
    await page.clock.install()
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.goto('/')
    const lead = page.getByTestId('lead-finding')
    await lead.waitFor()
    const before = await lead.textContent()
    await page.getByRole('button', { name: 'Pause rotating findings' }).click()
    await page.clock.fastForward(15000)
    await expect(lead).toHaveText(before!)
  })
})

test('reduced motion: the conveyor never auto-advances', async ({ page }) => {
  await page.clock.install()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  const lead = page.getByTestId('lead-finding')
  await lead.waitFor()
  // Loud precondition (2.2 gotcha): config-level reducedMotion is not
  // trusted — assert the page actually sees the preference.
  expect(await page.evaluate(() =>
    matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const before = await lead.textContent()
  await page.clock.fastForward(15000)
  await expect(lead).toHaveText(before!)
})

test.describe('sections personalisation (2.5)', () => {
  test('?sections= deep link opens exactly those sections', async ({ page }) => {
    await page.goto('/?sections=rents,money')
    await expect(page.locator('section[aria-label="Rents & vacancy"] h2 button'))
      .toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('section[aria-label="Money & credit"] h2 button'))
      .toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('section[aria-label="Prices"] h2 button'))
      .toHaveAttribute('aria-expanded', 'false')
  })

  test('Sections popover: open with keyboard, tick a section, Esc closes', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'Sections' }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Choose sections' })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('checkbox', { name: 'Prices' }).check()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page.locator('section[aria-label="Prices"] h2 button'))
      .toHaveAttribute('aria-expanded', 'true')
    expect(new URL(page.url()).searchParams.get('sections')).toBe('prices')
  })

  test('first-visit hint shows once and dismisses', async ({ page }) => {
    await page.goto('/')
    const hint = page.getByTestId('sections-hint')
    await expect(hint).toBeVisible()
    await hint.getByRole('button', { name: 'Dismiss' }).click()
    await expect(hint).not.toBeVisible()
    await page.reload()
    await page.locator('nav[aria-label="Filters and sections"]').waitFor()
    await expect(page.getByTestId('sections-hint')).not.toBeVisible()
  })
})
