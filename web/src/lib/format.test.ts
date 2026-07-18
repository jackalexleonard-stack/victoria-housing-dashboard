import { TILE_FMT, fmtUnit, fmtPeriod, fmtDate, ago } from './format'

test('tile formatters port the python lambdas exactly', () => {
  expect(TILE_FMT.cash_rate.value(3.85)).toBe('3.85%')
  expect(TILE_FMT.cash_rate.delta(-0.25)).toBe('-0.25 pp')
  expect(TILE_FMT.melb_dwelling_values.value(-1.0)).toBe('-1.0%')
  expect(TILE_FMT.melb_dwelling_values.delta(-0.9)).toBe('-0.9% yr')
  expect(TILE_FMT.vic_mean_price.value(820000)).toBe('$820k')
  expect(TILE_FMT.vic_mean_price.delta(1.2)).toBe('+1.2% qtr')
  expect(TILE_FMT.vic_approvals.value(4400)).toBe('4,400')
  expect(TILE_FMT.vic_approvals.delta(400)).toBe('+400')
  expect(TILE_FMT.accord_runrate.delta(-14000)).toBe('-14,000 vs 60k target')
  expect(TILE_FMT.melb_vacancy.value(1.2)).toBe('1.2%')
  expect(TILE_FMT.melb_rent.value(580)).toBe('$580/wk')
  expect(TILE_FMT.greenfield_supply.value(6.2)).toBe('6.2 yrs')
  expect(TILE_FMT.iron_ore.value(102)).toBe('US$102')
  expect(TILE_FMT.oo_lending.value(18000)).toBe('$18,000m')
  expect(TILE_FMT.melb_clearance.value(64.2)).toBe('64%')
})

test('every registry key referenced by fixtures has a formatter', () => {
  const keys = ['cash_rate', 'melb_dwelling_values', 'au_dwelling_values',
    'vic_mean_price', 'vic_approvals', 'accord_runrate', 'melb_vacancy',
    'melb_rent_growth', 'credit_growth', 'mortgage_new', 'vic_commencements',
    'vhr_waitlist', 'nom', 'input_costs', 'iron_ore', 'melb_rent',
    'greenfield_supply', 'melb_median_house', 'melb_clearance', 'oo_lending']
  for (const k of keys) expect(TILE_FMT[k], k).toBeDefined()
})

test('unit and period formatting', () => {
  expect(fmtUnit(3.85, 'percent')).toBe('3.85%')
  expect(fmtUnit(4400, 'dwellings')).toBe('4,400')
  expect(fmtPeriod('2026-03-31', 'quarterly')).toBe('Mar qtr 2026')
  expect(fmtPeriod('2026-06-30', 'monthly')).toBe('Jun 2026')
  expect(fmtPeriod('2026-06-30', 'daily')).toBe('30 Jun 2026')
  expect(ago('2026-07-17T06:00:00Z', new Date('2026-07-18T06:00:00Z'))).toBe('yesterday')
  expect(ago(null, new Date())).toBe('unknown')
})

test('zero deltas keep the + sign (python :+ parity)', () => {
  expect(TILE_FMT.cash_rate.delta(0)).toBe('+0.00 pp')
  expect(TILE_FMT.vic_approvals.delta(0)).toBe('+0')
  expect(TILE_FMT.melb_dwelling_values.value(0)).toBe('+0.0%')
  expect(TILE_FMT.melb_rent_growth.delta(0)).toBe('+0.0 pp')
})

test('clearance uses banker’s rounding like python %.0f', () => {
  expect(TILE_FMT.melb_clearance.value(64.5)).toBe('64%')  // half-to-even
  expect(TILE_FMT.melb_clearance.value(65.5)).toBe('66%')
  expect(TILE_FMT.melb_clearance.value(64.2)).toBe('64%')
  expect(TILE_FMT.melb_clearance.value(64.8)).toBe('65%')
})

test('fmtDate zero-pads single-digit days', () => {
  expect(fmtDate('2026-06-05')).toBe('05 Jun 2026')
})
