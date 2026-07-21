// Section-level helpers for the collapsed-row summary/chip and the shared-
// outage notice (design review P0-3 / P1-outage) — pulled out of App.tsx so
// the aggregation logic (across every chart in a section) is unit-testable
// without a full render.
import type { ChartSpec, SeriesEntry, SiteData } from './types'
import { staleness } from './staleness'
import { fmtPeriod, shortSource } from './format'

const RANK: Record<'fresh' | 'ageing' | 'stale' | 'failed', number> =
  { fresh: 0, ageing: 1, stale: 2, failed: 3 }

export interface WorstEntry { entry: SeriesEntry; st: ReturnType<typeof staleness> }

// The single worst-staleness series among a section's charts (deduped by
// series_id isn't necessary here — ties just keep whichever was seen first,
// and same-series charts always agree on staleness anyway).
export function worstStaleness(charts: ChartSpec[], site: SiteData, now: Date): WorstEntry | null {
  let worst: WorstEntry | null = null
  for (const c of charts) {
    const entry = site.series[c.series_id]
    if (!entry) continue
    const st = staleness(entry, now)
    if (!worst || RANK[st.kind] > RANK[worst.st.kind]) worst = { entry, st }
  }
  return worst
}

// The honest replacement for a quiet-sentinel summary when the section is
// actually sitting on stale/failed data (design review's controller
// upgrade): "Data to {period} — source unavailable", derived from the
// worst chart's own entry.
export function honestOverrideText(worst: WorstEntry): string {
  const { last_data_date, frequency } = worst.entry.meta
  return last_data_date
    ? `Data to ${fmtPeriod(last_data_date, frequency)} — source unavailable`
    : 'No data — source unavailable'
}

// The text a collapsed section row should show: the pipeline's own
// section_summaries sentence, UNLESS it's the generic quiet sentinel (per
// the pipeline's own section_summary_quiet flag — T6: no longer a client-
// side byte-match against the sentinel prose, which silently stopped firing
// the moment the prose drifted from the two hardcoded strings) while the
// section's worst series is actually stale/failed — in which case claiming
// "no notable moves" would be dishonest, so the real status replaces it. A
// section with a genuine finding (quiet=false) keeps that finding even if
// some OTHER series in the section is stale — the worst-status chip
// (rendered alongside, unconditionally) still surfaces the outage without
// suppressing real news.
export function collapsedSummaryText(
  exported: string | null | undefined, quiet: boolean, worst: WorstEntry | null,
): string | null {
  if (worst && (worst.st.kind === 'failed' || worst.st.kind === 'stale') && quiet) {
    return honestOverrideText(worst)
  }
  return exported ?? null
}

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

// Desktop: only 'world' starts closed. Mobile (coarse pointer): every
// section after Today starts closed, `world` included — the daily scan on
// a phone is the tightest budget of all, so nothing below the fold is
// exempt (design review P0-3).
export function defaultSectionOpen(id: string, coarsePointer: boolean): boolean {
  if (coarsePointer) return false
  return id !== 'world'
}
