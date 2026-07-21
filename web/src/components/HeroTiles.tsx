import { TILE_FMT } from '../lib/format'
import { PALETTE } from '../theme/tokens'
import type { ExtraTile, HeroTile } from '../lib/types'

export const TILE_CHART: Record<string, string> = {
  cash_rate: 'cash_rate', melb_dwelling_values: 'hvi_melbourne',
  au_dwelling_values: 'hvi_australia', vic_mean_price: 'mean_price',
  vic_approvals: 'approvals', accord_runrate: 'accord',
  melb_vacancy: 'vacancy', melb_rent_growth: 'rent_growth',
  credit_growth: 'credit', mortgage_new: 'mortgage_rates',
  vic_commencements: 'activity', vhr_waitlist: 'waitlist',
  nom: 'population', input_costs: 'input_costs', iron_ore: 'iron_ore',
  melb_rent: 'median_rent', greenfield_supply: 'land',
  melb_median_house: 'reiv_median', melb_clearance: 'auctions',
  oo_lending: 'lending',
}

// Design review P1-labels/ux-copy: a few registry labels pack a MoM/YoY
// cadence qualifier onto the headline ("Melb dwelling values (MoM)") — fine
// as data, wrong as a shouted eyebrow label. Split it off the label text so
// the tile/chip reads as a plain name; the qualifier rides the (already
// smaller, Inter) delta line instead. Deliberately narrow (MoM/yr only, not
// every parenthetical suffix like "(OO)"/"(REIV)", which name WHAT is
// measured rather than a value's own cadence) — keep it minimal.
const CADENCE_CODE_RE = /\s*\((MoM|yr)\)\s*$/i

export function splitCadenceCode(label: string): { label: string; code: string | null } {
  const m = label.match(CADENCE_CODE_RE)
  return m ? { label: label.slice(0, m.index).trimEnd(), code: m[1] } : { label, code: null }
}

// Shared by the compact hero/ERP strip and TodaySection's "changed this
// week" chips — same up/down/flat semantics either way (a HeroTile and an
// ExtraTile/whats_new entry all carry the same delta+delta_color shape).
export function deltaColor(t: { delta: number | null
                                delta_color: 'normal' | 'inverse' | 'off' }): string {
  if (t.delta == null || t.delta === 0 || t.delta_color === 'off') return PALETTE.muted
  const up = t.delta > 0
  const good = t.delta_color === 'inverse' ? !up : up
  return good ? PALETTE.up : PALETTE.down
}

// Design review P0-1 / D1(f): the low-level tile shell — label, big numeral
// value, an optional delta line, an optional trailing slot (e.g. a
// staleness chip) — shared by BOTH the hero/whats-new strip (HeroTiles
// below, which looks its value/delta up via the TILE_FMT registry) and the
// World KPI row (WorldTiles.tsx: six chart-only series with no hero-registry
// entry, whose value/delta are instead derived directly from the series'
// own points). Callers pre-format everything (valueText/deltaText/color) so
// this component owns ONLY the shell, not a formatting policy — the two
// callers' formatting sources differ enough (registry lookup vs. live point
// arithmetic) that sharing just the shell, rather than forking a
// near-identical renderer per caller, is what keeps this in one place.
export function Tile({ label, code, valueText, deltaText, color, chip, hasValue,
                       chartId, onOpen }: {
  label: string; code?: string | null
  valueText: string; deltaText: string | null; color: string
  chip?: React.ReactNode
  hasValue: boolean; chartId: string | undefined; onOpen: (chartId: string) => void }) {
  const body = (
    <>
      <div className="text-xs text-muted font-medium truncate">{label}</div>
      <div className="num font-semibold text-base leading-tight">{valueText}</div>
      {deltaText && (
        <div className="num text-xs font-medium" style={{ color }}>
          {deltaText}{code ? ` (${code})` : ''}
        </div>
      )}
      {chip && <div className="mt-1">{chip}</div>}
    </>
  )
  return chartId && hasValue ? (
    <button type="button" onClick={() => onOpen(chartId)}
            className="text-left bg-card border border-line rounded-lg p-2.5 hover:border-blue">
      {body}
    </button>
  ) : (
    <div className="bg-card border border-line rounded-lg p-2.5">{body}</div>
  )
}

// Design review P0-1: the five stat tiles compress into one compact, static
// (no count-up — that theatrics belonged to the old fold-dominating grid)
// Inter strip; the ERP population stat (extra_tiles, P0-5) rides along right
// after the five hero tiles. Tap-to-detail and the cash-rate/Melb-values
// pins-first ordering both fall out of rendering `tiles` in its exported
// order — no reordering logic needed here.
export function HeroTiles({ tiles, extraTiles = [], onOpen }: {
  tiles: HeroTile[]; extraTiles?: ExtraTile[]; onOpen: (chartId: string) => void }) {
  const registryTile = (t: HeroTile | ExtraTile, chartId: string | undefined, key: string) => {
    const fmt = TILE_FMT[t.key]
    const { label, code } = splitCadenceCode(t.label)
    const valueText = t.value != null && fmt ? fmt.value(t.value) : '—'
    const deltaText = t.delta != null && fmt ? fmt.delta(t.delta) : null
    return (
      <Tile key={key} label={label} code={code} valueText={valueText} deltaText={deltaText}
            color={deltaColor(t)} hasValue={t.value != null} chartId={chartId} onOpen={onOpen} />
    )
  }
  return (
    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
      {tiles.map((t, i) => registryTile(t, TILE_CHART[t.key], `${t.key}-${i}`))}
      {extraTiles.map(t => registryTile(t, t.chart, t.key))}
    </div>
  )
}
