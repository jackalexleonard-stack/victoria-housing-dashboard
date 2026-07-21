import siteReal from '../test/fixtures/site.real.json'
import siteEdge from '../test/fixtures/site.edge.json'
import newsReal from '../test/fixtures/news.real.json'
import { assertSiteData, assertNewsData } from './types'

test('real exporter output passes the runtime guard', () => {
  const site = assertSiteData(siteReal)
  expect(site.schema_version).toBe(1)
  expect(Object.keys(site.series).length).toBeGreaterThan(15)
  expect(site.hero).toHaveLength(5)
  assertNewsData(newsReal)
})

test('edge fixture passes: failed series with and without points', () => {
  const site = assertSiteData(siteEdge)
  expect(site.series.vic_auctions.status).toBe('failed')
  expect(site.series.vic_auctions.points).toHaveLength(0)
  expect(site.series.vic_rents.status).toBe('failed')
  // vic_rents now carries two metrics (median_rent + rent_growth_annual) so
  // F4's mixed-unit fixture point is included — see selectors/ChartCard tests.
  expect(site.series.vic_rents.points).toHaveLength(2)
})

test('guard fails loudly on wrong shapes', () => {
  expect(() => assertSiteData({ schema_version: 2 })).toThrow(/unexpected data shape/)
  expect(() => assertSiteData({ ...siteEdge as object, series: null })).toThrow(/unexpected data shape/)
  expect(() => assertNewsData({ schema_version: 1 })).toThrow(/unexpected data shape/)
})

test('scan-batch fields (hero_lead, extra_tiles, metric_labels, section_summaries) are optional', () => {
  // Older fixtures without the new scan-batch fields must still pass — the
  // fields are additive, not a schema bump.
  expect(() => assertSiteData(siteEdge)).not.toThrow()
  // When present, a well-typed site with the new fields still passes.
  const withNewFields = {
    ...siteEdge as object, hero_lead: 'cash_rate', extra_tiles: [],
    metric_labels: { cash_rate: 'Cash rate' }, section_summaries: { prices: 'Quiet.' },
  }
  expect(() => assertSiteData(withNewFields)).not.toThrow()
})

test('guard rejects wrongly-typed scan-batch fields when present', () => {
  expect(() => assertSiteData({ ...siteEdge as object, hero_lead: 42 }))
    .toThrow(/unexpected data shape/)
  expect(() => assertSiteData({ ...siteEdge as object, extra_tiles: 'nope' }))
    .toThrow(/unexpected data shape/)
  expect(() => assertSiteData({ ...siteEdge as object, metric_labels: 'nope' }))
    .toThrow(/unexpected data shape/)
  expect(() => assertSiteData({ ...siteEdge as object, section_summaries: 'nope' }))
    .toThrow(/unexpected data shape/)
})
