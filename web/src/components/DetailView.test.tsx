import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from '../lib/types'
import { PALETTE } from '../theme/tokens'
import { DetailView } from './DetailView'

const site = assertSiteData(siteEdge)
const NOW = new Date('2026-07-18T00:00:00Z')
const chart = site.charts.find(c => c.id === 'cash_rate')!

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  HTMLDialogElement.prototype.close ??= function () { this.open = false }
})

function renderView(over: Partial<Parameters<typeof DetailView>[0]> = {}) {
  const onClose = vi.fn(); const onCompare = vi.fn()
  render(<DetailView site={site} chart={chart} finding="The cash rate held"
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={onClose} onCompare={onCompare} {...over} />)
  return { onClose, onCompare }
}

test('shows provenance and stat block', () => {
  renderView()
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('The cash rate held')
  expect(screen.getByText('RBA F1.1')).toHaveAttribute('href', 'https://rba.gov.au')
  expect(screen.getByText(/Data to Jun 2026/)).toBeInTheDocument()
  expect(screen.getByText(/next update ~/)).toBeInTheDocument()
})

test('close button fires onClose', async () => {
  const { onClose } = renderView()
  await userEvent.click(screen.getByRole('button', { name: /close/i }))
  expect(onClose).toHaveBeenCalled()
})

test('copy link writes the current url and confirms', async () => {
  const write = vi.fn().mockResolvedValue(undefined)
  Object.assign(navigator, { clipboard: { writeText: write } })
  renderView()
  await userEvent.click(screen.getByRole('button', { name: /copy link/i }))
  expect(write).toHaveBeenCalledWith(location.href)
  expect(await screen.findByText(/copied/i)).toBeInTheDocument()
})

test('download csv builds a blob from the visible lines', async () => {
  const spy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
  renderView()
  await userEvent.click(screen.getByRole('button', { name: /download csv/i }))
  const blob = spy.mock.calls[0][0] as Blob
  expect(await blob.text()).toContain('date,series,value')
  expect(await blob.text()).toContain('2026-06-30')
  spy.mockRestore()
})

test('compare picker offers other charts', async () => {
  const { onCompare } = renderView()
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /compare/i }),
                                'median_rent')
  expect(onCompare).toHaveBeenCalledWith('median_rent')
})

