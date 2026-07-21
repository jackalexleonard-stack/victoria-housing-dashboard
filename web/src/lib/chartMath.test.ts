import { buildChart, nearest, atTime, fmtTickLabel, placeAnnotationLabels } from './chartMath'

const lines = [{ name: 'a', pts: [
  { date: '2026-01-31', region: 'vic', metric: 'm', value: 10 },
  { date: '2026-02-28', region: 'vic', metric: 'm', value: 20 },
  { date: '2026-03-31', region: 'vic', metric: 'm', value: 15 },
] }]

test('builds scales, one path per line, sensible ticks', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: false })
  expect(b.paths).toHaveLength(1)
  expect(b.paths[0].color).toBe('#205EA6')
  expect(b.paths[0].d.startsWith('M')).toBe(true)
  expect(b.yTicks.length).toBeGreaterThanOrEqual(3)
  expect(b.flat).toHaveLength(3)
})

test('percent charts suffix tick labels', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: true })
  expect(b.yTicks[0].label.endsWith('%')).toBe(true)
})

test('nearest snaps to the closest observation', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: false })
  const feb = Date.parse('2026-02-20T00:00:00Z')
  expect(nearest(b.flat, feb)!.value).toBe(20)
})

test('without y2Lines, y2 stays null and y2Ticks stays empty (back-compat)', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: false })
  expect(b.y2).toBeNull()
  expect(b.y2Ticks).toEqual([])
  expect(b.paths[0].axis).toBe('y')
})

test('y2Lines get their own right-axis scale, sized to their own extent', () => {
  const twoLines = [
    { name: 'a', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'm', value: 10 },
      { date: '2026-02-28', region: 'vic', metric: 'm', value: 20 },
    ] },
    { name: 'b', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'm', value: 1000 },
      { date: '2026-02-28', region: 'vic', metric: 'm', value: 2000 },
    ] },
  ]
  const b = buildChart(twoLines, 400, 200,
    { colorway: ['#205EA6', '#BC5215'], percent: false, y2Lines: ['b'] })
  expect(b.y2).not.toBeNull()
  expect(b.y2Ticks.length).toBeGreaterThan(0)
  expect(b.paths.find(p => p.name === 'a')!.axis).toBe('y')
  expect(b.paths.find(p => p.name === 'b')!.axis).toBe('y2')
  // line 'a' (10-20) must not be squashed by line 'b's much larger domain (1000-2000)
  expect(b.y.domain()[1]).toBeLessThan(100)
  expect(b.y2!.domain()[1]).toBeGreaterThan(500)
})

test('atTime returns one point per line at the hovered date, in line order', () => {
  const threeLines = [
    { name: 'a', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'a', value: 1 },
      { date: '2026-02-28', region: 'vic', metric: 'a', value: 2 },
    ] },
    { name: 'b', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'b', value: 10 },
      { date: '2026-02-28', region: 'vic', metric: 'b', value: 20 },
    ] },
    { name: 'c', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'c', value: 100 },
      { date: '2026-02-28', region: 'vic', metric: 'c', value: 200 },
    ] },
  ]
  const b = buildChart(threeLines, 400, 200,
    { colorway: ['#205EA6', '#BC5215', '#24837B'], percent: false })
  const jan = Date.parse('2026-01-31T00:00:00Z')
  const r = atTime(b.flat, jan)
  expect(r.points.map(p => p.name)).toEqual(['a', 'b', 'c'])
  expect(r.points.map(p => p.value)).toEqual([1, 10, 100])
})

test('atTime omits a line with no point at the hovered date', () => {
  const twoLines = [
    { name: 'a', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'a', value: 1 },
      { date: '2026-02-28', region: 'vic', metric: 'a', value: 2 },
    ] },
    { name: 'b', pts: [
      { date: '2026-01-31', region: 'vic', metric: 'b', value: 10 },
    ] },
  ]
  const b = buildChart(twoLines, 400, 200,
    { colorway: ['#205EA6', '#BC5215'], percent: false })
  const feb = Date.parse('2026-02-28T00:00:00Z')
  const r = atTime(b.flat, feb)
  expect(r.points.map(p => p.name)).toEqual(['a'])
  expect(r.points[0].value).toBe(2)
})

test('fmtTickLabel: compact notation for large non-percent values', () => {
  expect(fmtTickLabel(1_000_000, false)).toBe('1M')
  expect(fmtTickLabel(950_000, false)).toBe('950k')
  expect(fmtTickLabel(8_000, false)).toBe('8,000')
  expect(fmtTickLabel(4.35, true)).toBe('4.35%')
})

