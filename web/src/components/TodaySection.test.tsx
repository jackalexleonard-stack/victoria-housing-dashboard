import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData, type HeroTile, type NewsData } from '../lib/types'
import { TodaySection } from './TodaySection'

const site = assertSiteData(siteEdge)
const NOW = new Date('2026-07-18T00:00:00Z')
const news: NewsData = {
  schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
  items: [{ title: 'Rates on hold again', url: 'https://n/1', source: 'RBA',
            published: '2026-07-17', tags: ['policy'], image: null,
            dup_sources: ['The Age', 'ABC News'], score: 9.1 }],
  top_story_urls: ['https://n/1'], digest: 'Two-line digest.',
}

test('the lead card renders hero_lead\'s finding and opens its chart on click', async () => {
  const onOpen = vi.fn()
  render(<TodaySection site={site} news={news} now={NOW} onOpen={onOpen} />)
  // Fixture: hero_lead = "melb_rent" -> TILE_CHART.melb_rent = "median_rent"
  // -> findings.median_rent.
  const lead = screen.getByTestId('lead-finding')
  expect(lead.tagName).toBe('H2')
  expect(lead).toHaveTextContent('The median rent held at $580/wk in Mar qtr 2026')
  await userEvent.click(lead)
  expect(onOpen).toHaveBeenCalledWith('median_rent')
})

test('the lead card shows its compact value + delta under the sentence', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const card = screen.getByTestId('lead-finding-card')
  expect(within(card).getByText('$580/wk')).toBeInTheDocument()
  expect(within(card).getByText('+10/wk')).toBeInTheDocument()
})

test('two secondary finding cards render the next hero picks, excluding the lead', async () => {
  const onOpen = vi.fn()
  render(<TodaySection site={site} news={news} now={NOW} onOpen={onOpen} />)
  // Fixture hero order: cash_rate, melb_dwelling_values, melb_rent(lead),
  // oo_lending, mortgage_new -> excluding the lead, the next two in order
  // are cash_rate and melb_dwelling_values.
  const secondaries = screen.getByTestId('secondary-findings')
  const headings = within(secondaries).getAllByRole('heading', { level: 3 })
  expect(headings).toHaveLength(2)
  expect(headings[0]).toHaveTextContent('The cash rate has held at 3.85% since Jan 2026')
  expect(headings[1]).toHaveTextContent(/Melbourne dwelling values rose 0.3%/)
  await userEvent.click(headings[0])
  expect(onOpen).toHaveBeenCalledWith('cash_rate')
})

test('filters active: no lead card, no secondary cards, just the compact strip', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} filtersActive />)
  expect(screen.queryByTestId('lead-finding-card')).not.toBeInTheDocument()
  expect(screen.queryByTestId('secondary-findings')).not.toBeInTheDocument()
  const strip = screen.getByTestId('hero-strip')
  expect(within(strip).getByText('$580/wk')).toBeInTheDocument()
})

test('the compact strip renders sentence-case labels with cadence codes moved to the delta line', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const strip = screen.getByTestId('hero-strip')
  // "Melb dwelling values (MoM)" -> label without the code...
  const label = within(strip).getByText('Melb dwelling values')
  expect(label.textContent).not.toMatch(/MoM/)
  // ...the code rides the delta line instead.
  expect(within(strip).getByText('+2.1% yr (MoM)')).toBeInTheDocument()
})

test('the compact strip is not forced upper-case (sentence case)', () => {
  const { container } = render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const strip = screen.getByTestId('hero-strip')
  expect(within(strip).getByText('RBA cash rate')).toBeInTheDocument()
  expect(container.querySelector('[data-testid="hero-strip"] .uppercase')).toBeNull()
})

test('the ERP tile renders in the strip after the five hero tiles, muted (delta_color off)', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const strip = screen.getByTestId('hero-strip')
  expect(within(strip).getByText('Resident population')).toBeInTheDocument()
  expect(within(strip).getByText('27,801,000')).toBeInTheDocument()
  const delta = within(strip).getByText('+78,600')
  expect(delta).toHaveStyle({ color: '#575653' })   // PALETTE.muted — 'off' delta_color
})

test('changed-this-week chips render deltas via TILE_FMT, coloured by delta_color', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const list = screen.getByTestId('whats-new')
  const oo = within(list).getByText('$1,020m').closest('button')!
  expect(within(oo).getByText('+2.0% qtr')).toBeInTheDocument()
})

test('a flat/off delta renders level-only colour, not a move', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const list = screen.getByTestId('whats-new')
  const vac = within(list).getByText('2.5%').closest('button')!
  const delta = within(vac).getByText('+0.0 pp')
  expect(delta).toHaveStyle({ color: '#575653' })   // PALETTE.muted
})