test('failed series surfaces the raw source error', () => {
  const auctions = site.charts.find(c => c.id === 'auctions')!
  render(<DetailView site={site} chart={auctions} finding="No recent data — source currently unavailable"
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  // The finding text ("No recent data — source currently unavailable") is
  // also shown verbatim in the fallback <p> below the missing chart, so
  // scope the query to that paragraph to avoid matching the <h2> too.
  expect(screen.getByText(/source currently unavailable/i, { selector: 'p' })).toBeInTheDocument()
  expect(screen.getByText('HTTPError')).toBeInTheDocument()
})

// --- design review d2: per-chart FRED source_name override ---

test('a chart-level source_name override shows in the modal instead of the series’ shared meta.source_name', () => {
  const mutated = JSON.parse(JSON.stringify(siteEdge))
  mutated.charts.push({
    id: 'brent_test', section: 'world', title: 'Brent crude',
    series_id: 'au_cash_rate', metrics: ['cash_rate'], region_mode: 'fixed:australia',
    scope: 'national', geos: ['australia'],
    percent: true, markers: false, annotate: false, note: null, modal_metrics: null,
    source_name: 'FRED — Brent crude (DCOILBRENTEU)',
  })
  mutated.findings.brent_test = { melbourne: 'f' }
  const s = assertSiteData(mutated)
  const brentChart = s.charts.find(c => c.id === 'brent_test')!
  render(<DetailView site={s} chart={brentChart} finding="f"
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  const link = screen.getByText('FRED — Brent crude (DCOILBRENTEU)')
  expect(link).toHaveAttribute('href', 'https://rba.gov.au')
  expect(screen.queryByText('RBA F1.1')).not.toBeInTheDocument()
})

test('chart note renders as a muted line near the provenance block', () => {
  renderView()
  expect(screen.getByText('Test note.')).toBeInTheDocument()
})

test('chart without a note renders no note line', () => {
  const medianRentChart = site.charts.find(c => c.id === 'median_rent')!
  render(<DetailView site={site} chart={medianRentChart} finding="f"
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  expect(screen.queryByText('Test note.')).not.toBeInTheDocument()
})

test('compare series formats with its own unit, not the primary chart’s', async () => {
  renderView({ compare: 'median_rent' })
  await userEvent.click(screen.getByText(/view data table/i))
  expect(screen.getByText('$580')).toBeInTheDocument()
})

// Spec 2026-08-03 §4: a compare overlay pulled from a DIFFERENT geography
// than the modal's own must say so everywhere its name appears (legend,
// tooltip, data table, CSV) — otherwise it reads as same-place data.
test('a compare line from a different region gets suffixed with that region, everywhere its name appears', async () => {
  // Primary is geo-scoped (median_rent, region_mode 'geo') opened at
  // melbourne -> modalRegion 'melbourne'. Compare is fixed:australia
  // (cash_rate) -> modalRegion 'australia'. Different regions.
  const medianRentChart = site.charts.find(c => c.id === 'median_rent')!
  render(<DetailView site={site} chart={medianRentChart} finding="f"
                     range="all" geo="melbourne" compare="cash_rate" now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  await userEvent.click(screen.getByText(/view data table/i))
  // Scoped to the data table: the compare <select> also has a bare
  // "RBA cash rate target" <option>, unrelated to this suffix logic.
  const table = screen.getByRole('table')
  expect(within(table).getByText('RBA cash rate target — Australia')).toBeInTheDocument()
  expect(within(table).queryByText('RBA cash rate target')).not.toBeInTheDocument()
})

test('a compare line from the SAME region as the primary stays bare (no suffix)', async () => {
  // cash_rate (fixed:australia) as primary, mortgage_rates (also
  // fixed:australia) as compare -> both resolve to 'australia'.
  renderView({ compare: 'mortgage_rates' })
  await userEvent.click(screen.getByText(/view data table/i))
  // Scoped to the data table: the compare <select> also has an <option>
  // reading "Mortgage rates (owner-occupier)", so an unscoped query is
  // ambiguous.
  const table = screen.getByRole('table')
  expect(within(table).getByText('Mortgage rates (owner-occupier)')).toBeInTheDocument()
  expect(within(table).queryByText(/Mortgage rates \(owner-occupier\) —/)).not.toBeInTheDocument()
})

test('the modal keeps the FULL annotation set (both cash-rate moves), unlike the card\'s single latest-move label', () => {
  // Fixture's cash_rate_moves is [2026-02-28 +0.25, 2026-04-30 -0.25] — the
  // modal (annotationMode="full") must show BOTH as solid clay marker
  // lines, in contrast to ChartCard's 'latest-label' mode (see
  // ChartCard.test.tsx), which shows only the most recent one.
  renderView()
  const clayLines = [...document.querySelectorAll('line')]
    .filter(l => l.getAttribute('stroke') === PALETTE.clay)
  expect(clayLines.length).toBe(2)
  expect(document.querySelectorAll('line[stroke-dasharray]').length).toBe(0)  // solid, not dashed
})

// Design review P1-touch: the action row (Download CSV / Copy link /
// Source / Compare select) was px-3 py-1.5 (~30px tall), below the
// project's 44px mandate. pointer-coarse: is a static CSS-variant class
// (Tailwind's `pointer-coarse:` -> `@media (pointer: coarse)`) present in
// the same markup for every device — no matchMedia branch to stub here, so
// one render confirms both the coarse-pointer bump and that fine-pointer/
// desktop sizing is untouched.
test('the action row and compare select get a coarse-pointer touch-size bump; fine-pointer sizing is untouched', () => {
  renderView()
  const download = screen.getByRole('button', { name: /download csv/i })
  const copy = screen.getByRole('button', { name: /copy link/i })
  const source = screen.getByRole('link', { name: /source/i })
  for (const el of [download, copy, source]) {
    expect(el).toHaveClass('text-xs', 'border', 'border-line', 'rounded-md', 'px-3', 'py-1.5')  // unchanged
    expect(el).toHaveClass('pointer-coarse:px-4', 'pointer-coarse:py-3.5')
  }
  const select = screen.getByRole('combobox', { name: /compare/i })
  expect(select).toHaveClass('border', 'border-line', 'rounded-md', 'px-2', 'py-1', 'bg-card')  // unchanged
  expect(select).toHaveClass('pointer-coarse:px-3', 'pointer-coarse:py-3.5')
})

// Design review P1-touch (T6 item 7): the inline range control (All/1Y/etc.)
// gets the same coarse-pointer bump as this component's own action row,
// using the identical classes for consistency. Same static-class rationale
// as the action-row test above — no matchMedia stub needed.
test('the inline range control gets the same coarse-pointer touch-size bump as the action row', () => {
  renderView()
  const radios = screen.getAllByRole('radio')
  expect(radios.length).toBeGreaterThan(0)
  for (const r of radios) {
    expect(r).toHaveClass('px-2.5', 'py-1', 'text-xs', 'num')   // unchanged
    expect(r).toHaveClass('pointer-coarse:px-4', 'pointer-coarse:py-3.5')
  }
})

// --- Fix batch (2026-08-03): no geography claim for unknown-coverage dead
// charts; dead-modal headline falls back to the chart title; aria suffix
// dedupe against a title that already ends with the region. ---

test('a dead chart with unknown geo coverage (region_mode geo, geos []) shows NO region chip and its dialog name is the bare title', () => {
  // Shaped like the real reiv_median chart (site.real.json): region_mode
  // 'geo' with geos: [] means coverage is genuinely unknown — bandFor's own
  // dead-chart override renders it at EVERY geo, precisely BECAUSE we don't
  // know where it belongs, not because it's confirmed to cover whatever geo
  // happens to be selected. Reuses vic_auctions (an existing failed series
  // in this fixture) as the series_id so isDeadChart's isBrokenSource half
  // is satisfied without inventing a new series entry.
  const mutated = JSON.parse(JSON.stringify(siteEdge))
  mutated.charts.push({
    id: 'reiv_test', section: 'prices', title: 'REIV quarterly medians',
    series_id: 'vic_auctions', metrics: null, region_mode: 'geo',
    scope: 'geo', geos: [], percent: false, markers: false, annotate: false,
    note: null, modal_metrics: null,
  })
  const s = assertSiteData(mutated)
  const reivChart = s.charts.find(c => c.id === 'reiv_test')!
  // No findings.reiv_test entry — mirrors App's own `?? ''` fallback for a
  // dead chart, whose findings are genuinely {}.
  render(<DetailView site={s} chart={reivChart} finding=""
                     range="all" geo="vic" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  // Mutant-honest: were the gate removed, region_mode 'geo' would resolve
  // modalRegion to the requested geo ('vic' -> REGION_BADGE 'Victoria-wide')
  // and both of these would fail.
  expect(screen.getByRole('dialog')).toHaveAccessibleName('REIV quarterly medians')
  expect(screen.queryByText('Victoria-wide')).not.toBeInTheDocument()
})

test('the dead-chart modal headline falls back to the chart title when there is no finding', () => {
  // auctions is region_mode fixed:melbourne with geos: [] — a dead chart
  // whose findings entry is {} in this fixture (App would pass finding=''
  // for it), so the old code rendered a blank <h2>.
  const auctions = site.charts.find(c => c.id === 'auctions')!
  render(<DetailView site={site} chart={auctions} finding=""
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Auction clearance — Melbourne')
})

test('a fixed-region chart whose title already ends with " — <Region>" gets no doubled aria suffix, but its chip still renders', () => {
  // auctions' title is "Auction clearance — Melbourne" and its region_mode
  // is fixed:melbourne (NOT geo-mode, so the unknown-coverage gate above
  // does not apply here) — the chip still names Melbourne, but the aria
  // suffix must not repeat it a second time.
  const auctions = site.charts.find(c => c.id === 'auctions')!
  render(<DetailView site={site} chart={auctions} finding=""
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  expect(screen.getByRole('dialog')).toHaveAccessibleName('Auction clearance — Melbourne')
  expect(screen.getByText('Melbourne')).toBeInTheDocument()
})

test('stat block formats the primary line with its own metric unit on a mixed-unit series', () => {
  // Same fixture quirk as ChartCard's test: vic_rents declares
  // rent_growth_annual (percent) before median_rent (aud) in its units map.
  // The median_rent chart's stat block ("Latest") must still read as a
  // dollar figure, not the series' first-declared unit.
  const medianRentChart = site.charts.find(c => c.id === 'median_rent')!
  render(<DetailView site={site} chart={medianRentChart} finding="The median rent held at $580/wk"
                     range="all" geo="melbourne" compare={null} now={NOW}
                     onClose={() => {}} onCompare={() => {}} />)
  const latest = screen.getByText('Latest').closest('div')!
  expect(within(latest).getByText('$580')).toBeInTheDocument()
})
