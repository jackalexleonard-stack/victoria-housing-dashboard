import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from './types'
import { chartPoints, lineName } from './selectors'

const site = assertSiteData(siteEdge)
const NOW = new Date('2026-07-18T00:00:00Z')
const chart = (id: string) => site.charts.find(c => c.id === id)!

test('fixed region mode ignores the geo filter, but notes the mismatch (audit D3)', () => {
  // cash_rate is fixed:australia; geo is melbourne, so the chart still shows
  // Australia's own data (region filter untouched by geo) but now must say
  // so — a fixed-region chart shown outside its own geography used to say
  // nothing at all (the D3 defect).
  const { lines, scopeNote } = chartPoints(site, chart('cash_rate'), 'all', 'melbourne', NOW)
  expect(lines).toHaveLength(1)
  // T2 (chart-internals scan batch) extended the fixture's au_cash_rate
  // series from 2 to 5 points so its date range actually covers the
  // fixture's cash_rate_moves annotation dates (Feb/Apr 2026) — needed for
  // the new ChartCard 'latest-label' annotation test to have a visible
  // annotation to assert on. 5, not the old 2.
  expect(lines[0].pts).toHaveLength(5)
  expect(scopeNote).toBe('Australia-wide')
})

test('fixed region mode notes nothing when the geo matches the fixed region', () => {
  const { scopeNote } = chartPoints(site, chart('cash_rate'), 'all', 'australia', NOW)
  expect(scopeNote).toBeNull()
})

test('geo mode strictly filters to the selected geo — no fallback substitution (audit D2)', () => {
  // vic_rents only has melbourne rows in this fixture; regional_vic has
  // none. The old FALLBACK chain used to widen to melbourne here and quietly
  // relabel it — now it must render nothing rather than borrow another
  // region's numbers.
  const { lines, scopeNote } = chartPoints(site, chart('median_rent'), 'all', 'regional_vic', NOW)
  expect(lines).toEqual([])
  expect(scopeNote).toBeNull()
})

test('range cutoff filters points', () => {
  const none = chartPoints(site, chart('cash_rate'), '1y', 'melbourne',
                           new Date('2028-01-01T00:00:00Z'))
  expect(none.lines[0]?.pts ?? []).toHaveLength(0)
})

// Design review P1-labels: machine-vocabulary legends ("credit housing mom")
// get a display-label map instead of a raw underscore-strip.
describe('lineName', () => {
  test('uses the metric_labels map when the metric is covered', () => {
    expect(lineName('cash_rate', { cash_rate: 'Cash rate' })).toBe('Cash rate')
  })

  test('falls back to underscore-stripping humanisation when uncovered or absent', () => {
    expect(lineName('rent_3br_house', { cash_rate: 'Cash rate' })).toBe('rent 3br house')
    expect(lineName('rent_3br_house')).toBe('rent 3br house')
  })
})

test('chartPoints names lines via site.metric_labels when present', () => {
  const labelled = assertSiteData({ ...siteEdge as object,
    metric_labels: { cash_rate: 'Cash rate target' } })
  const { lines } = chartPoints(labelled, chart('cash_rate'), 'all', 'melbourne', NOW)
  expect(lines[0].name).toBe('Cash rate target')
})

// Dedicated substitution regression (audit D2), isolated from the shared
// fixture: a minimal series with ONLY melbourne rows, geo selected as
// regional_vic. The old FALLBACK chain would have widened to melbourne and
// silently shown its 575 — proving that can never happen again, not just
// that this particular fixture's data happens to come out empty.
test('never renders another region\'s data when the selected geo is absent', () => {
  const site = {
    series: { s: { points: [
      { date: '2026-06-30', region: 'melbourne', metric: 'm', value: 575 },
    ], units: { m: 'aud' }, meta: {} } },
    metric_labels: {},
  } as unknown as Parameters<typeof chartPoints>[0]
  const chart = { id: 'c', series_id: 's', metrics: ['m'], region_mode: 'geo',
                  scope: 'geo', geos: ['melbourne'] } as unknown as Parameters<typeof chartPoints>[1]
  const { lines } = chartPoints(site, chart, 'all', 'regional_vic', new Date('2026-07-01'))
  expect(lines).toEqual([])   // must be empty, NOT Melbourne's 575
})
