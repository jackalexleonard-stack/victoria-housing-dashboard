import type { SeriesEntry } from './types'
import { fmtPeriod } from './format'

const DAY = 86_400_000

export function staleness(e: SeriesEntry, now: Date) {
  const { last_data_date, frequency, cadence_days } = e.meta
  const period = last_data_date ? `Data to ${fmtPeriod(last_data_date, frequency)}` : null
  if (!period) {
    // Spec 2026-07-31 §1.1: "source unavailable" is reserved for a series
    // with no data at all — everything with history is tagged by age alone.
    return e.status === 'failed'
      ? { kind: 'failed' as const, label: 'No data · source unavailable' }
      : { kind: 'stale' as const, label: 'No data' }
  }
  const gap = (now.getTime() - Date.parse(`${last_data_date}T00:00:00Z`)) / DAY
  if (gap > 2.5 * cadence_days) return { kind: 'stale' as const, label: `${period} · stale` }
  if (gap > 1.5 * cadence_days) return { kind: 'ageing' as const, label: `${period} · ageing` }
  return { kind: 'fresh' as const, label: period }
}

// How many releases the publisher looks to be behind — floor(gap/cadence)
// minus one cadence of normal publication lag. Computed live so explainer
// copy never rots as a late publisher falls further behind.
export function releasesBehind(e: SeriesEntry, now: Date): number {
  const { last_data_date, cadence_days } = e.meta
  if (!last_data_date) return 0
  const gap = (now.getTime() - Date.parse(`${last_data_date}T00:00:00Z`)) / DAY
  return Math.max(0, Math.floor(gap / cadence_days) - 1)
}

export function nextUpdate(e: SeriesEntry, now: Date): string | null {
  const { last_data_date, frequency, cadence_days } = e.meta
  if (!last_data_date) return null
  const t = Date.parse(`${last_data_date}T00:00:00Z`) + cadence_days * DAY
  const period = fmtPeriod(new Date(t).toISOString(), frequency)
  return t < now.getTime() ? `next update was due ~${period}` : `next update ~${period}`
}

export function siteIsStale(generatedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(generatedAt) > 48 * 3_600_000
}
