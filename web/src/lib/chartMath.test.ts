import { buildChart, nearest } from './chartMath'

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
