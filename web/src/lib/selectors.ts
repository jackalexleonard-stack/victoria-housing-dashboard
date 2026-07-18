import type { ChartSpec, Pt, SiteData } from './types'
import type { Geo, Range } from './urlState'

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
      lines.push({ name: metric.replaceAll('_', ' '),
                   pts: pts.filter(p => p.metric === metric)
                          .sort((a, b) => a.date.localeCompare(b.date)) })
  }
  return { lines, scopeNote }
}
