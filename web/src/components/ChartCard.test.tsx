import { render, screen } from '@testing-library/react'
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

test('failed source renders an honest card, not a blank', () => {
  render(<ChartCard site={site} chart={chart('auctions')}
                    finding="No recent data — source currently unavailable"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByText(/source currently unavailable/i, { selector: 'p' })).toBeInTheDocument()
  expect(screen.queryByRole('img')).not.toBeInTheDocument()
  expect(screen.getByText(/source unavailable/i, { selector: 'span' })).toBeInTheDocument()
})

test('data table disclosure exposes the values', async () => {
  render(<ChartCard site={site} chart={chart('cash_rate')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  await userEvent.click(screen.getByText(/view data table/i))
  expect(screen.getAllByRole('row').length).toBeGreaterThan(1)
})

test('scope chip appears when geo falls back', () => {
  render(<ChartCard site={site} chart={chart('median_rent')} finding="f"
                    range="all" geo="regional_vic" now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('Melbourne', { selector: 'span' })).toBeInTheDocument()
})

test('chart note renders as a muted line below the caption row', () => {
  render(<ChartCard site={site} chart={chart('cash_rate')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('Test note.')).toBeInTheDocument()
})

test('chart without a note renders no note line', () => {
  render(<ChartCard site={site} chart={chart('auctions')} finding="f"
                    range="all" geo="melbourne" now={NOW} onOpen={() => {}} />)
  expect(screen.queryByText('Test note.')).not.toBeInTheDocument()
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
