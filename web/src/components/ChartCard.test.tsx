import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from '../lib/types'
import { PALETTE } from '../theme/tokens'
import { ChartCard } from './ChartCard'

const site = assertSiteData(siteEdge)
const NOW = new Date('2026-07-18T00:00:00Z')
const chart = (id: string) => site.charts.find(c => c.id === id)!

beforeAll(() => {
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} unobserve() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
})

test('leads with the finding and opens on click', async () => {
  const onOpen = vi.fn()
  render(<ChartCard site={site} chart={chart('cash_rate')}
                    finding="The cash rate has held at 3.85% since Jan 2026"
                    range="all" geo="melbourne" now={NOW} onOpen={onOpen} />)
  expect(screen.getByRole('heading', { level: 3 }))
    .toHaveTextContent('The cash rate has held at 3.85% since Jan 2026')
  await userEvent.click(screen.getByRole('button', { name: /cash rate/i }))
  expect(onOpen).toHaveBeenCalledWith('cash_rate')
})

// --- P1-outage / 2026-07-24 banner batch: dead charts compact to a single
// full-width outage row (no triple-repeated placeholder, no wasted card) ---
// Task 5: the row is now a <div data-testid="outage-row"> containing TWO
// sibling buttons — a title/body button that opens the modal, and the
// clickable StatusChip (Task 4) — never a chip nested inside the row's own
// button (a <button> can't legally contain another <button>).

