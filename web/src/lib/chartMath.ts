import { scaleTime, scaleLinear, type ScaleTime, type ScaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { extent, bisector } from 'd3-array'
import type { Pt } from './types'

export interface FlatPt { t: number; date: string; value: number; name: string }
export interface Built {
  x: ScaleTime<number, number>; y: ScaleLinear<number, number>
  y2: ScaleLinear<number, number> | null
  paths: { name: string; d: string; color: string; axis: 'y' | 'y2' }[]
  xTicks: { x: number; label: string }[]
  yTicks: { y: number; label: string }[]
  y2Ticks: { y: number; label: string }[]
  flat: FlatPt[]
  margin: { t: number; r: number; b: number; l: number }
}

const T = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fitY(pts: FlatPt[], range: [number, number]) {
  const [v0, v1] = extent(pts, p => p.value)
  return scaleLinear([Math.min(v0 ?? 0, 0) === 0 && (v0 ?? 0) >= 0 ? 0 : (v0 ?? 0), v1 ?? 1],
                     range).nice()
}

export function buildChart(
  lines: { name: string; pts: Pt[] }[], width: number, height: number,
  opts: { colorway: readonly string[]; percent: boolean;
          margin?: { t: number; r: number; b: number; l: number }
          // Lines whose `name` is in y2Lines are plotted against a second,
          // independently-scaled right-hand axis (e.g. a compare series in
          // different units) instead of the primary left axis.
          y2Lines?: string[] },
): Built {
  const y2Names = new Set(opts.y2Lines ?? [])
  // Reserve extra room for right-axis tick labels only when a right axis is
  // actually requested and the caller hasn't supplied an explicit margin —
  // this keeps the default margin.r === 8 (today's behaviour) untouched
  // whenever y2Lines is absent.
  const margin = opts.margin ?? { t: 8, r: y2Names.size ? 40 : 8, b: 22, l: 44 }
  const flat: FlatPt[] = lines.flatMap(l =>
    l.pts.map(p => ({ t: T(p.date), date: p.date, value: p.value, name: l.name })))
  const [t0, t1] = extent(flat, p => p.t)
  const x = scaleTime([t0 ?? 0, t1 ?? 1], [margin.l, width - margin.r])

  const range: [number, number] = [height - margin.b, margin.t]
  const y1Pts = y2Names.size ? flat.filter(p => !y2Names.has(p.name)) : flat
  const y2Pts = y2Names.size ? flat.filter(p => y2Names.has(p.name)) : []
  const y = fitY(y1Pts, range)
  const y2 = y2Pts.length ? fitY(y2Pts, range) : null

  const scaleFor = (name: string) => (y2 && y2Names.has(name)) ? y2 : y
  const paths = lines.map((l, i) => {
    const s = scaleFor(l.name)
    const gen = d3line<FlatPt>().x(p => x(p.t)).y(p => s(p.value))
    return {
      name: l.name,
      d: gen(flat.filter(p => p.name === l.name)) ?? '',
      color: opts.colorway[i % opts.colorway.length],
      axis: (y2 && y2Names.has(l.name)) ? 'y2' as const : 'y' as const,
    }
  })
  const yTicks = y.ticks(4).map(v => ({
    y: y(v), label: opts.percent ? `${+v.toFixed(2)}%` : v.toLocaleString('en-AU') }))
  const y2Ticks = y2 ? y2.ticks(4).map(v => ({ y: y2(v), label: v.toLocaleString('en-AU') })) : []
  const xTicks = x.ticks(4).map(d => ({
    x: x(d), label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` }))
  flat.sort((a, b) => a.t - b.t)
  return { x, y, y2, paths, xTicks, yTicks, y2Ticks, flat, margin }
}

const bis = bisector<FlatPt, number>(p => p.t)

export function nearest(flat: FlatPt[], t: number): FlatPt | null {
  if (!flat.length) return null
  const i = bis.center(flat, t)
  return flat[Math.max(0, Math.min(flat.length - 1, i))]
}
