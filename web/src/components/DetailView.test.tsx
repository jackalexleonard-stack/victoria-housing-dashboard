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
