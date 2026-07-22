// Section-level helper for the shared-outage notice (design review
// P1-outage) — pulled out of App.tsx so the aggregation logic (across every
// chart in a section) is unit-testable without a full render.
import type { ChartSpec, SeriesEntry, SiteData } from './types'
import { staleness } from './staleness'
import { fmtPeriod, shortSource } from './format'

export interface SectionOutage { token: string; period: string }

// Section-level shared-outage notice (Rents, design review P1-outage): only
// fires when EVERY distinct series backing the section's charts is
// genuinely non-fresh (stale or failed) AND they all share one source (by
// URL — source_name strings can legitimately differ, e.g. vic_rents vs
// vic_vacancy) and one vintage (last_data_date). Anything short of that
// (mixed fresh/stale, or non-matching sources/vintages) returns null so the
// per-card chips stay at their normal, individual strength.
export function sectionOutageNotice(charts: ChartSpec[], site: SiteData, now: Date):
    SectionOutage | null {
  const seriesIds = [...new Set(charts.map(c => c.series_id))]
  const entries = seriesIds
    .map(id => [id, site.series[id]] as const)
    .filter((pair): pair is [string, SeriesEntry] => !!pair[1])
  if (!entries.length) return null
  const allOutage = entries.every(([, e]) => {
    const kind = staleness(e, now).kind
    return kind === 'stale' || kind === 'failed'
  })
  if (!allOutage) return null
  const urls = new Set(entries.map(([, e]) => e.meta.source_url))
  const vintages = new Set(entries.map(([, e]) => e.meta.last_data_date))
  if (urls.size !== 1 || vintages.size !== 1) return null
  const [lastDate] = [...vintages]
  if (!lastDate) return null
  const counts = new Map<string, number>()
  for (const c of charts) counts.set(c.series_id, (counts.get(c.series_id) ?? 0) + 1)
  const primaryId = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
  const primary = site.series[primaryId]
  if (!primary) return null
  return { token: shortSource(primary.meta.source_name), period: fmtPeriod(lastDate, primary.meta.frequency) }
}

export type SectionState = 'open' | 'closed'
// 2.5: there is no viewport-aware default any more — every themed section
// defaults CLOSED on every device (spec §4, "clean list of headings").
// App.sectionOpen treats an absent override as closed.
