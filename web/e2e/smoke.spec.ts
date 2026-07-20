import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('loads the briefing with real fixture data', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Victorian Housing' })).toBeVisible()
  const charts = page.locator('article svg[role="img"]')
  expect(await charts.count()).toBeGreaterThan(10)      // chart-DOM invariant
  await expect(page.locator('article h3').first()).not.toBeEmpty() // findings non-empty
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
  await page.getByRole('button', { name: 'Prices', exact: true }).click()
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
  await page.getByRole('button', { name: /open details/ }).first().click()
  await expect(page).toHaveURL(/s=/)
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.goBack()
  await expect(page).not.toHaveURL(/s=/)
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
  const first = page.locator('article button').first()
  await first.focus()
  expect(await first.evaluate(el => el === document.activeElement)).toBe(true)
  await expect(page.locator('article svg[role="img"]').first())
    .toHaveAttribute('aria-label', /.+/)
})

test('keyboard/motion: reduced motion suppresses the draw-in', async ({ page }) => {
  await page.goto('/')
  await page.locator('article svg[role="img"]').first().waitFor()
  // Both projects emulate reducedMotion: 'reduce', so LineChart's `reduced()`
  // check must gate the class off entirely — assert the DOM invariant
  // directly rather than a CSS-derived proxy that's empty either way.
  const drawInCount = await page.evaluate(() => document.querySelectorAll('.draw-in').length)
  expect(drawInCount).toBe(0)   // JS gate suppressed the animation entirely
})

// Companion to the reduced-motion test above: proves the draw-in class
// actually ships by default when motion IS allowed, so the assertion above
// can't pass simply because the feature was deleted.
test.describe('with motion enabled', () => {
  test.use({ reducedMotion: 'no-preference' })

  test('charts animate in when motion is allowed', async ({ page }) => {
    await page.goto('/')
    const first = page.locator('article svg[role="img"]').first()
    await first.waitFor()
    // drawn only flips true once the IntersectionObserver reports the chart
    // in view — force that regardless of where it lands in the viewport.
    await first.scrollIntoViewIfNeeded()
    await page.waitForFunction(() => document.querySelectorAll('.draw-in').length > 0)
    const drawIn = await page.evaluate(() => document.querySelectorAll('.draw-in').length)
    expect(drawIn).toBeGreaterThan(0)
  })
})
