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

// Tick-label formatting for the y/y2 axes. Percent charts are already
// suffixed and compact by nature (never exceeds a couple of digits), so they
// pass through unchanged. Non-percent values get compact notation once they
// grow past the point where a full `toLocaleString` would blow out the fixed
// 44px left margin (e.g. `1,000,000` clips to `00,000`) — millions collapse
// to `1M`/`1.5M`, tens-of-thousands-and-up collapse to whole `k`, and
// anything smaller keeps today's comma-grouped formatting.
export function fmtTickLabel(v: number, percent: boolean): string {
  if (percent) return `${+v.toFixed(2)}%`
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${+(v / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${Math.round(v / 1_000)}k`
  return v.toLocaleString('en-AU')
}

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
          y2Lines?: string[]
          // Whether the y2 axis's own series is a percent unit — mirrors
          // `percent` but applies to the right-hand tick labels only.
          y2Percent?: boolean },
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
  const yTicks = y.ticks(4).map(v => ({ y: y(v), label: fmtTickLabel(v, opts.percent) }))
  const y2Ticks = y2 ? y2.ticks(4).map(v => ({
    y: y2(v), label: fmtTickLabel(v, !!opts.y2Percent) })) : []
  const xTicks = x.ticks(4).map(d => ({
    x: x(d), label: `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}` }))
  flat.sort((a, b) => a.t - b.t)
  return { x, y, y2, paths, xTicks, yTicks, y2Ticks, flat, margin }
}

// Decides which of two label rows (0 or 1) each annotation's text should
// render in, given its pixel x position — or null when it should be skipped
// entirely (the dashed marker line still always renders; only the text is
// best-effort). Dense clusters (e.g. the 2022-23 cash-rate cycle) would
// otherwise pile every label onto one row at the same height.
//
// Annotations are visited in x-sorted order. Each gets a "primary" row that
// simply alternates by sorted position (0, 1, 0, 1, ...), so neighbours
// default to different rows. If the primary row's last PLACED label (in that
// row) is still closer than `minGap`, the other row is tried instead; if
// both rows are too close, the label is dropped (row stays null) without
// disturbing either row's "last placed" tracking.
export function placeAnnotationLabels(xs: number[], minGap: number): (0 | 1 | null)[] {
  const order = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b])
  const result: (0 | 1 | null)[] = new Array(xs.length).fill(null)
  const lastX: [number | null, number | null] = [null, null]
  const fits = (row: 0 | 1, x: number) => {
    const last = lastX[row]
    return last === null || x - last >= minGap
  }
  order.forEach((origIndex, pos) => {
    const x = xs[origIndex]
    const primary: 0 | 1 = pos % 2 === 0 ? 0 : 1
    const secondary: 0 | 1 = primary === 0 ? 1 : 0
    const row = fits(primary, x) ? primary : fits(secondary, x) ? secondary : null
    if (row !== null) {
      lastX[row] = x
      result[origIndex] = row
    }
  })
  return result
}

const bis = bisector<FlatPt, number>(p => p.t)

export function nearest(flat: FlatPt[], t: number): FlatPt | null {
  if (!flat.length) return null
  const i = bis.center(flat, t)
  return flat[Math.max(0, Math.min(flat.length - 1, i))]
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b)
  const n = s.length
  if (!n) return Infinity
  const mid = Math.floor(n / 2)
  return n % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Median gap between consecutive DISTINCT timestamps in a set of points.
// Used both per-line (that line's own cadence) and across an entire chart's
// flattened points (the finest signal actually present), to size how far
// atTime may reach for a "nearby" point instead of requiring an exact match.
// Fewer than two distinct timestamps has no gap to measure — Infinity means
// "this axis places no cap", not "anything goes" (atTime still combines it
// with the other tolerance via Math.min).
function medianSpacing(times: number[]): number {
  const uniq = [...new Set(times)].sort((a, b) => a - b)
  if (uniq.length < 2) return Infinity
  const diffs: number[] = []
  for (let i = 1; i < uniq.length; i++) diffs.push(uniq[i] - uniq[i - 1])
  return median(diffs)
}

// x-unified lookup: snap to the nearest observed timestamp (t*), then for
// EACH line independently find its own nearest point to t* and include it if
// that point is within tolerance — rather than requiring an exact timestamp
// match. This makes mixed-cadence overlays (e.g. DetailView's "Compare",
// pairing a daily chart with a quarterly one) honest instead of either
// silently dropping the other line or (previously) never matching at all:
// each returned point keeps ITS OWN date, which may differ from t* — callers
// that care (the tooltip) show that difference rather than hiding it.
//
// tolerance per line = min(half that line's own median point-spacing,
// half the OVERALL median spacing across every line in the chart). The
// per-line half-spacing lets a line reach roughly to its own neighbouring
// point; the overall half-spacing caps that reach so a coarse-cadence line
// can't claim a point from far away just because ITS OWN spacing is wide,
// when the rest of the chart is much finer-grained. A line with nothing
// within tolerance stays absent, same as the old exact-only behaviour.
export function atTime(flat: FlatPt[], t: number): { t: number; points: FlatPt[] } {
  const n = nearest(flat, t)
  if (!n) return { t, points: [] }
  const overallHalf = medianSpacing(flat.map(p => p.t)) / 2

  // Group by line, preserving each line's own chronological order (flat is
  // already time-sorted, so any subsequence of it stays sorted) and the
  // order lines first appear in flat — which matches the original
  // line-construction order whenever lines share a start date, per the
  // stable-sort reasoning this function used to rely on directly.
  const byName = new Map<string, FlatPt[]>()
  for (const p of flat) {
    const line = byName.get(p.name)
    if (line) line.push(p)
    else byName.set(p.name, [p])
  }

  const points: FlatPt[] = []
  for (const linePts of byName.values()) {
    const cand = nearest(linePts, n.t)
    if (!cand) continue
    const lineHalf = medianSpacing(linePts.map(p => p.t)) / 2
    const tol = Math.min(lineHalf, overallHalf)
    if (Math.abs(cand.t - n.t) <= tol) points.push(cand)
  }
  return { t: n.t, points }
}
