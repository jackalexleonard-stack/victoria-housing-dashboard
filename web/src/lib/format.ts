const n0 = (v: number) => v.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const sign = (d: number, s: string) => (d >= 0 ? '+' : '-') + s

// Round half to even, matching Python's "%.0f" (banker's rounding).
function roundHalfEven(v: number): number {
  const floor = Math.floor(v)
  const diff = v - floor
  if (diff < 0.5) return floor
  if (diff > 0.5) return floor + 1
  return floor % 2 === 0 ? floor : floor + 1  // exactly .5 → nearest even
}

type Fmt = { value: (v: number) => string; delta: (d: number) => string }
const f = (value: Fmt['value'], delta: Fmt['delta']): Fmt => ({ value, delta })

export const TILE_FMT: Record<string, Fmt> = {
  cash_rate: f(v => `${v.toFixed(2)}%`, d => sign(d, `${Math.abs(d).toFixed(2)} pp`)),
  melb_dwelling_values: f(v => sign(v, `${Math.abs(v).toFixed(1)}%`),
                          d => sign(d, `${Math.abs(d).toFixed(1)}% yr`)),
  au_dwelling_values: f(v => sign(v, `${Math.abs(v).toFixed(1)}%`),
                        d => sign(d, `${Math.abs(d).toFixed(1)}% yr`)),
  vic_mean_price: f(v => `$${n0(v / 1000)}k`, d => sign(d, `${Math.abs(d).toFixed(1)}% qtr`)),
  vic_approvals: f(v => n0(v), d => sign(d, n0(Math.abs(d)))),
  accord_runrate: f(v => n0(v), d => sign(d, `${n0(Math.abs(d))} vs 60k target`)),
  melb_vacancy: f(v => `${v.toFixed(1)}%`, d => sign(d, `${Math.abs(d).toFixed(1)} pp`)),
  melb_rent_growth: f(v => sign(v, `${Math.abs(v).toFixed(1)}%`),
                      d => sign(d, `${Math.abs(d).toFixed(1)} pp`)),
  credit_growth: f(v => `${v.toFixed(1)}%`, d => sign(d, `${Math.abs(d).toFixed(1)} pp`)),
  mortgage_new: f(v => `${v.toFixed(2)}%`, d => sign(d, `${Math.abs(d).toFixed(2)} pp`)),
  vic_commencements: f(v => n0(v), d => sign(d, n0(Math.abs(d)))),
  vhr_waitlist: f(v => n0(v), d => sign(d, n0(Math.abs(d)))),
  nom: f(v => n0(v), d => sign(d, n0(Math.abs(d)))),
  input_costs: f(v => v.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
                 d => sign(d, `${Math.abs(d).toFixed(1)}% qtr`)),
  iron_ore: f(v => `US$${n0(v)}`, d => sign(d, `${Math.abs(d).toFixed(1)}% mth`)),
  melb_rent: f(v => `$${n0(v)}/wk`, d => sign(d, `${n0(Math.abs(d))}/wk`)),
  greenfield_supply: f(v => `${v.toFixed(1)} yrs`, d => sign(d, Math.abs(d).toFixed(1))),
  melb_median_house: f(v => `$${n0(v / 1000)}k`, d => sign(d, `${Math.abs(d).toFixed(1)}% qtr`)),
  melb_clearance: f(v => `${roundHalfEven(v)}%`, d => sign(d, `${roundHalfEven(Math.abs(d))} pp`)),
  oo_lending: f(v => `$${n0(v)}m`, d => sign(d, `${Math.abs(d).toFixed(1)}% qtr`)),
  // extra_tiles' ERP population stat (design review P0-5) — a raw persons
  // count/delta, same "count" shape as nom's format (no millions abbreviation,
  // matches fmtUnit's 'persons' handling below).
  erp: f(v => n0(v), d => sign(d, n0(Math.abs(d)))),
}

// Normalise a unit string for matching, e.g. 'AUD/week' -> 'aud_per_week'.
function normUnit(unit: string): string {
  return unit.trim().toLowerCase().replace(/\//g, '_per_').replace(/\s+/g, '_')
}

export function fmtUnit(v: number, unit: string): string {
  const u = normUnit(unit)
  // toLocaleString with only maximumFractionDigits (no minimum) rounds to 2dp
  // and drops unnecessary trailing zeros, matching Python's round+strip.
  if (u === 'percent') return `${v.toLocaleString('en-AU', { maximumFractionDigits: 2 })}%`
  if (u === 'index') return v.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (u === 'aud') return `$${n0(v)}`
  if (u === 'aud_million') return `$${n0(v)}m`
  if (u === 'aud_per_week') return `$${n0(v)}/wk`
  if (u === 'years') return `${v.toFixed(1)} yrs`
  if (u === 'usd_per_aud') {  // exchange rate, not a money amount
    return v.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (u.startsWith('usd')) {  // any USD-per-commodity money unit
    return Math.abs(v) < 10 ? `US$${v.toFixed(2)}` : `US$${n0(v)}`
  }
  if (['dwellings', 'applications', 'number', 'persons', 'lots'].includes(u)) return n0(v)
  return v.toLocaleString('en-AU', { maximumFractionDigits: 2 })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

// Compact day+month form (no year) for a tooltip row whose own date differs
// from the header date shown above it (X5: honest per-row dates when a
// tolerance-matched point isn't exactly at the hovered timestamp) — same
// zero-padded day convention as fmtDate, just shorter since the year is
// implied by the nearby header.
export function fmtDayMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]}`
}

export function fmtPeriod(iso: string, freq: string | null): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  const q = ['Mar', 'Jun', 'Sep', 'Dec'][Math.floor(d.getUTCMonth() / 3)]
  if (freq === 'quarterly') return `${q} qtr ${d.getUTCFullYear()}`
  if (freq === 'monthly' || freq === 'per_decision')
    return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
  if (freq === 'annual') return String(d.getUTCFullYear())
  return fmtDate(iso)
}

// Design review P1-metadata: the card caption keeps provenance visible but
// compact — a short token ("DFFH") rather than the full source title (which
// moves to the detail modal). A small ordered rule list handles the sources
// whose short form isn't just their first word (e.g. the vacancy series is
// credited to "Rental vacancy rate — SQM Research (via DFFH Rental
// Report)", whose first word is "Rental"); everything else falls back to
// its own first word, per the spec's explicit "fallback = first word".
const SOURCE_TOKEN_RULES: [RegExp, string][] = [
  [/^RBA\b/, 'RBA'],
  [/^ABS\b/, 'ABS'],
  [/^Cotality\b/, 'Cotality'],
  [/Cotality\/Domain/, 'Cotality'],
  [/^World Bank\b/, 'World Bank'],
  [/^FRED\b/, 'FRED'],
  [/^DFFH\b/, 'DFFH'],
  [/Homes Victoria/, 'Homes Victoria'],
  [/SQM Research/, 'SQM'],
  [/Urban Development Program/, 'DTP'],
]

export function shortSource(name: string | null | undefined): string {
  if (!name) return ''
  for (const [re, token] of SOURCE_TOKEN_RULES) if (re.test(name)) return token
  return name.split(/\s+/)[0]
}

export function ago(iso: string | null, now: Date): string {
  if (!iso) return 'unknown'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  const days = Math.floor((now.getTime() - t) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}
