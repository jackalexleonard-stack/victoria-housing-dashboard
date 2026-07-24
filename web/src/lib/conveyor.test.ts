import { act, renderHook } from '@testing-library/react'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from './types'
import { TILE_CHART } from '../components/HeroTiles'
import { SCOPE_BADGE } from './geoBands'
import { headlinePool, latestForGeo, tileValueMatchesPrimary,
         prefersReducedMotion, useConveyor, MIN_ROTATE, ROTATE_MS } from './conveyor'

const site = assertSiteData(siteEdge)

// setup.ts stubs matchMedia globally with reduced-motion ON by default
// (deterministic DOM for every other test in the suite) — afterEach here
// restores exactly that default rather than leaving matchMedia unstubbed,
// so this describe doesn't leak a different matchMedia into later tests.
describe('prefersReducedMotion', () => {
  const restoreDefault = () => vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('prefers-reduced-motion'),
    media: q, addEventListener: () => {}, removeEventListener: () => {},
  }))
  afterEach(restoreDefault)

  test('true when the reduce query matches', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('prefers-reduced-motion'),
      media: q, addEventListener: () => {}, removeEventListener: () => {},
    }))
    expect(prefersReducedMotion()).toBe(true)
  })

  test('false when the reduce query does not match', () => {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: false,
      media: q, addEventListener: () => {}, removeEventListener: () => {},
    }))
    expect(prefersReducedMotion()).toBe(false)
  })
})

describe('headlinePool (band-aligned, spec §1 amendment 2026-07-24 — supersedes strict-geo)', () => {
  test('hero_lead first, then hero tile order, deduped; band entries badged at their own geo', () => {
    // Fixture: hero_lead=melb_rent; hero order cash_rate, melb_dwelling_values,
    // melb_rent, oo_lending, mortgage_new. cash_rate/mortgage_new are
    // national-scope charts whose one finding is keyed 'australia' (their own
    // fixed geo — pipeline/findings.py's build_findings never replicates a
    // finding across every UI geo): they don't qualify at geo='melbourne'
    // via rule 1, but DO qualify via rule 2 (broader scope + some finding),
    // entering badged at their own 'australia'. melb_rent/melb_dwelling_values/
    // oo_lending each carry a real 'melbourne' finding (verified:
    // findings.median_rent.melbourne, findings.hvi_melbourne.melbourne,
    // findings.lending.melbourne all exist) -> first-class, no badge.
    expect(headlinePool(site, 'melbourne')).toEqual([
      { key: 'melb_rent', geo: 'melbourne' },
      { key: 'cash_rate', geo: 'australia', badge: 'Australia' },
      { key: 'melb_dwelling_values', geo: 'melbourne' },
      { key: 'oo_lending', geo: 'melbourne' },
      { key: 'mortgage_new', geo: 'australia', badge: 'Australia' },
    ])
  })

  test('byte-identical to the pre-migration default-view pool once badges are stripped', () => {
    // The plan's Global Constraints: "The default (melbourne, 5y) view's
    // banner must be byte-identical to today." Band alignment restores
    // exactly that — this is the direct proof, independent of the full
    // PoolEntry shape asserted above.
    expect(headlinePool(site, 'melbourne').map(e => e.key)).toEqual(
      ['melb_rent', 'cash_rate', 'melb_dwelling_values', 'oo_lending', 'mortgage_new'])
  })

  test('keys whose chart has no finding at all (any geo) are dropped', () => {
    const s = { ...site, findings: { median_rent: site.findings.median_rent } }
    expect(headlinePool(s, 'melbourne')).toEqual([{ key: 'melb_rent', geo: 'melbourne' }])
  })

  test('the "empty" hero_lead sentinel degrades to plain hero order', () => {
    // cash_rate is first in hero order and now qualifies at geo='melbourne'
    // itself via the band rule (badged 'Australia'), so no need to pick a
    // different geo to see it lead.
    const s = { ...site, hero_lead: 'empty' }
    expect(headlinePool(s, 'melbourne')[0]).toEqual({ key: 'cash_rate', geo: 'australia', badge: 'Australia' })
  })

  test('a hero_lead that is not among the hero tiles is skipped (LeadCard guard preserved)', () => {
    const s = { ...site, hero_lead: 'vic_approvals' }
    expect(headlinePool(s, 'melbourne').map(e => e.key)).not.toContain('vic_approvals')
  })

  test('MIN_ROTATE is 3 and ROTATE_MS is 5000 (spec §3)', () => {
    expect(MIN_ROTATE).toBe(3)
    expect(ROTATE_MS).toBe(5000)
  })
})

