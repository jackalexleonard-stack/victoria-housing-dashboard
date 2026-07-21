import type { ChartSpec, SeriesEntry, SiteData } from './types'
import { collapsedSummaryText, defaultSectionOpen, honestOverrideText,
         sectionOutageNotice, worstStaleness } from './sections'

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
           percent: false, markers: false, annotate: false, ...over }
}

function site(series: Record<string, SeriesEntry>): SiteData {
  return {
    schema_version: 1, generated_at: NOW.toISOString(), sections: [],
    charts: [], findings: {}, series, hero: [], whats_new: [],
    annotations: { cash_rate_moves: [], accord_start: '2024-07-01' },
  }
}

describe('worstStaleness', () => {
  test('picks the worst kind across a section\'s charts', () => {
    const s = site({
      a: entry({ last_data_date: '2026-07-15' }),                        // fresh
      b: entry({ status: 'failed', last_data_date: '2025-01-01' }),      // failed
    })
    const charts = [chart({ id: 'a', series_id: 'a' }), chart({ id: 'b', series_id: 'b' })]
    const worst = worstStaleness(charts, s, NOW)
    expect(worst?.st.kind).toBe('failed')
  })

  test('returns null when no chart resolves to a series', () => {
    expect(worstStaleness([chart({ id: 'a', series_id: 'missing' })], site({}), NOW)).toBeNull()
  })
})

describe('collapsedSummaryText', () => {
  // T6: the honesty override now keys off the pipeline's own
  // section_summary_quiet boolean (derived in Python where the sentinel
  // strings are authored), not a client-side byte-match against the
  // rendered prose — so these tests drive it with the flag directly.
  test('overrides a quiet-flagged summary when the worst series is stale/failed', () => {
    const worst = { entry: entry({ status: 'failed', last_data_date: '2025-09-30', frequency: 'monthly' }),
                    st: { kind: 'failed' as const, label: 'x' } }
    const text = collapsedSummaryText('No notable moves in Rents & vacancy this week.',
      true, worst)
    expect(text).toBe('Data to Sep 2025 — source unavailable')
  })

  test('keeps a REAL finding (quiet=false) even when some series in the section is stale (does not suppress news)', () => {
    const worst = { entry: entry({ status: 'failed', last_data_date: null }),
                    st: { kind: 'failed' as const, label: 'x' } }
    const text = collapsedSummaryText('Dwelling values fell 0.6% in Jun 2026', false, worst)
    expect(text).toBe('Dwelling values fell 0.6% in Jun 2026')
  })

  test('no override when the worst kind is merely ageing, even if quiet is flagged', () => {
    const worst = { entry: entry(), st: { kind: 'ageing' as const, label: 'x' } }
    const text = collapsedSummaryText('No notable moves in Money & credit this week.', true, worst)
    expect(text).toBe('No notable moves in Money & credit this week.')
  })

  test('no override when quiet is false, even if the worst series is stale/failed', () => {
    const worst = { entry: entry({ status: 'failed', last_data_date: '2025-09-30' }),
                    st: { kind: 'failed' as const, label: 'x' } }
    const text = collapsedSummaryText('No notable moves in Rents & vacancy this week.', false, worst)
    expect(text).toBe('No notable moves in Rents & vacancy this week.')
  })

  test('falls back to "No data" wording when the worst entry never had data', () => {
    const worst = { entry: entry({ status: 'failed', last_data_date: null }),
                    st: { kind: 'failed' as const, label: 'x' } }
    expect(honestOverrideText(worst)).toBe('No data — source unavailable')
  })
})

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
    expect(notice).toEqual({ token: 'DFFH', period: 'Sep qtr 2025' })
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

describe('defaultSectionOpen', () => {
  test('desktop: only world starts closed', () => {
    expect(defaultSectionOpen('world', false)).toBe(false)
    expect(defaultSectionOpen('rents', false)).toBe(true)
    expect(defaultSectionOpen('news', false)).toBe(true)
  })

  test('mobile (coarse pointer): everything after Today starts closed, world included', () => {
    expect(defaultSectionOpen('world', true)).toBe(false)
    expect(defaultSectionOpen('rents', true)).toBe(false)
    expect(defaultSectionOpen('news', true)).toBe(false)
  })
})
