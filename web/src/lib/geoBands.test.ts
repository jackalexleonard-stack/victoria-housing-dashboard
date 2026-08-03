import { bandFor, hiddenTitles } from './geoBands'
import type { ChartSpec, SeriesEntry } from './types'

const chart = (over: Partial<ChartSpec>): ChartSpec => ({
  id: 'c', section: 's', title: 'T', series_id: 'sid', metrics: null,
  region_mode: 'geo', percent: false, markers: false, annotate: false,
  scope: 'geo', geos: [], ...over,
} as ChartSpec)

const series = (over: Partial<SeriesEntry> = {}): SeriesEntry => ({
  status: 'ok',
  meta: { source_name: null, source_url: null, frequency: null, last_fetched: null,
          last_changed: null, last_data_date: null, error: null, cadence_days: 1 },
  units: {}, points: [], ...over,
} as SeriesEntry)

const ok = series()   // a working source — every test below except the
                       // "broken source" describe block uses this.

describe('bandFor', () => {
  test('a chart with data for the selected geo goes in the main grid', () => {
    expect(bandFor(chart({ scope: 'geo', geos: ['melbourne', 'regional_vic'] }), 'regional_vic', ok))
      .toBe('grid')
  })

  test('a geo-scope chart WITHOUT data for the selected geo is hidden, not substituted', () => {
    expect(bandFor(chart({ scope: 'geo', geos: ['melbourne'] }), 'regional_vic', ok)).toBe('hidden')
  })

  test('a national chart is context under a Victorian geo but grid under australia', () => {
    const c = chart({ scope: 'national', geos: ['australia'] })
    expect(bandFor(c, 'melbourne', ok)).toBe('context')
    expect(bandFor(c, 'regional_vic', ok)).toBe('context')
    expect(bandFor(c, 'vic', ok)).toBe('context')
    expect(bandFor(c, 'australia', ok)).toBe('grid')
  })

  test('a state chart is grid under vic and context under metro/regional', () => {
    const c = chart({ scope: 'state', geos: ['vic', 'australia'] })
    expect(bandFor(c, 'vic', ok)).toBe('grid')
    expect(bandFor(c, 'australia', ok)).toBe('grid')
    expect(bandFor(c, 'melbourne', ok)).toBe('context')
    expect(bandFor(c, 'regional_vic', ok)).toBe('context')
  })

  test('a global chart is never in the grid — not even under australia', () => {
    const c = chart({ scope: 'global', geos: [] })
    for (const g of ['melbourne', 'regional_vic', 'vic', 'australia'] as const) {
      expect(bandFor(c, g, ok)).toBe('context')
    }
  })
})

describe('hiddenTitles', () => {
  test('lists only hidden geo-scope charts — context-band charts are on screen', () => {
    const charts = [
      chart({ id: 'a', title: 'Vacancy', scope: 'geo', geos: ['melbourne'] }),
      chart({ id: 'b', title: 'Cash rate', scope: 'national', geos: ['australia'] }),
      chart({ id: 'c', title: 'Rents', scope: 'geo', geos: ['regional_vic'] }),
    ]
    expect(hiddenTitles(charts, 'regional_vic', { sid: ok })).toEqual(['Vacancy'])
  })

  test('returns an empty list when nothing is hidden', () => {
    expect(hiddenTitles([chart({ scope: 'geo', geos: ['vic'] })], 'vic', { sid: ok })).toEqual([])
  })
})

// Review fix: a failed/missing series says nothing about WHERE its data is
// published — asserting "not published for {geo}" from geos:[] alone would
// itself be a false geographic claim (the auctions/vic_auctions case: the
// scraper is blocked, but Melbourne auction clearance IS published).
describe('a broken source never claims a geography gap', () => {
  const failed = series({ status: 'failed' })

  test('fixed-region + failed series + no historical geos: outage card only at its own (home) geo, absent (not hidden) elsewhere', () => {
    const c = chart({ region_mode: 'fixed:melbourne', scope: 'geo', geos: [] })
    expect(bandFor(c, 'melbourne', failed)).toBe('grid')
    for (const g of ['regional_vic', 'vic', 'australia'] as const) {
      expect(bandFor(c, g, failed)).toBe('absent')
    }
  })

  test('geo-mode + failed series + no historical geos: outage card at every geo — coverage is genuinely unknown', () => {
    const c = chart({ region_mode: 'geo', scope: 'geo', geos: [] })
    for (const g of ['melbourne', 'regional_vic', 'vic', 'australia'] as const) {
      expect(bandFor(c, g, failed)).toBe('grid')
    }
  })

  test('a missing series entry (no site.series[series_id] at all) is treated the same as failed', () => {
    const c = chart({ region_mode: 'fixed:vic', scope: 'state', geos: [] })
    expect(bandFor(c, 'vic', undefined)).toBe('grid')
    expect(bandFor(c, 'melbourne', undefined)).toBe('absent')
  })

  test('a chart with REAL historical geo coverage still hides/footnotes a geo it genuinely never covered, even while its source is currently down', () => {
    const c = chart({ region_mode: 'geo', scope: 'geo', geos: ['melbourne'] })
    expect(bandFor(c, 'melbourne', failed)).toBe('grid')
    expect(bandFor(c, 'regional_vic', failed)).toBe('hidden')
  })

  test('hiddenTitles never lists a broken/missing-series chart', () => {
    const auctions = chart({ id: 'auctions', title: 'Auction clearance — Melbourne',
                              series_id: 'vic_auctions', region_mode: 'fixed:melbourne',
                              scope: 'geo', geos: [] })
    for (const g of ['melbourne', 'regional_vic', 'vic', 'australia'] as const) {
      expect(hiddenTitles([auctions], g, { vic_auctions: failed })).toEqual([])
      expect(hiddenTitles([auctions], g, {})).toEqual([])   // missing entry too
    }
  })
})

import { modalRegion, REGION_BADGE, SCOPE_BADGE } from './geoBands'

const chartWithRegionMode = (region_mode: string): ChartSpec => ({
  id: 'x', section: 's', title: 'x', series_id: 'x', metrics: null,
  region_mode, scope: 'geo', geos: ['melbourne'],
  percent: false, markers: false, annotate: false })

describe('modalRegion', () => {
  test('fixed charts pin their region, geo charts follow the modal geo', () => {
    expect(modalRegion(chartWithRegionMode('fixed:australia'), 'melbourne')).toBe('australia')
    expect(modalRegion(chartWithRegionMode('fixed:global'), 'vic')).toBe('global')
    expect(modalRegion(chartWithRegionMode('geo'), 'regional_vic')).toBe('regional_vic')
  })
})

describe('REGION_BADGE', () => {
  test('speaks the card-badge vocabulary — pinned against SCOPE_BADGE', () => {
    expect(REGION_BADGE.vic).toBe(SCOPE_BADGE.state)
    expect(REGION_BADGE.australia).toBe(SCOPE_BADGE.national)
    expect(REGION_BADGE.global).toBe(SCOPE_BADGE.global)
    expect(REGION_BADGE.melbourne).toBe('Melbourne')
    expect(REGION_BADGE.regional_vic).toBe('Regional Vic')
  })
})
