import { useEffect, useState } from 'react'
import { TILE_CHART } from '../components/HeroTiles'
import type { SiteData } from './types'

export const ROTATE_MS = 5000
export const MIN_ROTATE = 3

// Same check LineChart uses — read at render time, no listener: a
// mid-session OS preference flip is rare enough that the next re-render
// picking it up is fine.
export const prefersReducedMotion = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

// The rotating headline pool (spec §3): hero_lead first, then the
// remaining hero picks in exported order, deduped — keeping exactly the
// guards LeadCard/SecondaryCard applied statically (a key must resolve to
// a hero tile, a TILE_CHART chart and a finding, and never the "empty"
// sentinel), so a degraded export can only shrink the pool, not crash it.
export function headlinePool(site: SiteData): string[] {
  const lead = site.hero_lead && site.hero_lead !== 'empty' ? [site.hero_lead] : []
  const seen = new Set<string>()
  const pool: string[] = []
  for (const k of [...lead, ...site.hero.map(t => t.key)]) {
    if (k === 'empty' || seen.has(k)) continue
    seen.add(k)
    const chartId = TILE_CHART[k]
    if (!chartId || !site.findings[chartId]) continue
    if (!site.hero.some(t => t.key === k)) continue
    pool.push(k)
  }
  return pool
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
