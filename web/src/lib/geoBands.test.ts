import { bandFor, hiddenTitles } from './geoBands'
import type { ChartSpec } from './types'

const chart = (over: Partial<ChartSpec>): ChartSpec => ({
  id: 'c', section: 's', title: 'T', series_id: 'sid', metrics: null,
  region_mode: 'geo', percent: false, markers: false, annotate: false,
  scope: 'geo', geos: [], ...over,
} as ChartSpec)

describe('bandFor', () => {
  test('a chart with data for the selected geo goes in the main grid', () => {
    expect(bandFor(chart({ scope: 'geo', geos: ['melbourne', 'regional_vic'] }), 'regional_vic'))
      .toBe('grid')
  })

  test('a geo-scope chart WITHOUT data for the selected geo is hidden, not substituted', () => {
    expect(bandFor(chart({ scope: 'geo', geos: ['melbourne'] }), 'regional_vic')).toBe('hidden')
  })

  test('a national chart is context under a Victorian geo but grid under australia', () => {
    const c = chart({ scope: 'national', geos: ['australia'] })
    expect(bandFor(c, 'melbourne')).toBe('context')
    expect(bandFor(c, 'regional_vic')).toBe('context')
    expect(bandFor(c, 'vic')).toBe('context')
    expect(bandFor(c, 'australia')).toBe('grid')
  })

  test('a state chart is grid under vic and context under metro/regional', () => {
    const c = chart({ scope: 'state', geos: ['vic', 'australia'] })
    expect(bandFor(c, 'vic')).toBe('grid')
    expect(bandFor(c, 'australia')).toBe('grid')
    expect(bandFor(c, 'melbourne')).toBe('context')
    expect(bandFor(c, 'regional_vic')).toBe('context')
  })

  test('a global chart is never in the grid — not even under australia', () => {
    const c = chart({ scope: 'global', geos: [] })
    for (const g of ['melbourne', 'regional_vic', 'vic', 'australia'] as const) {
      expect(bandFor(c, g)).toBe('context')
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
    expect(hiddenTitles(charts, 'regional_vic')).toEqual(['Vacancy'])
  })

  test('returns an empty list when nothing is hidden', () => {
    expect(hiddenTitles([chart({ scope: 'geo', geos: ['vic'] })], 'vic')).toEqual([])
  })
})
