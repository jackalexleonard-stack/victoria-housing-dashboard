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
  expect(site.series.vic_rents.points).toHaveLength(1)
})

test('guard fails loudly on wrong shapes', () => {
  expect(() => assertSiteData({ schema_version: 2 })).toThrow(/unexpected data shape/)
  expect(() => assertSiteData({ ...siteEdge as object, series: null })).toThrow(/unexpected data shape/)
  expect(() => assertNewsData({ schema_version: 1 })).toThrow(/unexpected data shape/)
})
