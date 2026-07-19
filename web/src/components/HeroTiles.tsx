import { useEffect, useRef, useState } from 'react'
import { TILE_FMT } from '../lib/format'
import { PALETTE } from '../theme/tokens'
import type { HeroTile } from '../lib/types'

/** Counts a number up once when the element first enters the viewport.
    Reduced motion (or no IntersectionObserver) => final value immediately. */
export function useCountUp(target: number | null, ms = 300): number | null {
  const [shown, setShown] = useState<number | null>(
    matchMedia('(prefers-reduced-motion: reduce)').matches ? target : target == null ? null : 0)
  const done = useRef(false)
  useEffect(() => {
    if (target == null || done.current ||
        matchMedia('(prefers-reduced-motion: reduce)').matches) { setShown(target); return }
    done.current = true
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / ms)
      setShown(target * (1 - Math.pow(1 - k, 3)))  // ease-out cubic
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return shown
}

function TileValue({ tile, big }: { tile: HeroTile; big: boolean }) {
  const fmt = TILE_FMT[tile.key]
  const shown = useCountUp(tile.value)
  return (
    <div className={`num font-semibold ${big ? 'text-3xl' : 'text-2xl'}`}>
      {shown != null && fmt ? fmt.value(shown) : '—'}
    </div>
  )
}

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

function deltaColor(t: HeroTile): string {
  if (t.delta == null || t.delta_color === 'off') return PALETTE.muted
  const up = t.delta > 0
  const good = t.delta_color === 'inverse' ? !up : up
  return good ? PALETTE.up : PALETTE.down
}

export function HeroTiles({ tiles, onOpen }: {
  tiles: HeroTile[]; onOpen: (chartId: string) => void }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
      {tiles.map((t, i) => {
        const fmt = TILE_FMT[t.key]
        const chartId = TILE_CHART[t.key]
        const body = (
          <>
            <div className="text-xs uppercase tracking-wide text-muted font-medium">
              {t.label}</div>
            <TileValue tile={t} big={i === 0} />
            {t.delta != null && fmt && (
              <div className="num text-sm font-medium" style={{ color: deltaColor(t) }}>
                {fmt.delta(t.delta)}</div>)}
            {t.last_date && (
              <div className="text-xs text-faint">Data to {t.last_date}</div>)}
          </>
        )
        return chartId && t.value != null ? (
          <button key={`${t.key}-${i}`} type="button" onClick={() => onOpen(chartId)}
                  className="text-left bg-card border border-line rounded-lg p-3 hover:border-blue">
            {body}</button>
        ) : (
          <div key={`${t.key}-${i}`} className="bg-card border border-line rounded-lg p-3">
            {body}</div>
        )
      })}
    </div>
  )
}
