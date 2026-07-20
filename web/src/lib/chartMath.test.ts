import { buildChart, nearest, atTime } from './chartMath'

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

test('atTime snaps to the nearest date before grouping', () => {
  const b = buildChart(lines, 400, 200, { colorway: ['#205EA6'], percent: false })
  const near = Date.parse('2026-02-20T00:00:00Z')
  const r = atTime(b.flat, near)
  expect(r.points).toHaveLength(1)
  expect(r.points[0].value).toBe(20)
})
