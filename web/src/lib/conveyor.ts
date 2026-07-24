import { useEffect, useState } from 'react'
import { TILE_CHART } from '../components/HeroTiles'
import type { SiteData } from './types'
import type { Geo } from './urlState'
import { SCOPE_BADGE } from './geoBands'

export const ROTATE_MS = 5000
export const MIN_ROTATE = 3

// Same check LineChart uses — read at render time, no listener: a
// mid-session OS preference flip is rare enough that the next re-render
// picking it up is fine.
export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

// A pool slot: the hero key, the geo its finding/value should actually be
// read at, and (band entries only) the scope badge to show alongside it.
export type PoolEntry = { key: string; geo: Geo; badge?: string }

// The rotating headline pool, band-aligned (spec §1 amendment, 2026-07-24 —
// supersedes the earlier same-day strict-geo rule, which collapsed the
// melbourne banner to whichever hero keys happened to have a literal
// 'melbourne' finding and dropped cash_rate/mortgage_new permanently: a
// national-scope chart's finding is authored under its OWN fixed geo, e.g.
// 'australia', never replicated per UI geo — pipeline/findings.py's
// build_findings iterates `chart_geos(chart)` only). Band-aligned mirrors
// the page's own grid bands instead: hero_lead first, then the remaining
// hero picks in exported order, deduped; for each key —
//   1. the chart has a finding for the SELECTED geo -> first-class entry
//      `{ key, geo }`, rendered/quoted at that geo;
//   2. else the chart's scope is broader than local (state/national/
//      global) AND it has ANY finding -> a badged entry `{ key, geo:
//      chart.geos[0], badge: SCOPE_BADGE[scope] }`, rendered at the
//      chart's own geo — exactly like the grid's "Wider context" band;
//   3. else (a geo-scope chart lacking this geo, or a broken source with
//      findings: {}) -> excluded, matching the grid's hidden/absent bands.
// At the melbourne default this restores the pre-migration pool
// byte-for-byte (see conveyor.test.ts's regression test) — cash_rate and
// mortgage_new re-enter, badged 'Australia', at their own geo.
export function headlinePool(site: SiteData, geo: Geo): PoolEntry[] {
  const lead = site.hero_lead && site.hero_lead !== 'empty' ? [site.hero_lead] : []
  const seen = new Set<string>()
  const pool: PoolEntry[] = []
  for (const k of [...lead, ...site.hero.map(t => t.key)]) {
    if (k === 'empty' || seen.has(k)) continue
    seen.add(k)
    if (!site.hero.some(t => t.key === k)) continue
    const chartId = TILE_CHART[k]
    const chart = chartId ? site.charts.find(c => c.id === chartId) : undefined
    if (!chart) continue
    const findings = site.findings[chartId]
    if (findings?.[geo]) {
      pool.push({ key: k, geo })
      continue
    }
    const broaderScope = chart.scope === 'state' || chart.scope === 'national' || chart.scope === 'global'
    const ownGeo = chart.geos[0]
    if (broaderScope && findings && Object.keys(findings).length > 0 && ownGeo) {
      pool.push({ key: k, geo: ownGeo as Geo, badge: SCOPE_BADGE[chart.scope] })
    }
  }
  return pool
}

// The chart a tile key plots, and that chart's primary metric — the metric
// the banner's value line describes.
function primaryMetricOf(site: SiteData, tileKey: string):
    { chart: SiteData['charts'][number]; metric: string } | null {
  const chartId = TILE_CHART[tileKey]
  const chart = chartId ? site.charts.find(c => c.id === chartId) : undefined
  if (!chart) return null
  const entry = site.series[chart.series_id]
  const metric = chart.metrics?.[0] ?? (entry ? Object.keys(entry.units)[0] : undefined)
  return metric ? { chart, metric } : null
}

// Final-review fix (2026-07-24): the tri-state successor to the old boolean
// tileValueMatchesPrimary, which only ever checked the chart's FIRST geo
// (chart.geos[0]) — fine for a badge entry (always rendered at its own
// chart.geos[0]) but wrong for a first-class entry rendered at some OTHER
// geo the chart also covers: vic_approvals' export tile is the vic-wide
// number (chart.geos = [melbourne, regional_vic, vic, australia]), which the
// old boolean call — always probing geos[0] === melbourne — evaluated
// against the MELBOURNE level, mismatched, and so paired the Melbourne
// finding ("fell 16.3% to 3,343") with the Victoria-wide export value (4,704)
// on the melbourne default banner. The three-way split lets the caller tell
// "the tile quotes another geography's own number" (reroute to that geo)
// apart from "the tile is a different representation of ITS OWN geography"
// (keep the export value) instead of collapsing both into one false.
export type TileGeoMatch = { kind: 'at-render-geo' } | { kind: 'other-geo'; geo: string } | { kind: 'none' }

// Which of the chart's own geos (if any) does the EXPORT tile's value match
// the primary-metric level at? Distinguishes "the tile quotes another
// geography's number" (reroute) from "the tile is a different representation
// of its own geography" (keep).
export function tileValueGeoMatch(site: SiteData, tileKey: string, renderGeo: Geo): TileGeoMatch {
  const tile = site.hero.find(t => t.key === tileKey)
  const pm = primaryMetricOf(site, tileKey)
  if (!tile || tile.value == null || !pm) return { kind: 'none' }
  for (const g of pm.chart.geos) {
    const latest = latestForGeo(site, tileKey, g as Geo)
    if (latest && Math.abs(latest.value - tile.value) < 1e-6 * Math.max(1, Math.abs(tile.value))) {
      return g === renderGeo ? { kind: 'at-render-geo' } : { kind: 'other-geo', geo: g }
    }
  }
  return { kind: 'none' }
}

// Latest value (and same-metric delta) of the tile's chart primary metric at
// the requested geo. Null when the geo has no points; delta null when only
// one point exists — never another geo's or another metric's number.
export function latestForGeo(site: SiteData, tileKey: string, geo: Geo):
    { value: number; delta: number | null } | null {
  const pm = primaryMetricOf(site, tileKey)
  if (!pm) return null
  const entry = site.series[pm.chart.series_id]
  if (!entry) return null
  const pts = entry.points
    .filter(p => p.region === geo && p.metric === pm.metric && p.value != null)
    .sort((a, b) => a.date.localeCompare(b.date))
  if (pts.length === 0) return null
  const value = pts[pts.length - 1].value
  const delta = pts.length >= 2 ? value - pts[pts.length - 2].value : null
  return { value, delta }
}

// Timer-only hook: owns the offset and nothing else. `running` is the
// caller's aggregate of every pause condition (user pause, hover, focus,
// hidden tab, open modal, reduced motion, pool size) so tests can drive
// it as one boolean.
export function useConveyor(size: number, running: boolean) {
  const [offset, setOffset] = useState(0)
  // Bumped by jump(): a new epoch tears the interval down and restarts it,
  // so a manual dot-click always earns a full fresh 5 s before the next
  // auto-advance (spec §3) instead of inheriting the old tick's phase.
  const [epoch, setEpoch] = useState(0)
  useEffect(() => {
    if (!running || size < MIN_ROTATE) return
    const t = setInterval(() => setOffset(o => (o + 1) % size), ROTATE_MS)
    return () => clearInterval(t)
  }, [running, size, epoch])
  const jump = (i: number) => {
    if (size <= 0) return
    setOffset(((i % size) + size) % size)
    setEpoch(e => e + 1)
  }
  return { offset, jump }
}
