import { chartPoints } from './selectors'
import type { ChartSpec, SiteData } from './types'
import type { Geo, Range } from './urlState'

// Spec 2026-07-31 §2.1: every card has an intrinsic height class, derived from
// the same data the card renders with — never a hardcoded chart list (except
// the one structurally-unique double-panel card).
export type HeightClass = 'tile' | 'tall' | 'standard'

export function heightClassFor(site: SiteData, chart: ChartSpec, range: Range,
                               geo: Geo, now: Date): HeightClass {
  if (chart.id === 'mortgage_rates') return 'tall'
  const { lines } = chartPoints(site, chart, range, geo, now)
  // Mirror of ChartCard's isStatTile gate: data present, but no line can draw
  // a segment — the card renders as a short stat tile.
  if (lines.length > 0 && lines.every(l => l.pts.length < 2)) return 'tile'
  return 'standard'
}

export interface Row { cards: ChartSpec[]; span: boolean }

// Walks a band in registry order (§2.2): pair only same-class neighbours,
// span everything else — a mismatch, a tall card, or a trailing orphan can
// never leave a half-empty row. Reading order is untouched by construction.
export function buildRows(cards: ChartSpec[],
                          classFn: (c: ChartSpec) => HeightClass,
                          opts: { leadSpans: boolean }): Row[] {
  const rows: Row[] = []
  let i = 0
  if (opts.leadSpans && cards.length > 0) {
    rows.push({ cards: [cards[0]], span: true })
    i = 1
  }
  while (i < cards.length) {
    const cls = classFn(cards[i])
    const next = i + 1 < cards.length ? cards[i + 1] : undefined
    if (cls !== 'tall' && next && classFn(next) === cls) {
      rows.push({ cards: [cards[i], next], span: false })
      i += 2
    } else {
      rows.push({ cards: [cards[i]], span: true })
      i += 1
    }
  }
  return rows
}
