const n0 = (v: number) => v.toLocaleString('en-AU', { maximumFractionDigits: 0 })
const sign = (d: number, s: string) => (d > 0 ? '+' : d < 0 ? '-' : '') + s

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
  melb_clearance: f(v => `${Math.round(v)}%`, d => sign(d, `${Math.round(Math.abs(d))} pp`)),
  oo_lending: f(v => `$${n0(v)}m`, d => sign(d, `${Math.abs(d).toFixed(1)}% qtr`)),
}

export function fmtUnit(v: number, unit: string): string {
  if (unit === 'percent') return `${+v.toFixed(2)}%`
  if (unit === 'index') return v.toLocaleString('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (unit === 'aud') return `$${n0(v)}`
  if (unit.startsWith('usd')) return v < 10 ? `US$${v.toFixed(2)}` : `US$${n0(v)}`
  if (['dwellings', 'applications', 'number', 'persons'].includes(unit)) return n0(v)
  return v.toLocaleString('en-AU', { maximumFractionDigits: 2 })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
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

export function ago(iso: string | null, now: Date): string {
  if (!iso) return 'unknown'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 'unknown'
  const days = Math.floor((now.getTime() - t) / 86_400_000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}
