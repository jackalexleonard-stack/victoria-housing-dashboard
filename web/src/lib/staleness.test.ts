import { staleness, nextUpdate, siteIsStale } from './staleness'
import type { SeriesEntry } from './types'

const entry = (over: Partial<SeriesEntry['meta']>, status: 'ok' | 'failed' = 'ok'): SeriesEntry => ({
  status, units: {}, points: [],
  meta: { source_name: 's', source_url: 'u', frequency: 'monthly',
    last_fetched: '2026-07-17T00:00:00Z', last_changed: null,
    last_data_date: '2026-06-30', error: null, cadence_days: 31, ...over },
})
const NOW = new Date('2026-07-18T00:00:00Z')

test('fresh within 1.5 cadences', () => {
  expect(staleness(entry({}), NOW)).toEqual({ kind: 'fresh', label: 'Data to Jun 2026' })
})

test('ageing past 1.5 cadences, stale past 2.5', () => {
  expect(staleness(entry({ last_data_date: '2026-05-20' }), NOW).kind).toBe('ageing')
  expect(staleness(entry({ last_data_date: '2026-04-01' }), NOW).kind).toBe('stale')
  expect(staleness(entry({ last_data_date: '2026-04-01' }), NOW).label)
    .toBe('Data to Apr 2026 · stale')
})

test('failed wins regardless of dates', () => {
  const s = staleness(entry({ last_data_date: null }, 'failed'), NOW)
  expect(s).toEqual({ kind: 'failed', label: 'No data · source unavailable' })
  expect(staleness(entry({}, 'failed'), NOW).label)
    .toBe('Data to Jun 2026 · source unavailable')
})

test('next update estimate and site banner', () => {
  expect(nextUpdate(entry({}), NOW)).toBe('next update ~Jul 2026')
  expect(nextUpdate(entry({ last_data_date: null }), NOW)).toBeNull()
  expect(siteIsStale('2026-07-17T04:00:00Z', NOW)).toBe(false)
  expect(siteIsStale('2026-07-15T04:00:00Z', NOW)).toBe(true)
})
