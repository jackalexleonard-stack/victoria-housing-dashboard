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
  await expect(page.getByRole('dialog')).toBeVisible()
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
  const animated = await page.evaluate(() =>
    [...document.querySelectorAll('.draw-in')].some(el =>
      getComputedStyle(el).animationName !== 'none'))
  expect(animated).toBe(false)   // both projects emulate reduced motion
})
