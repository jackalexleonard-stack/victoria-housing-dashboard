import { act, renderHook } from '@testing-library/react'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from './types'
import { TILE_CHART } from '../components/HeroTiles'
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

describe('headlinePool', () => {
  test('hero_lead first, then hero tile order, deduped, geo-filtered', () => {
    // Fixture: hero_lead=melb_rent; hero order cash_rate,
    // melb_dwelling_values, melb_rent, oo_lending, mortgage_new. Since the
    // 2026-07-24 banner batch, membership requires a finding keyed EXACTLY
    // to the passed geo (site.findings[chartId]?.[geo]) — cash_rate and
    // mortgage_new are national-scope charts whose one finding is keyed
    // 'australia' (their own fixed geo; pipeline/findings.py's
    // build_findings never replicates a finding across every UI geo), so
    // they no longer qualify for the melbourne pool either. Only
    // melb_rent (median_rent.melbourne), melb_dwelling_values
    // (hvi_melbourne.melbourne) and oo_lending (lending.melbourne) do.
    expect(headlinePool(site, 'melbourne')).toEqual(
      ['melb_rent', 'melb_dwelling_values', 'oo_lending'])
  })

  test('keys whose chart has no finding are dropped', () => {
    const s = { ...site, findings: { median_rent: site.findings.median_rent } }
    expect(headlinePool(s, 'melbourne')).toEqual(['melb_rent'])
  })

  test('the "empty" hero_lead sentinel degrades to plain hero order', () => {
    // geo='australia' here (not 'melbourne'): cash_rate's finding is keyed
    // 'australia' (see the test above), so this is the geo where it's
    // actually first in hero order.
    const s = { ...site, hero_lead: 'empty' }
    expect(headlinePool(s, 'australia')[0]).toBe('cash_rate')
  })

  test('a hero_lead that is not among the hero tiles is skipped (LeadCard guard preserved)', () => {
    const s = { ...site, hero_lead: 'vic_approvals' }
    expect(headlinePool(s, 'melbourne')).not.toContain('vic_approvals')
  })

  test('MIN_ROTATE is 3 and ROTATE_MS is 5000 (spec §3)', () => {
    expect(MIN_ROTATE).toBe(3)
    expect(ROTATE_MS).toBe(5000)
  })
})

describe('headlinePool per geo (2026-07-24 banner batch)', () => {
  // site.edge.json carries no regional_vic finding anywhere (verified:
  // Object.entries(site.findings).filter(([,f]) => 'regional_vic' in f)
  // === [] — every finding in this fixture is keyed 'melbourne' or
  // 'australia' only). Per the brief's adapt-when-the-fixture-lacks-the-
  // shape rule, add ONE synthetic regional_vic finding for median_rent
  // (mirroring the melbourne sentence's style) so the regional-pool tests
  // below exercise real per-geo membership instead of passing vacuously
  // against an always-empty pool.
  const siteRegional: typeof site = { ...site, findings: { ...site.findings,
    median_rent: { ...site.findings.median_rent,
      regional_vic: 'The median rent held at $410/wk in Mar qtr 2026' } } }

  test('melbourne pool is exactly the charts whose finding is keyed "melbourne"', () => {
    // Regression check (adapted to the real fixture — see the plain
    // 'headlinePool' describe block above for why cash_rate/mortgage_new
    // are absent): the default view's pool under the new two-arg API.
    expect(headlinePool(site, 'melbourne')).toEqual(
      ['melb_rent', 'melb_dwelling_values', 'oo_lending'])
  })

  test('a geo pool contains only charts with a finding for THAT geo', () => {
    for (const key of headlinePool(siteRegional, 'regional_vic')) {
      const chartId = TILE_CHART[key]
      expect(siteRegional.findings[chartId]?.regional_vic, `${key} lacks a regional finding`).toBeTruthy()
    }
  })

  test('a chart without a finding for the geo is excluded', () => {
    // cash_rate's chart has no regional_vic finding in the fixture.
    expect(headlinePool(siteRegional, 'regional_vic')).not.toContain('cash_rate')
  })

  test('hero_lead leads only when it qualifies for the geo', () => {
    // Fixture hero_lead = melb_rent -> median_rent, which (via the inline
    // regional_vic finding above) HAS regional data:
    expect(headlinePool(siteRegional, 'regional_vic')[0]).toBe('melb_rent')
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