test('changed-this-week caps at 6 chips with an "and N more" disclosure', async () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const list = screen.getByTestId('whats-new')
  expect(within(list).getAllByRole('listitem')).toHaveLength(6)
  const more = screen.getByRole('button', { name: 'and 2 more changes' })
  await userEvent.click(more)
  expect(within(list).getAllByRole('listitem')).toHaveLength(8)
  expect(screen.getByRole('button', { name: 'Show fewer' })).toBeInTheDocument()
})

test('changed-this-week strip sorts by score desc, nulls last, recency tiebreak among nulls', () => {
  // P0-2 (complete): recency alone used to decide order (changed_at desc).
  // Deliberately scramble that recency order against score so the test only
  // passes if score is actually driving the sort.
  const customWhatsNew: HeroTile[] = [
    { key: 'melb_vacancy', label: 'Rental vacancy — Melbourne', value: 2.51, delta: 0.0,
      delta_color: 'off', last_date: '2026-06-30', changed_at: '2026-07-10', score: 0.2 },
    { key: 'cash_rate', label: 'RBA cash rate', value: 3.85, delta: 0.0,
      delta_color: 'inverse', last_date: '2026-06-30', changed_at: '2026-07-15', score: 0.9 },
    { key: 'melb_rent', label: 'Median rent — Melbourne', value: 580, delta: 10,
      delta_color: 'normal', last_date: '2026-03-31', changed_at: '2026-07-08', score: null },
    { key: 'oo_lending', label: 'New loans — owner-occupier', value: 1020, delta: 2.0,
      delta_color: 'normal', last_date: '2026-06-30', changed_at: '2026-07-14', score: null },
  ]
  render(<TodaySection site={{ ...site, whats_new: customWhatsNew }} news={news} now={NOW}
                       onOpen={() => {}} />)
  const list = screen.getByTestId('whats-new')
  const rows = within(list).getAllByRole('listitem').map(li => li.textContent ?? '')
  // score desc first (cash_rate 0.9 > vacancy 0.2), THEN the two null-score
  // tiles, broken by changed_at desc (oo_lending 07-14 before melb_rent 07-08)
  // — the opposite of their array-declaration order above.
  expect(rows[0]).toMatch(/RBA cash rate/)
  expect(rows[1]).toMatch(/Rental vacancy/)
  expect(rows[2]).toMatch(/owner-occupier/)
  expect(rows[3]).toMatch(/Median rent/)
})

test('a stale-source chip badges its vintage inline instead of being excluded', () => {
  // Far enough past vic_rents' 92-day cadence (last_data_date 2026-03-31)
  // that its "failed" status actually trips the staleness gate.
  const later = new Date('2026-08-20T00:00:00Z')
  render(<TodaySection site={site} news={news} now={later} onOpen={() => {}} />)
  const list = screen.getByTestId('whats-new')
  const rentChip = within(list).getByText('$580/wk').closest('button')!
  expect(within(rentChip).getByText(/Mar qtr 2026/)).toBeInTheDocument()
})

test('no vintage badge when the source is fresh', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  const list = screen.getByTestId('whats-new')
  const cashChip = within(list).getByText('3.85%', { selector: 'span.font-medium' }).closest('button')!
  expect(within(cashChip).queryByText(/2026$/)).not.toBeInTheDocument()
})

test('top stories render with outlet count and digest shows', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  expect(screen.getByText('Rates on hold again')).toHaveAttribute('href', 'https://n/1')
  expect(screen.getByText(/covered by 3 outlets/)).toBeInTheDocument()
  expect(screen.getByText('Two-line digest.')).toBeInTheDocument()
})

test('empty whats_new hides the strip entirely', () => {
  const siteNoChanges = { ...site, whats_new: [] }
  render(<TodaySection site={siteNoChanges} news={news} now={NOW} onOpen={() => {}} />)
  expect(screen.queryByText(/changed this week/i)).not.toBeInTheDocument()
})

test('dates render human-formatted, not raw ISO', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  expect(screen.getByText(/17 Jul 2026/)).toBeInTheDocument()   // top story published
  expect(screen.queryByText(/2026-07-17/)).not.toBeInTheDocument()
})

test('hero tiles carry a one-line explainer tooltip', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  expect(screen.getByTestId('hero-strip'))
    .toHaveAttribute('title', "Today's most notable movements")
})

test('top stories heading carries an explainer tooltip', () => {
  render(<TodaySection site={site} news={news} now={NOW} onOpen={() => {}} />)
  expect(screen.getByRole('heading', { name: 'Top stories' }))
    .toHaveAttribute('title', 'Ranked by source, topic and recency')
})

test('no hero_lead (older export) falls back to strip only, no crash', () => {
  const siteNoLead = { ...site, hero_lead: undefined }
  render(<TodaySection site={siteNoLead} news={news} now={NOW} onOpen={() => {}} />)
  expect(screen.queryByTestId('lead-finding-card')).not.toBeInTheDocument()
  expect(screen.getByTestId('hero-strip')).toBeInTheDocument()
})
