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

// T6 item 2: pinned against the real exporter's ACTUAL current output, not
// a hand-crafted example — so if a future pipeline change silently stops
// flagging a genuinely-quiet section (or starts over-flagging a real one),
// this test breaks loudly instead of the honesty override quietly rotting.
test('real exporter output: section_summary_quiet matches the current real-data shape', () => {
  const site = assertSiteData(siteReal)
  expect(site.section_summary_quiet).toEqual({
    prices: false, rents: true, supply: false, money: false,
    people: false, social: false, world: false, news: false,
  })
})

// T6 item 1 (P0-2 complete): every whats_new tile must carry a score field
// (float or null) end to end through the real exporter, not just in
// hand-built unit fixtures.
test('real exporter output: every whats_new tile carries a score field (number or null)', () => {
  const site = assertSiteData(siteReal)
  expect(site.whats_new.length).toBeGreaterThan(0)
  for (const t of site.whats_new) {
    expect('score' in t).toBe(true)
    expect(t.score === null || typeof t.score === 'number').toBe(true)
  }
  // Hero tiles (no changed_at) never carry the field at all.
  for (const t of site.hero) expect('score' in t).toBe(false)
})

test('edge fixture passes: failed series with and without points', () => {
  const site = assertSiteData(siteEdge)
  expect(site.series.vic_auctions.status).toBe('failed')
  expect(site.series.vic_auctions.points).toHaveLength(0)
  expect(site.series.vic_rents.status).toBe('failed')
  // vic_rents carries median_rent (2 points — D1(c) added a second so the
  // median_rent card isn't accidentally caught by the greenfield-style
  // stat-tile gate, which fires when EVERY line has < 2 points) +
  // rent_growth_annual (F4's mixed-unit fixture point) plus, since T2
  // (chart-internals scan batch) added the median_rent_by_type card
  // fixture, 12 more points across the 6 rent-by-dwelling-type metrics
  // (2 dates each) — see selectors/ChartCard tests. 15 total, not the old 2.
  expect(site.series.vic_rents.points).toHaveLength(15)
})

// Backlog cleanup: the guard's `health` branch (assertNewsData, types.ts)
// had no test exercising the health-ABSENT path at the guard level itself
// (only NewsSection.test.tsx covered it, and only at the component level).
// A deep clone of the real fixture with the key deleted — not a hand-built
// literal — so this is a genuinely real-shaped object minus just the one
// field under test.
test('assertNewsData accepts a real-shaped payload with no health field', () => {
  const withoutHealth = structuredClone(newsReal) as Record<string, unknown>
  delete withoutHealth.health
  expect(() => assertNewsData(withoutHealth)).not.toThrow()
  const news = assertNewsData(withoutHealth)
  expect(news.health).toBeUndefined()
})

test('guard fails loudly on wrong shapes', () => {
  expect(() => assertSiteData({ schema_version: 2 })).toThrow(/unexpected data shape/)
  expect(() => assertSiteData({ ...siteEdge as object, series: null })).toThrow(/unexpected data shape/)
  expect(() => assertNewsData({ schema_version: 1 })).toThrow(/unexpected data shape/)
})

test('scan-batch fields (hero_lead, extra_tiles, metric_labels, section_summaries, section_summary_quiet) are optional', () => {
  // Older fixtures/exports without the new scan-batch fields must still
  // pass — the fields are additive, not a schema bump. siteEdge itself now
  // carries them (T3 needs real values to exercise the lead-finding card),
  // so strip them back off here to cover the genuinely-absent case.
  const { hero_lead: _hl, extra_tiles: _et, metric_labels: _ml,
          section_summaries: _ss, section_summary_quiet: _sq,
          ...withoutNewFields } = siteEdge as Record<string, unknown>
  expect(() => assertSiteData(withoutNewFields)).not.toThrow()
  // When present, a well-typed site with the new fields still passes.
  const withNewFields = {
    ...siteEdge as object, hero_lead: 'cash_rate', extra_tiles: [],
    metric_labels: { cash_rate: 'Cash rate' }, section_summaries: { prices: 'Quiet.' },
    section_summary_quiet: { prices: true },
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
  expect(() => assertSiteData({ ...siteEdge as object, section_summary_quiet: 'nope' }))
    .toThrow(/unexpected data shape/)
})
