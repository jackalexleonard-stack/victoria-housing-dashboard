import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WorldTiles } from './WorldTiles'
import type { ChartSpec, SeriesMeta, SiteData } from '../lib/types'
import { PALETTE } from '../theme/tokens'

const NOW = new Date('2026-07-21T00:00:00Z')

function chart(id: string, title: string, seriesId: string, metric: string,
               percent = false): ChartSpec {
  return { id, section: 'world', title, series_id: seriesId, metrics: [metric],
           region_mode: 'fixed:global', percent, markers: false, annotate: false }
}

const worldCharts: ChartSpec[] = [
  chart('brent', 'Brent crude', 'intl_fred', 'brent_crude'),
  chart('aud_usd', 'AUD/USD', 'intl_fred', 'aud_usd'),
  chart('ust10', 'US 10-year Treasury', 'intl_fred', 'us_10y_treasury', true),
  chart('iron_ore', 'Iron ore', 'intl_commodities', 'iron_ore'),
  chart('copper', 'Copper', 'intl_commodities', 'copper'),
  chart('sawnwood', 'Sawnwood', 'intl_commodities', 'sawnwood'),
]

function meta(overrides: Partial<SeriesMeta> = {}) {
  return { source_name: 'FRED', source_url: 'https://fred.stlouisfed.org', frequency: 'daily',
           last_fetched: '2026-07-21T00:00:00Z', last_changed: null,
           last_data_date: '2026-07-20', error: null, cadence_days: 1, ...overrides }
}

function pts(metric: string, values: number[], dates: string[]) {
  return values.map((value, i) => ({ date: dates[i], region: 'global', metric, value }))
}

function baseSite(): SiteData {
  return {
    schema_version: 1, generated_at: '2026-07-21T04:00:00Z',
    sections: [['world', 'World']],
    charts: worldCharts, findings: {},
    series: {
      intl_fred: {
        status: 'ok', meta: meta(),
        units: { brent_crude: 'usd_per_barrel', aud_usd: 'usd_per_aud', us_10y_treasury: 'percent' },
        points: [
          ...pts('brent_crude', [80, 82], ['2026-07-13', '2026-07-20']),
          ...pts('aud_usd', [0.655, 0.658], ['2026-07-13', '2026-07-20']),
          ...pts('us_10y_treasury', [4.2, 4.35], ['2026-07-13', '2026-07-20']),
        ],
      },
      intl_commodities: {
        status: 'ok', meta: meta({ frequency: 'monthly', cadence_days: 31, last_data_date: '2026-06-30' }),
        units: { iron_ore: 'USD/dmtu', copper: 'USD/tonne', sawnwood: 'USD/m3' },
        points: [
          ...pts('iron_ore', [100, 105], ['2026-05-31', '2026-06-30']),
          ...pts('copper', [9000, 9500], ['2026-05-31', '2026-06-30']),
          ...pts('sawnwood', [400, 420], ['2026-05-31', '2026-06-30']),
        ],
      },
    },
    hero: [], whats_new: [],
    annotations: { cash_rate_moves: [], accord_start: '2024-07-01' },
    section_summaries: { world: 'Brent crude rose 9.8% to US$82 in Jul 2026' },
  }
}

test('renders one tile per World chart with the series short name, latest value and delta', () => {
  const site = baseSite()
  render(<WorldTiles site={site} charts={worldCharts} now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('Brent crude')).toBeInTheDocument()
  expect(screen.getByText('US$82')).toBeInTheDocument()
  expect(screen.getByText('+US$2.00')).toBeInTheDocument()
  expect(screen.getByText('AUD/USD')).toBeInTheDocument()
  expect(screen.getByText('0.66')).toBeInTheDocument()
  expect(screen.getByText('US 10-year Treasury')).toBeInTheDocument()
  expect(screen.getByText('4.35%')).toBeInTheDocument()
  expect(screen.getByText('Iron ore')).toBeInTheDocument()
  expect(screen.getByText('US$105')).toBeInTheDocument()
  expect(screen.getByText('Copper')).toBeInTheDocument()
  expect(screen.getByText('US$9,500')).toBeInTheDocument()
  expect(screen.getByText('Sawnwood')).toBeInTheDocument()
  expect(screen.getByText('US$420')).toBeInTheDocument()
})

test('tapping a tile opens the detail modal for that exact chart id', async () => {
  const onOpen = vi.fn()
  const site = baseSite()
  render(<WorldTiles site={site} charts={worldCharts} now={NOW} onOpen={onOpen} />)
  await userEvent.click(screen.getByText('Copper').closest('button')!)
  expect(onOpen).toHaveBeenCalledWith('copper')
})

test('leads with the World section summary as a Newsreader (font-display) line', () => {
  const site = baseSite()
  const { container } = render(
    <WorldTiles site={site} charts={worldCharts} now={NOW} onOpen={() => {}} />)
  const summary = screen.getByText('Brent crude rose 9.8% to US$82 in Jul 2026')
  expect(summary.className).toContain('font-display')
  expect(container.querySelector('.font-display')).toBe(summary)
})

// D1(f) disclosed choice: every World tile's delta renders 'off' (muted),
// not an asserted up=good/down=bad judgement — see WorldTiles.tsx's own
// comment for why (no housing-relevant "good" direction for FX/a yield, and
// commodities cut both ways as input costs vs. export income).
test('every delta renders the muted "off" colour, never a green/red judgement', () => {
  const site = baseSite()
  render(<WorldTiles site={site} charts={worldCharts} now={NOW} onOpen={() => {}} />)
  const brentDelta = screen.getByText('+US$2.00')
  expect(brentDelta).toHaveStyle({ color: PALETTE.muted })
})

test('a stale series carries its staleness chip on the tile', () => {
  const site = baseSite()
  site.series.intl_commodities.meta.last_data_date = '2026-01-31'
  render(<WorldTiles site={site} charts={worldCharts} now={NOW} onOpen={() => {}} />)
  const ironOreTile = screen.getByText('Iron ore').closest('button')!
  expect(within(ironOreTile).getByText(/stale/i)).toBeInTheDocument()
})

test('a chart with no data at all renders a non-clickable tile ("—"), not a dead link', () => {
  const site = baseSite()
  site.series.intl_fred.points = site.series.intl_fred.points
    .filter(p => p.metric !== 'brent_crude')
  render(<WorldTiles site={site} charts={worldCharts} now={NOW} onOpen={() => {}} />)
  const label = screen.getByText('Brent crude')
  expect(label.closest('button')).toBeNull()
})
