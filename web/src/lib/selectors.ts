import type { ChartSpec, Pt, SeriesEntry, SiteData } from './types'
import type { Geo, Range } from './urlState'
import { staleness } from './staleness'

export const GEO_LABEL: Record<string, string> = {
  melbourne: 'Melbourne', regional_vic: 'Regional Vic', vic: 'Victoria',
  australia: 'Australia-wide', global: 'Global',
}

const FALLBACK: Record<Geo, string[]> = {
  melbourne: ['melbourne', 'vic', 'australia'],
  regional_vic: ['regional_vic', 'vic', 'australia'],
  vic: ['vic', 'australia'],
  australia: ['australia'],
}

const YEARS: Record<Exclude<Range, 'all'>, number> = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 }

// Single source of truth for turning a raw metric key into a display-ready
// line name — used both to build chart lines and to key per-metric unit
// lookups (unitByName), so the two always agree on naming. `labels` is
// site.metric_labels (design review P1-labels/ux-copy: an export-time
// display map that kills machine-vocabulary legends like "credit housing
// mom") — falls back to the old underscore-stripping humanisation for any
// metric the map doesn't cover (or when no map is supplied at all, e.g.
// older fixtures without metric_labels).
export function lineName(metric: string, labels?: Record<string, string>): string {
  return labels?.[metric] ?? metric.replaceAll('_', ' ')
}

function cutoff(range: Range, now: Date): number {
  if (range === 'all') return -Infinity
  const d = new Date(now)
  d.setUTCFullYear(d.getUTCFullYear() - YEARS[range])
  return d.getTime()
}

export function chartPoints(site: SiteData, chart: ChartSpec, range: Range,
                            geo: Geo, now: Date) {
  const entry = site.series[chart.series_id]
  if (!entry) return { lines: [], scopeNote: null }
  const min = cutoff(range, now)
  let pts = entry.points.filter(p => Date.parse(`${p.date}T00:00:00Z`) >= min)
  if (chart.metrics) pts = pts.filter(p => chart.metrics!.includes(p.metric))

  let scopeNote: string | null = null
  if (chart.region_mode.startsWith('fixed:')) {
    const r = chart.region_mode.slice(6)
    pts = pts.filter(p => p.region === r)
  } else if (chart.region_mode === 'geo') {
    const regions = [...new Set(pts.map(p => p.region))]
    const hit = FALLBACK[geo].find(r => regions.includes(r)) ?? regions[0]
    if (hit === undefined) return { lines: [], scopeNote: null }
    if (hit !== geo) scopeNote = GEO_LABEL[hit] ?? hit
    pts = pts.filter(p => p.region === hit)
  }

  const lines: { name: string; pts: Pt[] }[] = []
  if (chart.region_mode === 'all') {
    for (const region of [...new Set(pts.map(p => p.region))])
      lines.push({ name: GEO_LABEL[region] ?? region,
                   pts: pts.filter(p => p.region === region) })
  } else {
    for (const metric of [...new Set(pts.map(p => p.metric))])
      lines.push({ name: lineName(metric, site.metric_labels),
                   pts: pts.filter(p => p.metric === metric)
                          .sort((a, b) => a.date.localeCompare(b.date)) })
  }
  return { lines, scopeNote }
}

// Backlog cleanup: ChartCard and DetailView both derived the same ~15-20
// line block (entry lookup, chartPoints, per-line unit map, primary unit,
// staleness) with only cosmetic variable-naming differences. One shared
// derivation, called by both, so the two can't drift out of sync. A plain
// function, not a real React hook (it calls no hooks itself) — safe to call
// from any component body, but named `useChartData` to match how both
// call sites use it (compute-once-per-render, chart-keyed).
export interface ChartData {
  entry: SeriesEntry | undefined
  lines: { name: string; pts: Pt[] }[]
  scopeNote: string | null
  chartMetrics: string[]
  primaryMetric: string
  // undefined (not {}) when the series can't be found at all — matches
  // ChartCard's own long-standing convention; DetailView falls back to {}
  // itself where it needs an always-defined object to spread.
  unitByName: Record<string, string> | undefined
  unit: string
  st: ReturnType<typeof staleness> | null
}

export function useChartData(site: SiteData, chart: ChartSpec, range: Range,
                              geo: Geo, now: Date): ChartData {
  const entry = site.series[chart.series_id]
  const { lines, scopeNote } = chartPoints(site, chart, range, geo, now)
  // A series can carry mixed units across its metrics (e.g. vic_rents:
  // rent_growth_annual=percent, median_rent=aud) — one scalar unit for the
  // whole chart would misformat whichever metric isn't first. Build a
  // per-line unit map from the chart's own metrics (or, for region-mode
  // charts with no explicit metrics list, every metric the series has) and
  // let LineChart/DataTable key off the line name. The scalar `unit` stays
  // as a fallback for lines that don't match (e.g. region_mode 'all', whose
  // line names are region labels, not metric names) — derived from the
  // chart's primary metric where identifiable.
  const chartMetrics = chart.metrics ?? (entry ? Object.keys(entry.units) : [])
  const unitByName = entry
    ? Object.fromEntries(chartMetrics.map(m => [lineName(m, site.metric_labels), entry.units[m] ?? '']))
    : undefined
  const primaryMetric = chartMetrics[0]
  const unit = entry ? (entry.units[primaryMetric] ?? Object.values(entry.units)[0] ?? '') : ''
  const st = entry ? staleness(entry, now) : null
  return { entry, lines, scopeNote, chartMetrics, primaryMetric, unitByName, unit, st }
}