test('fmtTickLabel: keeps one decimal only when needed, and handles negatives', () => {
  expect(fmtTickLabel(1_500_000, false)).toBe('1.5M')
  expect(fmtTickLabel(-1_000_000, false)).toBe('-1M')
  expect(fmtTickLabel(10_000, false)).toBe('10k')
})

test('placeAnnotationLabels: spread-out annotations alternate rows 0/1', () => {
  const xs = [0, 100, 200, 300]
  expect(placeAnnotationLabels(xs, 36)).toEqual([0, 1, 0, 1])
})

test('placeAnnotationLabels: a dense cluster drops some labels to null', () => {
  const xs = [0, 10, 20, 30, 40, 50]
  const rows = placeAnnotationLabels(xs, 36)
  expect(rows).toHaveLength(6)
  expect(rows.some(r => r === null)).toBe(true)
  // every non-null placement must respect the min gap within its own row
  const byRow: Record<'0' | '1', number[]> = { '0': [], '1': [] }
  rows.forEach((r, i) => { if (r !== null) byRow[String(r) as '0' | '1'].push(xs[i]) })
  for (const arr of Object.values(byRow)) {
    for (let i = 1; i < arr.length; i++) expect(arr[i] - arr[i - 1]).toBeGreaterThanOrEqual(36)
  }
})

test('placeAnnotationLabels: exact-gap boundary (== minGap) still places; just-under fails over to null', () => {
  // pos0 x=0 -> row0 (primary). pos1 x=20 -> row1 (primary, first in that row).
  // pos2 x=36 -> primary row0, gap to lastX0(0) is exactly 36 -> fits.
  expect(placeAnnotationLabels([0, 20, 36], 36)).toEqual([0, 1, 0])
  // Same shape but x=35 for the third point: primary row0 gap=35 (<36) fails,
  // secondary row1 gap to lastX1(20)=15 (<36) also fails -> null.
  expect(placeAnnotationLabels([0, 20, 35], 36)).toEqual([0, 1, null])
})

test('atTime snaps to the nearest date before grouping', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: false })
  const near = Date.parse('2026-02-20T00:00:00Z')
  const r = atTime(b.flat, near)
  expect(r.points).toHaveLength(1)
  expect(r.points[0].value).toBe(20)
})

// --- P1-axes: data-extent + padding, min-span guard, spans-zero (deliberate
// behaviour change — the axis no longer always anchors non-negative domains
// at 0; see chartMath.ts's fitY/minSpanFloor/spansZero for the rationale). ---

test('fitY: level series (all positive, far from zero) gets extent + padding, NOT a zero-anchored domain', () => {
  // Stand-in for the "mean dwelling price" bug: ~900k-1M data on the old
  // always-include-0 axis rendered as a flat line over ~90% dead
  // whitespace. The new domain must hug the data instead.
  const highLevel = [{ name: 'a', pts: [
    { date: '2026-01-31', region: 'vic', metric: 'm', value: 900_000 },
    { date: '2026-02-28', region: 'vic', metric: 'm', value: 950_000 },
  ] }]
  const b = buildChart(highLevel, 400, 200, { colorway: ['#205EA6'], percent: false })
  const [lo, hi] = b.y.domain()
  expect(lo).toBeGreaterThan(700_000)   // nowhere near the old 0 floor
  expect(lo).toBeLessThan(900_000)      // some headroom BELOW the data min
  expect(hi).toBeGreaterThan(950_000)   // and headroom above the data max
  expect(b.yZero).toBe(false)           // data never goes anywhere near 0
})

test('fitY: HVI-style near-top-of-range data gets real headroom above its max (no top-edge clipping)', () => {
  // Reproduces the reported clip: a cluster of points sitting close to a
  // round number used to render flush against the plot's top edge because
  // the old domain's max WAS the data's own max, un-padded.
  const nearTop = [{ name: 'hvi', pts: [
    { date: '2026-01-31', region: 'melbourne', metric: 'hvi_index', value: 180.1 },
    { date: '2026-02-28', region: 'melbourne', metric: 'hvi_index', value: 180.4 },
    { date: '2026-03-31', region: 'melbourne', metric: 'hvi_index', value: 180.62 },
  ] }]
  const b = buildChart(nearTop, 400, 200, { colorway: ['#205EA6'], percent: false })
  expect(b.y.domain()[1]).toBeGreaterThan(181.5)   // genuine headroom above 180.62
})

