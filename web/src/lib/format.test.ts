import { TILE_FMT, fmtUnit, fmtPeriod, fmtDate, fmtDayMonth, ago, shortSource } from './format'

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

test('fmtUnit covers the full real unit vocabulary', () => {
  // Regressions observed live on real data.
  expect(fmtUnit(3.52655, 'percent')).toBe('3.53%')
  expect(fmtUnit(580, 'AUD/week')).toBe('$580/wk')
  expect(fmtUnit(16808.9, 'aud_million')).toBe('$16,809m')
  // percent: round to 2dp, strip trailing zeros.
  expect(fmtUnit(4.35, 'percent')).toBe('4.35%')
  expect(fmtUnit(9.70, 'percent')).toBe('9.7%')
  expect(fmtUnit(3.0, 'percent')).toBe('3%')
  // dwellings / applications / persons / lots / number: thousands, 0dp.
  expect(fmtUnit(4400, 'applications')).toBe('4,400')
  expect(fmtUnit(4400, 'persons')).toBe('4,400')
  expect(fmtUnit(4400, 'lots')).toBe('4,400')
  expect(fmtUnit(4400, 'number')).toBe('4,400')
  // index: 1dp, unchanged.
  expect(fmtUnit(183.4, 'index')).toBe('183.4')
  // aud: unchanged.
  expect(fmtUnit(820000, 'aud')).toBe('$820,000')
  // years: 1dp with unit suffix.
  expect(fmtUnit(6.2, 'years')).toBe('6.2 yrs')
  // USD-money commodity units: 0dp normally, 2dp under 10.
  expect(fmtUnit(82, 'usd_per_barrel')).toBe('US$82')
  expect(fmtUnit(82, 'USD/dmtu')).toBe('US$82')
  expect(fmtUnit(82, 'USD/m3')).toBe('US$82')
  expect(fmtUnit(82, 'USD/tonne')).toBe('US$82')
  expect(fmtUnit(3.2, 'usd_per_barrel')).toBe('US$3.20')
  // usd_per_aud: exchange rate, no $ prefix, 2dp.
  expect(fmtUnit(0.7, 'usd_per_aud')).toBe('0.70')
  // unrecognised: sensible 2dp fallback.
  expect(fmtUnit(1.23456, 'mystery_unit')).toBe('1.23')
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

test('fmtDayMonth: compact day+month, no year, zero-padded day', () => {
  expect(fmtDayMonth('2026-06-30')).toBe('30 Jun')
  expect(fmtDayMonth('2026-06-05')).toBe('05 Jun')
})

test('shortSource maps real source_name strings to compact provenance tokens', () => {
  expect(shortSource('RBA Cash Rate Target (F1.1)')).toBe('RBA')
  expect(shortSource('RBA Growth in Financial Aggregates — Housing credit (D1)')).toBe('RBA')
  expect(shortSource('ABS Total Value of Dwellings (RES_DWELL_ST)')).toBe('ABS')
  expect(shortSource('Cotality Home Value Index — Melbourne')).toBe('Cotality')
  expect(shortSource('Melbourne auction clearance rate (Cotality/Domain)')).toBe('Cotality')
  expect(shortSource('World Bank Commodity Price Data (The Pink Sheet)')).toBe('World Bank')
  expect(shortSource('FRED — Brent crude, US 10yr Treasury, AUD/USD')).toBe('FRED')
  expect(shortSource('DFFH / Homes Victoria Rental Report')).toBe('DFFH')
  expect(shortSource('Rental vacancy rate — SQM Research (via DFFH Rental Report)')).toBe('SQM')
  expect(shortSource('Homes Victoria — Applications on the Victorian Housing Register'))
    .toBe('Homes Victoria')
  expect(shortSource('Urban Development Program — Greenfield Residential Land (DTP)')).toBe('DTP')
  // Fallback = first word, for anything not in the small map.
  expect(shortSource('REIV median house & unit prices')).toBe('REIV')
  expect(shortSource(null)).toBe('')
  expect(shortSource(undefined)).toBe('')
})
