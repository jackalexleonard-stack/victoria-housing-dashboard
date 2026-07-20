import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from '../lib/types'
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
