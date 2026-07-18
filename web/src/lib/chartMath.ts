import { scaleTime, scaleLinear, type ScaleTime, type ScaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { extent, bisector } from 'd3-array'
import type { Pt } from './types'

export interface FlatPt { t: number; date: string; value: number; name: string }
export interface Built {
  x: ScaleTime<number, number>; y: ScaleLinear<number, number>
  paths: { name: string; d: string; color: string }[]
  xTicks: { x: number; label: string }[]
  yTicks: { y: number; label: string }[]
  flat: FlatPt[]
  margin: { t: number; r: number; b: number; l: number }
}

const T = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function buildChart(
  lines: { name: string; pts: Pt[] }[], width: number, height: number,
  opts: { colorway: readonly string[]; percent: boolean;
          margin?: { t: number; r: number; b: number; l: number } },
): Built {
  const margin = opts.margin ?? { t: 8, r: 8, b: 22, l: 44 }
  const flat: FlatPt[] = lines.flatMap(l =>
    l.pts.map(p => ({ t: T(p.date), date: p.date, value: p.value, name: l.name })))
  const [t0, t1] = extent(flat, p => p.t)
  const [v0, v1] = extent(flat, p => p.value)
  const x = scaleTime([t0 ?? 0, t1 ?? 1], [margin.l, width - margin.r])
  const y = scaleLinear([Math.min(v0 ?? 0, 0) === 0 && (v0 ?? 0) >= 0 ? 0 : (v0 ?? 0), v1 ?? 1],
                        [height - margin.b, margin.t]).nice()
  const gen = d3line<FlatPt>().x(p => x(p.t)).y(p => y(p.value))
  const paths = lines.map((l, i) => ({
    name: l.name,
    d: gen(flat.filter(p => p.name === l.name)) ?? '',
    color: opts.colorway[i % opts.colorway.length],
  }))
  const yTicks = y.ticks(4).map(v => ({
    y: y(v), label: opts.percent ? `${+v.toFixed(2)}%` : v.toLocaleString('en-AU') }))
  const xTicks = x.ticks(4).map(d => ({
    x: x(d), label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` }))
  flat.sort((a, b) => a.t - b.t)
  return { x, y, paths, xTicks, yTicks, flat, margin }
}

const bis = bisector<FlatPt, number>(p => p.t)

export function nearest(flat: FlatPt[], t: number): FlatPt | null {
  if (!flat.length) return null
  const i = bis.center(flat, t)
  return flat[Math.max(0, Math.min(flat.length - 1, i))]
}
