import type { ChartSpec, SeriesEntry, SiteData } from './types'
import { sectionOutageNotice } from './sections'

const NOW = new Date('2026-07-21T00:00:00Z')

function entry(over: Partial<SeriesEntry['meta']> & { status?: SeriesEntry['status'] } = {}):
    SeriesEntry {
  const { status = 'ok', ...meta } = over
  return {
    status,
    meta: {
      source_name: 's', source_url: 'https://s', frequency: 'monthly',
      last_fetched: '2026-07-20T00:00:00Z', last_changed: '2026-07-20T00:00:00Z',
      last_data_date: '2026-07-01', error: null, cadence_days: 31, ...meta,
    },
    units: {}, points: [],
  }
}

function chart(over: Partial<ChartSpec> & Pick<ChartSpec, 'id' | 'series_id'>): ChartSpec {
  return { section: 'x', title: over.id, metrics: null, region_mode: 'geo',
           scope: 'geo', geos: [], percent: false, markers: false, annotate: false, ...over }
}

function site(series: Record<string, SeriesEntry>): SiteData {
  return {
    schema_version: 1, generated_at: NOW.toISOString(), sections: [],
    charts: [], findings: {}, series, hero: [], whats_new: [],
    annotations: { cash_rate_moves: [], accord_start: '2024-07-01' },
  }
}

describe('sectionOutageNotice', () => {
  test('fires when every distinct series is non-fresh and shares one source URL and vintage', () => {
    const s = site({
      vic_rents: entry({ status: 'ok', source_name: 'DFFH / Homes Victoria Rental Report',
                          source_url: 'https://dffh', last_data_date: '2025-09-30', frequency: 'quarterly',
                          cadence_days: 92 }),
      vic_vacancy: entry({ status: 'failed', source_name: 'SQM via DFFH', source_url: 'https://dffh',
                            last_data_date: '2025-09-30', frequency: 'monthly', cadence_days: 31 }),
    })
    const charts = [
      chart({ id: 'rent1', series_id: 'vic_rents' }),
      chart({ id: 'rent2', series_id: 'vic_rents' }),
      chart({ id: 'vacancy', series_id: 'vic_vacancy' }),
    ]
    const notice = sectionOutageNotice(charts, s, NOW)
    expect(notice).toEqual({ token: 'DFFH', period: 'Sep qtr 2025', seriesId: 'vic_rents' })
  })

  test('does not fire when one series is fresh', () => {
    const s = site({
      a: entry({ last_data_date: '2026-07-15' }),
      b: entry({ status: 'failed', last_data_date: '2025-01-01' }),
    })
    const charts = [chart({ id: 'a', series_id: 'a' }), chart({ id: 'b', series_id: 'b' })]
    expect(sectionOutageNotice(charts, s, NOW)).toBeNull()
  })

  test('does not fire when sources/vintages differ even though both are stale', () => {
    const s = site({
      a: entry({ status: 'failed', source_url: 'https://one', last_data_date: '2025-01-01' }),
      b: entry({ status: 'failed', source_url: 'https://two', last_data_date: '2025-02-01' }),
    })
    const charts = [chart({ id: 'a', series_id: 'a' }), chart({ id: 'b', series_id: 'b' })]
    expect(sectionOutageNotice(charts, s, NOW)).toBeNull()
  })
})
