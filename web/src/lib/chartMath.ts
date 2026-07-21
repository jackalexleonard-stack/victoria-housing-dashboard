import { scaleTime, scaleLinear, type ScaleTime, type ScaleLinear } from 'd3-scale'
import { line as d3line } from 'd3-shape'
import { extent, bisector } from 'd3-array'
import type { Pt } from './types'

export interface FlatPt { t: number; date: string; value: number; name: string }
export interface Built {
  x: ScaleTime<number, number>; y: ScaleLinear<number, number>
  y2: ScaleLinear<number, number> | null
  // Whether the axis's OWN underlying data (not the padded/nice-d domain)
  // genuinely straddles zero — drives whether LineChart draws the
  // #B7B5AC zeroline reference (design review P1-axes: "keep zero baseline
  // ONLY when data genuinely spans zero").
  yZero: boolean; y2Zero: boolean
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

// Fraction of the data span added as headroom on EACH side of the domain
// (design review P1-axes: "~10-15% padding" — 12% chosen, matching the
// task spec's own worked example). This is also what fixes the HVI
// top-edge clipping: the old domain topped out at exactly the data's own
// max (nice() might round it only fractionally, or not at all, if the max
// already sits near a round number), so the highest points rendered flush
// against the plot's top edge. Padding guarantees genuine headroom above
// v1 (and below v0) before nice() gets a chance to round further.
const Y_PAD_FRACTION = 0.12

// MIN-SPAN guard (design review P1-axes): a near-flat series (e.g. the cash
// rate literally unchanged for months, or a level series that moved only a
// trivial amount) must not have its axis auto-zoomed onto that tiny real
// span — doing so would render an unremarkable (or nonexistent) move as a
// dramatic full-height swing. The floor scales with the series' OWN
// magnitude rather than a single fixed number, since a fixed floor can't
// work across units that differ by orders of magnitude (AUD/USD ~0.65 vs
// mean dwelling price ~$950,000) — 1% of the series' own max keeps the
// floor proportionate. Percent-unit charts (cash rate, credit growth, ...)
// get a flat one-percentage-point floor instead: "1%" of a value that's
// itself already a small percentage (e.g. 1% of 3.85% ~= 0.04pp) would be
// far too tight to prevent the over-dramatization this guard exists for,
// whereas one whole percentage point is a consistent, legible "smallest
// meaningful move" regardless of whether the series sits near 1% or 90%.
function minSpanFloor(percent: boolean, maxAbs: number): number {
  if (percent) return 1
  return maxAbs > 0 ? maxAbs * 0.01 : 1
}

// True when the axis's raw data extent straddles zero (strictly on both
// sides — not just touching it at one edge). Used both to decide whether
// LineChart draws the zeroline reference and, implicitly, by fitY: because
// fitY always pads outward from the full [v0, v1] extent, a domain that
// contains zero in the source data is guaranteed to still contain zero
// after padding — no special-casing needed in fitY itself.
function spansZero(pts: FlatPt[]): boolean {
  const [v0, v1] = extent(pts, p => p.value)
  return v0 !== undefined && v1 !== undefined && v0 < 0 && v1 > 0
}

// Data extent + padding, with a minimum-span floor for near-flat series.
// Deliberately DROPS the old "always start non-negative domains at 0"
// behaviour (design review P1-axes): a zero baseline flattened genuinely
// level series like mean dwelling price into a barely-visible line over
// mostly-dead whitespace. The new domain is centred on the data's own
// midpoint and grown by max(dataSpan, floor)/2 + padding each way — when
// the floor doesn't bind, that reduces exactly to "data extent + padding"
// (mid ± dataSpan/2 == [v0, v1]); when it does bind (near-flat data), the
// axis widens symmetrically around the data instead.
function fitY(pts: FlatPt[], range: [number, number], percent: boolean) {
  const [v0, v1] = extent(pts, p => p.value)
  if (v0 === undefined || v1 === undefined) return scaleLinear([0, 1], range).nice()
  const dataSpan = v1 - v0
  const maxAbs = Math.max(Math.abs(v0), Math.abs(v1))
  const span = Math.max(dataSpan, minSpanFloor(percent, maxAbs))
  const pad = span * Y_PAD_FRACTION
  const mid = (v0 + v1) / 2
  const half = span / 2 + pad
  return scaleLinear([mid - half, mid + half], range).nice()
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
          y2Percent?: boolean
          // Explicit [start, end] epoch-ms x-domain, overriding this chart's
          // own data extent (design review P1: "mortgage minis' shared
          // x-range is coincidental" — small multiples built from
          // independently-filtered subsets must share one STRUCTURAL
          // x-domain rather than relying on their subsets happening to carry
          // the same dates). Falls back to the data's own extent when absent
          // — every existing caller is unaffected.
          xDomain?: [number, number] },
): Built {
  const y2Names = new Set(opts.y2Lines ?? [])
  // Reserve extra room for right-axis tick labels only when a right axis is
  // actually requested and the caller hasn't supplied an explicit margin —
  // this keeps the default margin.r === 8 (today's behaviour) untouched
  // whenever y2Lines is absent.
  const margin = opts.margin ?? { t: 8, r: y2Names.size ? 40 : 8, b: 22, l: 44 }
  const flat: FlatPt[] = lines.flatMap(l =>
    l.pts.map(p => ({ t: T(p.date), date: p.date, value: p.value, name: l.name })))
  const [t0, t1] = opts.xDomain ?? extent(flat, p => p.t)
  const x = scaleTime([t0 ?? 0, t1 ?? 1], [margin.l, width - margin.r])

  const range: [number, number] = [height - margin.b, margin.t]
  const y1Pts = y2Names.size ? flat.filter(p => !y2Names.has(p.name)) : flat
  const y2Pts = y2Names.size ? flat.filter(p => y2Names.has(p.name)) : []
  const y = fitY(y1Pts, range, opts.percent)
  const y2 = y2Pts.length ? fitY(y2Pts, range, !!opts.y2Percent) : null
  const yZero = spansZero(y1Pts)
  const y2Zero = y2 ? spansZero(y2Pts) : false

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
  return { x, y, y2, yZero, y2Zero, paths, xTicks, yTicks, y2Ticks, flat, margin }
}

