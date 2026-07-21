import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from './types'
import { chartPoints } from './selectors'

const site = assertSiteData(siteEdge)
const NOW = new Date('2026-07-18T00:00:00Z')
const chart = (id: string) => site.charts.find(c => c.id === id)!

test('fixed region mode ignores the geo filter', () => {
  const { lines, scopeNote } = chartPoints(site, chart('cash_rate'), 'all', 'melbourne', NOW)
  expect(lines).toHaveLength(1)
  // T2 (chart-internals scan batch) extended the fixture's au_cash_rate
  // series from 2 to 5 points so its date range actually covers the
  // fixture's cash_rate_moves annotation dates (Feb/Apr 2026) — needed for
  // the new ChartCard 'latest-label' annotation test to have a visible
  // annotation to assert on. 5, not the old 2.
  expect(lines[0].pts).toHaveLength(5)
  expect(scopeNote).toBeNull()
})

test('geo mode falls back with a scope note', () => {
  const { lines, scopeNote } = chartPoints(site, chart('median_rent'), 'all', 'regional_vic', NOW)
  expect(lines[0].pts).toHaveLength(1)       // melbourne data only in fixture
  expect(scopeNote).toBe('Melbourne')        // fell back, so the note names it
})

test('range cutoff filters points', () => {
  const none = chartPoints(site, chart('cash_rate'), '1y', 'melbourne',
                           new Date('2028-01-01T00:00:00Z'))
  expect(none.lines[0]?.pts ?? []).toHaveLength(0)
})
