import type { ChartSpec, SeriesEntry } from './types'
import type { Geo } from './urlState'
import { GEOS } from './urlState'

// Where a chart belongs for the selected geo (spec §2). One predicate, no
// hardcoded chart lists: `geos` is derived by the pipeline from the data
// itself, so a chart can never claim a geography it doesn't have.
// 'absent': a broken source with no historical geo signal, rendered at its
// own implied geo (see below) — simply not present anywhere else, and
// never footnoted (an 'absent' chart is excluded from `hiddenTitles`).
export type Band = 'grid' | 'context' | 'hidden' | 'absent'

// A missing series entry or one whose last fetch failed. Review fix: a
// broken/missing source says nothing about WHERE its data is published —
// `chart.geos` being empty could mean "never published anywhere" (a
// footnote-worthy gap) or "our fetcher is blocked right now" (an outage,
// not a gap), and `geos` alone can't tell the two apart. The series'
// live status can.
// Exported (2026-07-24 banner batch, Task 3): ChartCard's failed-source grid
// sort and App's compact-outage-card placement now share this exact
// predicate too, rather than keeping a second drifting copy.
export function isBrokenSource(series: SeriesEntry | undefined): boolean {
  return !series || series.status === 'failed'
}

export function bandFor(chart: ChartSpec, geo: Geo, series: SeriesEntry | undefined): Band {
  // Only overridden when we have NO historical geo signal at all
  // (geos: []) — a chart that DOES have data for some geo(s) already
  // carries honest evidence of where it publishes, independent of
  // today's live fetch status; suppressing ITS footnote at a geo it
  // genuinely never covered would itself be a false claim (implying that
  // geo might just be "currently down" rather than genuinely uncovered).
  if (chart.geos.length === 0 && isBrokenSource(series)) {
    // Render the honest outage card (ChartCard's existing dead-card
    // copy) in the grid, at the geo(s) implied by the chart's own
    // region_mode — never claim non-publication for a broken source.
    if (chart.region_mode === 'geo') return 'grid'   // unknown coverage: show at every geo
    if (chart.region_mode.startsWith('fixed:')) {
      const r = chart.region_mode.slice('fixed:'.length)
      if ((GEOS as readonly string[]).includes(r)) {
        // Its one fixed region IS a UI geo: show only there, absent
        // (not footnoted) everywhere else.
        return r === geo ? 'grid' : 'absent'
      }
    }
    // region_mode 'all', or fixed to a non-UI region (e.g. 'global') —
    // no geo-specific claim to make either way; fall through as usual.
  }
  if (chart.geos.includes(geo)) return 'grid'
  // No data for this geo, from a source we know to be working (or whose
  // history already tells us where it does/doesn't publish). A
  // `geo`-scope chart is a genuine gap → hide it and name it in the
  // footnote. Anything broader (state/national/global) is legitimate
  // wider context → show it below, badged with its real scope.
  return chart.scope === 'geo' ? 'hidden' : 'context'
}

// The footnote's content: charts that are neither in the grid nor on screen
// as context, AND whose gap is genuine (not a broken/missing source — see
// bandFor's 'absent' band, which is deliberately excluded here).
export function hiddenTitles(charts: ChartSpec[], geo: Geo,
                              seriesById: Record<string, SeriesEntry | undefined>): string[] {
  return charts.filter(c => bandFor(c, geo, seriesById[c.series_id]) === 'hidden').map(c => c.title)
}

// The badge a context-band chart carries, so it is never mistaken for the
// selected geography.
export const SCOPE_BADGE: Record<string, string> = {
  state: 'Victoria-wide', national: 'Australia', global: 'Global',
}