// Combined [start, end] epoch-ms x-extent across MULTIPLE independently-
// filtered line groups (design review P1: "mortgage minis' shared x-range is
// coincidental" — ChartCard's New/Outstanding mortgage minis each run their
// own buildChart over a separately-filtered subset of the same series, so
// their x-ranges only match today because those subsets happen to carry the
// same dates). The caller combines its subsets' groups into one array and
// passes the result as buildChart's `xDomain` so every mini is guaranteed —
// structurally, not coincidentally — to share one x-domain.
//
// Also doubles as the single source of truth for "is this annotation date
// within the chart's own plotted range": because buildChart's x scale is an
// UNPADDED linear map of exactly this extent onto the plot width, a date
// inside [t0, t1] always lands inside the margins, and a date outside it
// never does — so this same extent decides annotation visibility without
// needing to duplicate LineChart's pixel/margin arithmetic.
// Returns null when there are no points to extend over. Only needs each
// point's `date`, so it accepts anything Pt-shaped (including ChartCard's
// looser local annotation-visibility helper type) rather than requiring the
// full Pt shape.
export function xExtentOf(lineGroups: { pts: { date: string }[] }[]): [number, number] | null {
  const times = lineGroups.flatMap(g => g.pts.map(p => T(p.date)))
  const [t0, t1] = extent(times)
  return t0 !== undefined && t1 !== undefined ? [t0, t1] : null
}

// Decides which of two label rows (0 or 1) each annotation's text should
// render in, given its pixel x position — or null when it should be skipped
// entirely (the solid marker line still always renders in 'full' mode; only
// the text is best-effort). Dense clusters (e.g. the 2022-23 cash-rate
// cycle) would otherwise pile every label onto one row at the same height.
// Only used by LineChart's annotationMode 'full' (the detail modal) — the
// card-level 'band'/'latest-label' modes render at most one label and don't
// need row placement.
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
