import { act, renderHook } from '@testing-library/react'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData } from './types'
import { headlinePool, useConveyor, MIN_ROTATE, ROTATE_MS } from './conveyor'

const site = assertSiteData(siteEdge)

describe('headlinePool', () => {
  test('hero_lead first, then hero tile order, deduped', () => {
    // Fixture: hero_lead=melb_rent; hero order cash_rate,
    // melb_dwelling_values, melb_rent, oo_lending, mortgage_new — all five
    // resolve to a chart with a finding.
    expect(headlinePool(site)).toEqual(
      ['melb_rent', 'cash_rate', 'melb_dwelling_values', 'oo_lending', 'mortgage_new'])
  })

  test('keys whose chart has no finding are dropped', () => {
    const s = { ...site, findings: { median_rent: site.findings.median_rent } }
    expect(headlinePool(s)).toEqual(['melb_rent'])
  })

  test('the "empty" hero_lead sentinel degrades to plain hero order', () => {
    const s = { ...site, hero_lead: 'empty' }
    expect(headlinePool(s)[0]).toBe('cash_rate')
  })

  test('a hero_lead that is not among the hero tiles is skipped (LeadCard guard preserved)', () => {
    const s = { ...site, hero_lead: 'vic_approvals' }
    expect(headlinePool(s)).not.toContain('vic_approvals')
  })

  test('MIN_ROTATE is 3 and ROTATE_MS is 5000 (spec §3)', () => {
    expect(MIN_ROTATE).toBe(3)
    expect(ROTATE_MS).toBe(5000)
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