test('fitY: MIN-SPAN guard widens a near-flat percent series instead of auto-zooming on noise', () => {
  // A held-flat cash rate: dataSpan is 0, so without the guard the domain
  // would collapse to essentially nothing around 3.85.
  const flatCashRate = [{ name: 'cash rate', pts: [
    { date: '2026-01-31', region: 'australia', metric: 'cash_rate', value: 3.85 },
    { date: '2026-02-28', region: 'australia', metric: 'cash_rate', value: 3.85 },
    { date: '2026-03-31', region: 'australia', metric: 'cash_rate', value: 3.85 },
  ] }]
  const b = buildChart(flatCashRate, 400, 200, { colorway: ['#205EA6'], percent: true })
  const [lo, hi] = b.y.domain()
  expect(hi - lo).toBeGreaterThan(0.8)     // the 1pp floor engaged, not a ~0 span
  expect(lo).toBeLessThan(3.85)
  expect(hi).toBeGreaterThan(3.85)
})

test('fitY: MIN-SPAN guard scales with magnitude for non-percent near-flat series (no fixed absolute floor)', () => {
  // AUD/USD-style small-magnitude series: a fixed absolute floor (e.g. "1")
  // would swallow its entire real ~0.1 variation. The floor must instead be
  // relative to the series' own scale.
  const audUsd = [{ name: 'aud_usd', pts: [
    { date: '2026-01-31', region: 'global', metric: 'aud_usd', value: 0.655 },
    { date: '2026-02-28', region: 'global', metric: 'aud_usd', value: 0.658 },
  ] }]
  const b = buildChart(audUsd, 400, 200, { colorway: ['#205EA6'], percent: false })
  const [lo, hi] = b.y.domain()
  expect(hi - lo).toBeLessThan(0.1)   // stayed tight to the real (tiny) scale
})

test('fitY/spansZero: a series that genuinely straddles zero keeps zero inside its domain and flags yZero', () => {
  const deltas = [{ name: 'delta', pts: [
    { date: '2026-01-31', region: 'vic', metric: 'd', value: -5 },
    { date: '2026-02-28', region: 'vic', metric: 'd', value: 10 },
  ] }]
  const b = buildChart(deltas, 400, 200, { colorway: ['#205EA6'], percent: false })
  expect(b.yZero).toBe(true)
  expect(b.y.domain()[0]).toBeLessThan(0)
  expect(b.y.domain()[1]).toBeGreaterThan(0)
})

test('atTime: when all lines share exact dates, every returned point matches the header date (no offset, no suffix needed)', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: false })
  const jan = Date.parse('2026-01-31T00:00:00Z')
  const r = atTime(b.flat, jan)
  const headerDate = new Date(r.t).toISOString().slice(0, 10)
  expect(r.points.every(p => p.date === headerDate)).toBe(true)
})

// X5 (mixed-cadence tolerance): a "primary" line snaps the header time
// exactly; a moderately-sparse "monthly" line has no point at that exact
// date but has one close enough (within tolerance) — it's included, keeping
// its OWN (different) date; a much sparser "quarterly" line's nearest point
// is hundreds of days away — well outside tolerance — so it stays absent,
// same as the old exact-only behaviour would (silently) have produced.
const mixedCadenceLines = [
  { name: 'primary', pts: [
    { date: '2026-01-01', region: 'vic', metric: 'primary', value: 1 },
    { date: '2026-01-15', region: 'vic', metric: 'primary', value: 2 },
    { date: '2026-01-30', region: 'vic', metric: 'primary', value: 3 },
  ] },
  { name: 'monthly', pts: [
    { date: '2026-01-01', region: 'vic', metric: 'monthly', value: 10 },
    { date: '2026-01-20', region: 'vic', metric: 'monthly', value: 11 },
  ] },
  { name: 'quarterly', pts: [
    { date: '2025-01-01', region: 'vic', metric: 'quarterly', value: 100 },
    { date: '2025-04-01', region: 'vic', metric: 'quarterly', value: 101 },
  ] },
]

test('atTime tolerance: a mixed-cadence pair includes the nearby line with its own date; a far line stays absent', () => {
  const b = buildChart(mixedCadenceLines, 400, 200,
    { colorway: ['#205EA6', '#BC5215', '#24837B'], percent: false })
  const hoverT = Date.parse('2026-01-15T00:00:00Z')
  const r = atTime(b.flat, hoverT)
  const byName = Object.fromEntries(r.points.map(p => [p.name, p]))
  expect(byName.primary.date).toBe('2026-01-15')
  expect(byName.monthly).toBeDefined()
  expect(byName.monthly.date).toBe('2026-01-20')   // its OWN date, not the header's
  expect(byName.quarterly).toBeUndefined()          // hundreds of days away — stays absent
})