describe('headlinePool: band-aligned per-geo behaviour (2026-07-24 banner batch)', () => {
  // site.edge.json carries no regional_vic finding anywhere (verified:
  // Object.entries(site.findings).filter(([,f]) => 'regional_vic' in f)
  // === [] — every finding in this fixture is keyed 'melbourne' or
  // 'australia' only). Per the brief's adapt-when-the-fixture-lacks-the-
  // shape rule, add ONE synthetic regional_vic finding for median_rent
  // (mirroring the melbourne sentence's style) so the regional-pool tests
  // below exercise real first-class-at-geo membership instead of passing
  // vacuously against an always-empty pool.
  const siteRegional: typeof site = { ...site, findings: { ...site.findings,
    median_rent: { ...site.findings.median_rent,
      regional_vic: 'The median rent held at $410/wk in Mar qtr 2026' } } }

  test('every entry is honest: first-class at the requested geo, or badged at the chart\'s own broader-scope geo', () => {
    const pool = headlinePool(siteRegional, 'regional_vic')
    expect(pool.length).toBeGreaterThan(0)   // a vacuous loop below would prove nothing
    for (const entry of pool) {
      const chartId = TILE_CHART[entry.key]
      const chart = siteRegional.charts.find(c => c.id === chartId)!
      if (entry.geo === 'regional_vic') {
        expect(siteRegional.findings[chartId]?.regional_vic,
               `${entry.key} claims regional_vic without a finding`).toBeTruthy()
        expect(entry.badge).toBeUndefined()
      } else {
        expect(['state', 'national', 'global']).toContain(chart.scope)
        expect(entry.badge).toBe(SCOPE_BADGE[chart.scope])
        expect(entry.geo).toBe(chart.geos[0])
      }
    }
  })

  test('a geo-scope chart lacking the selected geo is excluded, even when its own geo has a real finding', () => {
    // oo_lending's chart ('lending') is scope 'geo', geos: ['melbourne']
    // only — no regional_vic finding, and 'geo' scope doesn't qualify for
    // the band carve-out (rule 2 requires state/national/global), so it's
    // excluded at regional_vic. Real fixture, no synthetic data needed.
    expect(headlinePool(site, 'regional_vic').map(e => e.key)).not.toContain('oo_lending')
  })

  test('a national-scope chart is badged at its own geo under a non-default selected geo too', () => {
    const entry = headlinePool(site, 'regional_vic').find(e => e.key === 'cash_rate')
    expect(entry).toEqual({ key: 'cash_rate', geo: 'australia', badge: 'Australia' })
  })

  test('hero_lead leads first-class (no badge) when it has a real finding for the selected geo', () => {
    // Fixture hero_lead = melb_rent -> median_rent, which (via the inline
    // regional_vic finding above) HAS regional data:
    expect(headlinePool(siteRegional, 'regional_vic')[0]).toEqual({ key: 'melb_rent', geo: 'regional_vic' })
  })
})

describe('latestForGeo', () => {
  // vic_rents in the fixture carries only 'melbourne' median_rent points
  // (verified the same way as the regional finding above) — add two
  // synthetic regional_vic points inline, same cadence/shape as the real
  // melbourne pair (570 -> 580 across 2025-12-31 -> 2026-03-31), so 'latest
  // value + delta' and the cross-geo isolation are exercised for real.
  const siteRegional = { ...site, series: { ...site.series,
    vic_rents: { ...site.series.vic_rents, points: [...site.series.vic_rents.points,
      { date: '2025-12-31', region: 'regional_vic', metric: 'median_rent', value: 400 },
      { date: '2026-03-31', region: 'regional_vic', metric: 'median_rent', value: 410 },
    ] } } }

  test('returns the latest value and same-metric delta at the requested geo', () => {
    const r = latestForGeo(siteRegional, 'melb_rent', 'regional_vic')
    expect(r).not.toBeNull()
    expect(r!.value).toBe(410)
    expect(r!.delta).toBe(10)
  })

  test('never returns another geo\'s number', () => {
    const melb = latestForGeo(siteRegional, 'melb_rent', 'melbourne')!
    const reg = latestForGeo(siteRegional, 'melb_rent', 'regional_vic')!
    expect(reg.value).not.toBe(melb.value)
  })

  test('returns null when the series has no point for that geo', () => {
    expect(latestForGeo(site, 'cash_rate', 'regional_vic')).toBeNull()
  })

  test('returns delta null (not a wrong number) when only one point exists at the geo', () => {
    // greenfield_supply maps (TILE_CHART) to a 'land' chart id, but this
    // fixture's charts[] has no 'land' entry at all — primaryMetricOf
    // resolves null via the missing-chart branch, so latestForGeo would
    // just return null too, never exercising the single-point path. Build
    // a minimal chart+series inline instead, per the brief.
    const landSite = {
      ...site,
      charts: [...site.charts, {
        id: 'land', section: 'supply', title: 'Greenfield years of supply',
        series_id: 'vic_land', metrics: ['years_supply'], region_mode: 'geo',
        scope: 'geo', geos: ['regional_vic'], percent: false, markers: false, annotate: false,
      }],
      series: { ...site.series, vic_land: {
        status: 'ok' as const,
        meta: { source_name: null, source_url: null, frequency: null, last_fetched: null,
                 last_changed: null, last_data_date: null, error: null, cadence_days: 365 },
        units: { years_supply: 'years' },
        points: [{ date: '2026-01-01', region: 'regional_vic', metric: 'years_supply', value: 15 }],
      } },
    }
    const r = latestForGeo(landSite, 'greenfield_supply', 'regional_vic')
    expect(r).not.toBeNull()
    expect(r!.value).toBe(15)
    expect(r!.delta).toBeNull()
  })
})