test('a dead chart (failed, no historical geo coverage) renders as a compact outage row — no chart area', () => {
  const auctionsChart = chart('auctions')
  render(<ChartCard site={site} chart={auctionsChart}
                    finding="No recent data — source currently unavailable"
                    range="5y" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const row = screen.getByTestId('outage-row')
  expect(row.tagName).toBe('DIV')
  expect(within(row).queryByRole('img')).not.toBeInTheDocument()      // no chart svg
  expect(within(row).getByText(/Auction clearance/)).toBeInTheDocument()
  // Headlines the series name — the generic finding sentence never renders
  // (P1-outage: no triple-repeated "source unavailable" placeholder).
  expect(within(row).queryByText('No recent data — source currently unavailable'))
    .not.toBeInTheDocument()
})

test('the outage row is a title/body button and a SEPARATE chip button — never nested', () => {
  const auctionsChart = chart('auctions')
  render(<ChartCard site={site} chart={auctionsChart} finding="f" range="5y"
                    geo="melbourne" now={NOW} onOpen={() => {}} />)
  const row = screen.getByTestId('outage-row')
  const titleBtn = within(row).getByRole('button', { name: `${auctionsChart.title} — open details` })
  const chipBtn = within(row).getByRole('button', { name: 'No data · source unavailable — why?' })
  expect(titleBtn).not.toBe(chipBtn)
  // A <button> can never legally nest another <button> — assert the chip's
  // nearest button ancestor is itself, not the title/body button.
  expect(chipBtn.closest('button')).toBe(chipBtn)
  expect(titleBtn.contains(chipBtn)).toBe(false)
})

test('the outage row title/body button opens the detail modal, keyboard-reachable like every other card', async () => {
  const onOpen = vi.fn()
  const auctionsChart = chart('auctions')
  render(<ChartCard site={site} chart={auctionsChart} finding="" range="5y"
                    geo="melbourne" now={NOW} onOpen={onOpen} />)
  const row = screen.getByTestId('outage-row')
  await userEvent.click(
    within(row).getByRole('button', { name: `${auctionsChart.title} — open details` }))
  expect(onOpen).toHaveBeenCalledWith(auctionsChart.id)
})

test('a dead chart shows one honest, source-specific body line from the pipeline status_note — not the generic sentence repeated', () => {
  render(<ChartCard site={site} chart={chart('auctions')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(within(screen.getByTestId('outage-row'))
    .getByText(/Melbourne auction results aren.t reachable/i, { selector: 'span' })).toBeInTheDocument()
})

test('the outage row still surfaces a failure chip, but no table toggle (no data to tabulate)', () => {
  render(<ChartCard site={site} chart={chart('auctions')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByRole('button', { name: 'No data · source unavailable — why?' }))
    .toBeInTheDocument()
  expect(screen.queryByText(/view data table/i)).not.toBeInTheDocument()
})

test('caption chip opens the explainer without opening the modal', async () => {
  const onOpen = vi.fn()
  const stale = new Date('2027-01-01T00:00:00Z')
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f"
                    range="all" geo="melbourne" now={stale} onOpen={onOpen} />)
  await userEvent.click(screen.getByRole('button', { name: /· stale — why\?$/ }))
  expect(screen.getByRole('group', { name: 'Stale data — details' })).toBeInTheDocument()
  expect(onOpen).not.toHaveBeenCalled()
})

test('data table disclosure exposes the values', async () => {
  render(<ChartCard site={site} chart={chart('cash_rate')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  await userEvent.click(screen.getByText(/view data table/i))
  expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
})

test.skip('scope chip appears when geo falls back', () => {
  // Task 3 deleted the FALLBACK substitution this asserted (audit D2). Rewrite
  // in Task 4/5 once bandFor() decides whether a hidden-band card renders at
  // all; a fallback chip has no meaning now that no fallback exists.
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f"
                    range="all" geo="regional_vic" now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('Melbourne', { selector: 'span' })).toBeInTheDocument()
})

// P1-metadata: the methodology note moves card -> modal only now (still
// present in DetailView.test.tsx) — the card itself never renders it,
// regardless of whether the chart carries one.
test('a chart note does NOT render on the card — it moved to the detail modal', () => {
  render(<ChartCard site={site} chart={chart('cash_rate')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.queryByText('Test note.')).not.toBeInTheDocument()
})

// --- P1-metadata: one caption line (name · short source token · chip · toggle) ---

test('the caption row carries a short source token, not the full source title', () => {
  render(<ChartCard site={site} chart={chart('cash_rate')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('RBA')).toBeInTheDocument()
  expect(screen.queryByText('RBA F1.1')).not.toBeInTheDocument()
})

// --- design review d2: per-chart FRED source_name override ---

test('a chart-level source_name override wins over the series’ shared meta.source_name in the caption token', () => {
  // Reuses au_cash_rate's series entry (meta.source_name "RBA F1.1", which
  // would token to "RBA") purely as a data host — the point is proving the
  // chart-level override wins, not modelling a real FRED series here.
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
  render(<ChartCard site={s} chart={s.charts.find(c => c.id === 'brent_test')!}
                    finding="f" range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('FRED')).toBeInTheDocument()
  expect(screen.queryByText('RBA')).not.toBeInTheDocument()
})

test('title, source token, status and table toggle all sit in one row', () => {
  const { container } = render(
    <ChartCard site={site} chart={chart('cash_rate')} finding="f"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const row = screen.getByText('RBA cash rate target').closest('div')!
  expect(within(row).getByText('RBA')).toBeInTheDocument()
  expect(within(row).getByText(/view data table/i)).toBeInTheDocument()
  expect(container.querySelectorAll('article > div.flex').length).toBeGreaterThan(0)
})

test('quietOutage downgrades a stale/failed chip to the quiet "{period} · unavailable" form', () => {
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f" quietOutage
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  // vic_rents in the fixture is fresh at NOW, so this only proves the prop
  // is wired through without throwing when the underlying status is fine —
  // the real downgrade is covered against real stale data below.
  expect(screen.getByText(/Mar qtr 2026/)).toBeInTheDocument()
})

test('quietOutage renders the compact "period · stale" chip for a genuinely stale card', () => {
  const stale = new Date('2027-01-01T00:00:00Z')   // well past vic_rents' cadence
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f" quietOutage
                    range="all" geo="melbourne" now={stale} onOpen={() => {}} />)
  // Age-only taxonomy (spec §1.1): vic_rents still carries data, so it's
  // 'stale', never 'failed' — the quiet form must say so, not blanket every
  // quiet chip with "unavailable" regardless of kind.
  expect(screen.getByText(/Mar qtr 2026 · stale/)).toBeInTheDocument()
  expect(screen.queryByText(/source unavailable/i)).not.toBeInTheDocument()
})

// --- P0-4 (annotation picket fence -> band/latest-label) and P1-emphasis ---

test('cash-rate card shows exactly one annotation label — the LATEST move, not the whole fence', () => {
  // Fixture's cash_rate_moves is [2026-02-28 +0.25, 2026-04-30 -0.25]: the
  // card must show only the second (most recent) one.
  const { container } = render(
    <ChartCard site={site} chart={chart('cash_rate')}
              finding="The cash rate has held at 3.85% since Jan 2026"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const clayTexts = [...container.querySelectorAll(`text[fill="${PALETTE.clay}"]`)]
  expect(clayTexts.length).toBe(1)
  expect(clayTexts[0].textContent).toContain('-0.25')
  expect(clayTexts[0].textContent).not.toContain('+0.25')
  expect(container.querySelectorAll('rect').length).toBe(0)   // no band on cash rate
})

test('a non-cash-rate annotated chart (lending) renders the shaded cycle band and its caption, not a fence', () => {
  const { container } = render(
    <ChartCard site={site} chart={chart('lending')} finding="f"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(container.querySelectorAll('rect').length).toBe(1)
  expect(container.querySelectorAll(`text[fill="${PALETTE.clay}"]`).length).toBe(0)
  expect(screen.getByText('Shaded: cash-rate cycle')).toBeInTheDocument()
})

test('an un-annotated chart shows no band caption', () => {
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.queryByText('Shaded: cash-rate cycle')).not.toBeInTheDocument()
})

test('a ≥4-line card (rent by dwelling type) emphasizes its finding-line and de-emphasizes the rest to grey', () => {
  const { container } = render(
    <ChartCard site={site} chart={chart('median_rent_by_type')} finding="f"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const paths = [...container.querySelectorAll('path')]
  const deemphCount = paths.filter(p => p.getAttribute('stroke') === PALETTE.deemphasis).length
  expect(deemphCount).toBe(5)   // 6 lines total, 1 (rent_3br_house) emphasized
  expect(paths.length).toBe(6)
})

test('the mortgage-rates card small-multiples into two full-colour minis (New / Outstanding), not one 6-line tangle', () => {
  const { container } = render(
    <ChartCard site={site} chart={chart('mortgage_rates')} finding="f"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const svgs = container.querySelectorAll('svg[role="img"]')
  expect(svgs.length).toBe(2)
  expect(screen.getByText('New')).toBeInTheDocument()
  expect(screen.getByText('Outstanding')).toBeInTheDocument()
  // Neither mini de-emphasizes (each is ≤3 lines, full colour).
  const deemphPaths = [...container.querySelectorAll('path')]
    .filter(p => p.getAttribute('stroke') === PALETTE.deemphasis)
  expect(deemphPaths.length).toBe(0)
})

// --- Task 9: fullWidth mortgage minis lay side-by-side on a spanning row ---

test('a full-width mortgage card lays its two minis side-by-side', () => {
  render(<ChartCard site={site} chart={chart('mortgage_rates')} finding="f" fullWidth
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const minis = screen.getByText('New').parentElement!.parentElement!
  expect(minis.className).toContain('sm:grid-cols-2')
})

test('without fullWidth, the mortgage card stacks its two minis instead', () => {
  render(<ChartCard site={site} chart={chart('mortgage_rates')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const minis = screen.getByText('New').parentElement!.parentElement!
  expect(minis.className).toContain('space-y-3')
  expect(minis.className).not.toContain('sm:grid-cols-2')
})

// --- design review P1: structural shared x-domain + degenerate band gating ---

test('mortgage-rates minis share one STRUCTURALLY-computed x-domain even when their subsets end at different dates', () => {
  // Fixture's mortgage_new*/mortgage_outstanding* metrics all sit at the
  // same two dates (05-31, 06-30) today, which is exactly the "coincidental"
  // sharing the review flagged — shift the outstanding metrics one month
  // earlier so the two subsets have genuinely different ranges (outstanding
  // ends at 05-31, a month before new's 06-30) and prove the combined domain
  // (04-30..06-30) is handed to BOTH minis rather than each computing its
  // own independently.
  const mutated = JSON.parse(JSON.stringify(siteEdge))
  const shiftBack: Record<string, string> = { '2026-06-30': '2026-05-31', '2026-05-31': '2026-04-30' }
  mutated.series.au_mortgage_rates.points = mutated.series.au_mortgage_rates.points
    .map((p: { metric: string; date: string }) => p.metric.startsWith('mortgage_outstanding')
      ? { ...p, date: shiftBack[p.date] ?? p.date } : p)
  const mutatedSite = assertSiteData(mutated)

  const { container } = render(
    <ChartCard site={mutatedSite} chart={chart('mortgage_rates')} finding="f"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  const svgs = [...container.querySelectorAll('svg[role="img"]')]
  expect(svgs.length).toBe(2)
  const xTicksOf = (svg: Element) =>
    [...svg.querySelectorAll('text')]
      .filter(t => t.getAttribute('text-anchor') === 'middle')
      .map(t => `${t.getAttribute('x')}:${t.textContent}`)
  const [newTicks, outstandingTicks] = svgs.map(xTicksOf)
  expect(newTicks.length).toBeGreaterThan(0)
  expect(outstandingTicks).toEqual(newTicks)   // same domain -> identical tick set
})

test('band caption disappears along with the band when fewer than 2 annotations are visible (no stale caption)', () => {
  const mutated = JSON.parse(JSON.stringify(siteEdge))
  mutated.annotations.cash_rate_moves = [{ date: '2026-04-30', delta: -0.25 }]
  const mutatedSite = assertSiteData(mutated)

  const { container } = render(
    <ChartCard site={mutatedSite} chart={chart('lending')} finding="f"
              range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(container.querySelectorAll('rect').length).toBe(0)
  expect(screen.queryByText('Shaded: cash-rate cycle')).not.toBeInTheDocument()
})

// --- D1(c): greenfield-style stat-tile gate (every line < 2 points) ---
// vic_land isn't in this file's shared fixture, so these tests build their
// own minimal series/chart (mirroring pipeline/sources/udp.py's real shape:
// 3 metrics, alphabetically-sorted units-object keys, so
// greenfield_lot_supply sorts first even though the finding's real subject
// is greenfield_years_of_supply — the exact case FINDING_PRIMARY_METRIC
// exists for).
function siteWithLandChart(pointsPerMetric: 1 | 2) {
  const mutated = JSON.parse(JSON.stringify(siteEdge))
  mutated.charts.push({
    id: 'land', section: 'supply', title: 'Greenfield land supply',
    series_id: 'vic_land', metrics: null, region_mode: 'fixed:melbourne',
    scope: 'geo', geos: ['melbourne'],
    percent: false, markers: false, annotate: false, note: null, modal_metrics: null,
  })
  // Slice from the END: a 1-point fixture should carry the LATEST value
  // (values[1]), not the earlier one — mirrors how a real 1-point-per-metric
  // series (vic_land in production) only ever has its most recent reading.
  const dates = ['2024-12-31', '2025-12-31'].slice(-pointsPerMetric)
  const series = (metric: string, values: number[]) => {
    const vals = values.slice(-pointsPerMetric)
    return dates.map((date, i) => ({ date, region: 'melbourne', metric, value: vals[i] }))
  }
  mutated.series.vic_land = {
    status: 'ok',
    meta: { source_name: 'Urban Development Program', source_url: null, frequency: 'annual',
            last_fetched: '2026-07-18T00:00:00Z', last_changed: null,
            last_data_date: dates.at(-1), error: null, cadence_days: 365 },
    units: { greenfield_lot_supply: 'lots', greenfield_lots_titled: 'lots',
             greenfield_years_of_supply: 'years' },
    points: [
      ...series('greenfield_lot_supply', [300_000, 334_019]),
      ...series('greenfield_lots_titled', [17_000, 18_543]),
      ...series('greenfield_years_of_supply', [16, 18]),
    ],
  }
  mutated.findings.land = { melbourne: 'Greenfield years of supply sits at 18.0 years' }
  return assertSiteData(mutated)
}

test('a chart whose every line has < 2 points renders a stat tile (fmtUnit value, no chart) instead of a blank plot', () => {
  const landSite = siteWithLandChart(1)
  render(<ChartCard site={landSite} chart={landSite.charts.find(c => c.id === 'land')!}
                    finding="f" range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  // greenfield_years_of_supply (FINDING_PRIMARY_METRIC override), not the
  // alphabetically-first greenfield_lot_supply metric.
  expect(screen.getByText('18.0 yrs')).toBeInTheDocument()
})

test('the same chart auto-reverts to the normal LineChart once every line reaches >= 2 points', () => {
  const landSite = siteWithLandChart(2)
  render(<ChartCard site={landSite} chart={landSite.charts.find(c => c.id === 'land')!}
                    finding="f" range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByRole('img')).toBeInTheDocument()
  expect(screen.queryByText('18.0 yrs')).not.toBeInTheDocument()
})

test('a MIXED chart (one line short, others long) still renders the chart, not a stat tile — auto-marker behaviour is unaffected', () => {
  const mutated = JSON.parse(JSON.stringify(siteEdge))
  mutated.charts.push({
    id: 'land', section: 'supply', title: 'Greenfield land supply',
    series_id: 'vic_land', metrics: null, region_mode: 'fixed:melbourne',
    scope: 'geo', geos: ['melbourne'],
    percent: false, markers: false, annotate: false, note: null, modal_metrics: null,
  })
  mutated.series.vic_land = {
    status: 'ok',
    meta: { source_name: 'Urban Development Program', source_url: null, frequency: 'annual',
            last_fetched: '2026-07-18T00:00:00Z', last_changed: null,
            last_data_date: '2025-12-31', error: null, cadence_days: 365 },
    units: { greenfield_lot_supply: 'lots', greenfield_lots_titled: 'lots',
             greenfield_years_of_supply: 'years' },
    points: [
      { date: '2024-12-31', region: 'melbourne', metric: 'greenfield_lot_supply', value: 300_000 },
      { date: '2025-12-31', region: 'melbourne', metric: 'greenfield_lot_supply', value: 334_019 },
      // Only one point for this metric — the "MIXED" line.
      { date: '2025-12-31', region: 'melbourne', metric: 'greenfield_lots_titled', value: 18_543 },
      { date: '2024-12-31', region: 'melbourne', metric: 'greenfield_years_of_supply', value: 16 },
      { date: '2025-12-31', region: 'melbourne', metric: 'greenfield_years_of_supply', value: 18 },
    ],
  }
  mutated.findings.land = { melbourne: 'f' }
  const landSite = assertSiteData(mutated)
  const { container } = render(
    <ChartCard site={landSite} chart={landSite.charts.find(c => c.id === 'land')!}
              finding="f" range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByRole('img')).toBeInTheDocument()
  // The short line (greenfield_lots_titled, 1 point) still gets its existing
  // LineChart auto-marker fallback — unchanged behaviour, just proved from
  // the ChartCard level now that the stat-tile gate exists alongside it.
  expect(container.querySelectorAll('circle.pt-marker').length).toBeGreaterThanOrEqual(1)
})

test('mixed-unit series formats each line with its own metric unit, not the series-wide first one', async () => {
  // vic_rents carries rent_growth_annual (percent) FIRST in units and
  // median_rent (aud) second — the old single-scalar-unit code picked
  // whichever unit sat first in the object, so a $-denominated metric could
  // render with a % suffix if a percent metric happened to be declared
  // earlier. The median_rent chart only plots the median_rent metric, so
  // its table cell must read as a dollar figure regardless of unit order.
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  await userEvent.click(screen.getByText(/view data table/i))
  expect(screen.getByText('$580')).toBeInTheDocument()
  expect(screen.queryByText('580%')).not.toBeInTheDocument()
})
