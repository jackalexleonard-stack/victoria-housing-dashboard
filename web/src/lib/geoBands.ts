import type { ChartSpec } from './types'
import type { Geo } from './urlState'

// Where a chart belongs for the selected geo (spec §2). One predicate, no
// hardcoded chart lists: `geos` is derived by the pipeline from the data
// itself, so a chart can never claim a geography it doesn't have.
export type Band = 'grid' | 'context' | 'hidden'

export function bandFor(chart: ChartSpec, geo: Geo): Band {
  if (chart.geos.includes(geo)) return 'grid'
  // No data for this geo. A `geo`-scope chart is a genuine gap → hide it and
  // name it in the footnote. Anything broader (state/national/global) is
  // legitimate wider context → show it below, badged with its real scope.
  return chart.scope === 'geo' ? 'hidden' : 'context'
}

// The footnote's content: charts that are neither in the grid nor on screen
// as context — i.e. real gaps for this geography.
export function hiddenTitles(charts: ChartSpec[], geo: Geo): string[] {
  return charts.filter(c => bandFor(c, geo) === 'hidden').map(c => c.title)
}

// The badge a context-band chart carries, so it is never mistaken for the
// selected geography.
export const SCOPE_BADGE: Record<string, string> = {
  state: 'Victoria-wide', national: 'Australia', global: 'Global',
}