describe('tileValueMatchesPrimary (the mis-format guard)', () => {
  test('true when the export tile value IS the primary-metric level (melb_rent)', () => {
    // hero tile melb_rent.value = 580; median_rent's latest melbourne point
    // is also 580 (2026-03-31) — same number, same metric.
    expect(tileValueMatchesPrimary(site, 'melb_rent')).toBe(true)
  })
  test('false for MoM-style tiles whose value is a different metric (melb_dwelling_values)', () => {
    // hero tile melb_dwelling_values.value = 0.3 (the MoM %); the chart's
    // primary metric is hvi_index, whose latest melbourne level is 178.7 —
    // a different metric entirely, so this must be false, not a near-miss.
    expect(tileValueMatchesPrimary(site, 'melb_dwelling_values')).toBe(false)
  })
})

describe('useConveyor', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  test('advances one step per interval and wraps', () => {
    const { result } = renderHook(() => useConveyor(3, true))
    expect(result.current.offset).toBe(0)
    act(() => vi.advanceTimersByTime(ROTATE_MS))
    expect(result.current.offset).toBe(1)
    act(() => vi.advanceTimersByTime(2 * ROTATE_MS))
    expect(result.current.offset).toBe(0)
  })

  test('does not advance while not running', () => {
    const { result } = renderHook(() => useConveyor(3, false))
    act(() => vi.advanceTimersByTime(10 * ROTATE_MS))
    expect(result.current.offset).toBe(0)
  })

  test('does not rotate below MIN_ROTATE findings even when running', () => {
    // 11 (odd) ticks, not 10: with size=2 an even tick count parity-cycles
    // back to offset 0 even if the gate were dropped entirely, which would
    // let this test pass vacuously. An odd count means a dropped gate
    // lands on offset 1, so the assertion actually discriminates.
    const { result } = renderHook(() => useConveyor(2, true))
    act(() => vi.advanceTimersByTime(11 * ROTATE_MS))
    expect(result.current.offset).toBe(0)
  })

  test('pausing stops the clock; resuming restarts a full fresh interval', () => {
    const { result, rerender } = renderHook(
      ({ run }: { run: boolean }) => useConveyor(3, run), { initialProps: { run: true } })
    act(() => vi.advanceTimersByTime(ROTATE_MS))
    expect(result.current.offset).toBe(1)
    rerender({ run: false })
    act(() => vi.advanceTimersByTime(10 * ROTATE_MS))
    expect(result.current.offset).toBe(1)
    rerender({ run: true })
    act(() => vi.advanceTimersByTime(ROTATE_MS))
    expect(result.current.offset).toBe(2)
  })

  test('jump normalises any index into range', () => {
    const { result } = renderHook(() => useConveyor(5, false))
    act(() => result.current.jump(7))
    expect(result.current.offset).toBe(2)
    act(() => result.current.jump(-1))
    expect(result.current.offset).toBe(4)
  })

  test('jump resets the interval phase — a full 5 s runs before the next auto-advance (spec §3)', () => {
    const { result } = renderHook(() => useConveyor(5, true))
    act(() => vi.advanceTimersByTime(ROTATE_MS - 1000))   // 4 s into the tick
    act(() => result.current.jump(3))
    act(() => vi.advanceTimersByTime(1000))               // old tick would fire here
    expect(result.current.offset).toBe(3)                 // it must not have
    act(() => vi.advanceTimersByTime(ROTATE_MS - 1000))   // full fresh interval elapses
    expect(result.current.offset).toBe(4)
  })
})
