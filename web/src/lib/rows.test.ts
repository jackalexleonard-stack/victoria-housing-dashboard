import { buildRows, heightClassFor, type HeightClass } from './rows'
import type { ChartSpec } from './types'
import site from '../test/fixtures/site.real.json'
import { assertSiteData } from './types'

const c = (id: string): ChartSpec => ({ id, section: 's', title: id, series_id: id,
  metrics: null, region_mode: 'geo', scope: 'geo', geos: ['melbourne'],
  percent: false, markers: false, annotate: false })
const classes: Record<string, HeightClass> = {}
const fn = (x: ChartSpec) => classes[x.id] ?? 'standard'
const ids = (rows: ReturnType<typeof buildRows>) =>
  rows.map(r => ({ ids: r.cards.map(x => x.id), span: r.span }))

describe('buildRows', () => {
  test('lead spans, then same-class neighbours pair, trailing odd card spans', () => {
    const rows = buildRows([c('a'), c('b'), c('d'), c('e')], fn, { leadSpans: true })
    expect(ids(rows)).toEqual([
      { ids: ['a'], span: true }, { ids: ['b', 'd'], span: false },
      { ids: ['e'], span: true }])
  })

  test('context band (no lead): pairs then spans the orphan — the wider-context fix', () => {
    const rows = buildRows([c('a'), c('b'), c('d')], fn, { leadSpans: false })
    expect(ids(rows)).toEqual([{ ids: ['a', 'b'], span: false }, { ids: ['d'], span: true }])
  })

  test('class mismatch spans the current card instead of leaving a void', () => {
    classes.tile1 = 'tile'
    const rows = buildRows([c('tile1'), c('a'), c('b')], fn, { leadSpans: false })
    expect(ids(rows)).toEqual([
      { ids: ['tile1'], span: true }, { ids: ['a', 'b'], span: false }])
  })

  test('two adjacent tiles pair; tall always gets its own row, even next to a twin', () => {
    classes.t1 = 'tile'; classes.t2 = 'tile'; classes.m1 = 'tall'; classes.m2 = 'tall'
    expect(ids(buildRows([c('t1'), c('t2')], fn, { leadSpans: false })))
      .toEqual([{ ids: ['t1', 't2'], span: false }])
    expect(ids(buildRows([c('m1'), c('m2')], fn, { leadSpans: false })))
      .toEqual([{ ids: ['m1'], span: true }, { ids: ['m2'], span: true }])
  })

  test('the money band shape: standard + tall + standard → three spanning rows', () => {
    classes.mortgage_rates = 'tall'
    const rows = buildRows([c('cash'), c('mortgage_rates'), c('credit')], fn,
                           { leadSpans: false })
    expect(rows.every(r => r.span)).toBe(true)
    expect(rows).toHaveLength(3)
  })

  test('registry order is never reshuffled', () => {
    classes.x = 'tile'
    const rows = buildRows([c('a'), c('x'), c('b')], fn, { leadSpans: true })
    expect(rows.flatMap(r => r.cards.map(k => k.id))).toEqual(['a', 'x', 'b'])
  })
})

describe('heightClassFor', () => {
  test('heightClassFor: mortgage is tall; single-point land is a tile; lending is standard', () => {
    const s = assertSiteData(site)
    const NOW = new Date('2026-07-18T00:00:00Z')
    const chart = (id: string) => s.charts.find(x => x.id === id)!
    expect(heightClassFor(s, chart('mortgage_rates'), 'all', 'australia', NOW)).toBe('tall')
    expect(heightClassFor(s, chart('land'), 'all', 'melbourne', NOW)).toBe('tile')
    expect(heightClassFor(s, chart('lending'), 'all', 'australia', NOW)).toBe('standard')
  })
})
