import type { SeriesEntry } from './types'
import { fmtPeriod } from './format'

const DAY = 86_400_000

export function staleness(e: SeriesEntry, now: Date) {
  const { last_data_date, frequency, cadence_days } = e.meta
  const period = last_data_date ? `Data to ${fmtPeriod(last_data_date, frequency)}` : null
  if (e.status === 'failed')
    return { kind: 'failed' as const,
             label: period ? `${period} · source unavailable` : 'No data · source unavailable' }
  if (!period) return { kind: 'stale' as const, label: 'No data' }
  const gap = (now.getTime() - Date.parse(`${last_data_date}T00:00:00Z`)) / DAY
  if (gap > 2.5 * cadence_days) return { kind: 'stale' as const, label: `${period} · stale` }
  if (gap > 1.5 * cadence_days) return { kind: 'ageing' as const, label: `${period} · ageing` }
  return { kind: 'fresh' as const, label: period }
}

export function nextUpdate(e: SeriesEntry, _now: Date): string | null {
  const { last_data_date, frequency, cadence_days } = e.meta
  if (!last_data_date) return null
  const next = new Date(Date.parse(`${last_data_date}T00:00:00Z`) + cadence_days * DAY)
  return `next update ~${fmtPeriod(next.toISOString(), frequency)}`
}

export function siteIsStale(generatedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(generatedAt) > 48 * 3_600_000
}
