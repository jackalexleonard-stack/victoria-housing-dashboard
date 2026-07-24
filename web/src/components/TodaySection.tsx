import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { deltaColor, HeroTiles, splitCadenceCode, TILE_CHART } from './HeroTiles'
import { Chip } from './Chip'
import { TILE_FMT, fmtPeriod, newsByline } from '../lib/format'
import { staleness } from '../lib/staleness'
import { headlinePool, latestForGeo, MIN_ROTATE, prefersReducedMotion,
         tileValueMatchesPrimary, useConveyor, type PoolEntry } from '../lib/conveyor'
import { PALETTE } from '../theme/tokens'
import { DEFAULT_GEO, type Geo } from '../lib/urlState'
import type { HeroTile, NewsData, SiteData } from '../lib/types'

const WHATS_NEW_CAP = 6

// Stale-source vintage for a "changed this week" chip (design review
// P1-stale) — badges the chip with its data's own vintage rather than
// excluding it (rent/vacancy stay core daily metrics even mid-outage).
// Returns null when the chip's chart/series can't be resolved (older
// exports without a matching chart) or when the source is actually fresh.
function whatsNewVintage(t: HeroTile, site: SiteData, now: Date):
    { text: string; kind: 'stale' | 'ageing' | 'failed' } | null {
  const chart = site.charts.find(c => c.id === TILE_CHART[t.key])
  const entry = chart ? site.series[chart.series_id] : undefined
  if (!entry || !t.last_date) return null
  const st = staleness(entry, now)
  if (st.kind === 'fresh') return null
  return { text: fmtPeriod(t.last_date, entry.meta.frequency), kind: st.kind }
}

// The lead-finding card [P0-1]: a pool entry names a hero registry key, the
// geo its finding/value should render at, and (band entries only) a scope
// badge — look up the chart via TILE_CHART and the sentence via
// site.findings, exactly the contract T1 exported headlinePool for. Renders
// nothing (not a broken card) when any link in that chain is missing, e.g.
// hero_lead is absent (older export) or resolves to the "empty" sentinel.
//
// Value line (2026-07-24 banner batch, Task 2): the default (melbourne)
// view keeps the export tiles verbatim — byte-identical to the pre-geo
// banner. Off-default, or for a band entry rendered away from the default
// geo, the line is instead computed client-side from the chart's own
// series at entry.geo, gated by tileValueMatchesPrimary so a tile whose
// export value isn't the chart's primary-metric level (e.g. the HVI MoM
// tiles) never mis-formats a level as a rate — it just omits the line
// (spec §1: when in doubt, omit).
function LeadCard({ site, entry, onOpen }: {
  site: SiteData; entry: PoolEntry; onOpen: (id: string) => void }) {
  const { key: leadKey, geo, badge } = entry
  const tile = site.hero.find(t => t.key === leadKey)
  const chartId = TILE_CHART[leadKey]
  const finding = chartId ? site.findings[chartId]?.[geo] ?? '' : undefined
  if (!tile || !chartId || !finding) return null
  const fmt = TILE_FMT[leadKey]
  let valueText: string | null = null
  let deltaText: string | null = null
  let deltaSrc: { delta: number | null; delta_color: HeroTile['delta_color'] } = tile
  if (geo === DEFAULT_GEO) {
    valueText = tile.value != null && fmt ? fmt.value(tile.value) : null
    deltaText = tile.delta != null && fmt ? fmt.delta(tile.delta) : null
  } else if (fmt && tileValueMatchesPrimary(site, leadKey)) {
    const latest = latestForGeo(site, leadKey, geo)
    if (latest) {
      valueText = fmt.value(latest.value)
      deltaText = latest.delta != null ? fmt.delta(latest.delta) : null
      deltaSrc = { delta: latest.delta, delta_color: tile.delta_color }
    }
  }
  return (
    <article data-testid="lead-finding-card"
              className="sm:col-span-2 bg-card border border-line rounded-lg p-5">
      <button type="button" onClick={() => onOpen(chartId)}
              className="block w-full text-left group">
        <motion.div key={`${chartId}-${geo}`} initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}>
          <h2 data-testid="lead-finding"
              className="font-display text-2xl sm:text-3xl leading-snug group-hover:text-blue">
            {finding}
          </h2>
          {badge && <p className="mt-1"><Chip kind="neutral">{badge}</Chip></p>}
          {(valueText || deltaText) && (
            <p className="num text-sm text-muted mt-2">
              {valueText}
              {deltaText && (
                <span className="ml-1.5 font-medium" style={{ color: deltaColor(deltaSrc) }}>
                  {deltaText}</span>
              )}
            </p>
          )}
        </motion.div>
      </button>
    </article>
  )
}

// Secondary finding cards [P0-1]: the next two pool entries (by the
// exported tile order — no client-side re-scoring), excluding whichever
// entry is leading. In production those two are almost always the cash-
// rate/Melb-values pins (they sit earliest in `hero`), which also satisfies
// "keep the pins visually first". Same per-geo/mis-format-guard value-line
// rule as LeadCard, above, minus the delta (it never showed one).
function SecondaryCard({ site, entry, onOpen }: {
  site: SiteData; entry: PoolEntry; onOpen: (id: string) => void }) {
  const { key: tileKey, geo, badge } = entry
  const tile = site.hero.find(t => t.key === tileKey)
  const chartId = TILE_CHART[tileKey]
  const finding = chartId ? site.findings[chartId]?.[geo] ?? '' : undefined
  if (!tile || !chartId || !finding) return null
  const fmt = TILE_FMT[tileKey]
  let valueText: string | null = null
  if (geo === DEFAULT_GEO) {
    valueText = tile.value != null && fmt ? fmt.value(tile.value) : null
  } else if (fmt && tileValueMatchesPrimary(site, tileKey)) {
    const latest = latestForGeo(site, tileKey, geo)
    if (latest) valueText = fmt.value(latest.value)
  }
  return (
    <article className="bg-card border border-line rounded-lg p-3">
      <button type="button" onClick={() => onOpen(chartId)} className="block w-full text-left group">
        <motion.div key={`${chartId}-${geo}`} initial={{ opacity: 0, x: 16 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}>
          <h3 className="font-display text-base leading-snug group-hover:text-blue">{finding}</h3>
          {badge && <p className="mt-0.5"><Chip kind="neutral">{badge}</Chip></p>}
          {valueText && <p className="num text-xs text-muted mt-1.5">{valueText}</p>}
        </motion.div>
      </button>
    </article>
  )
}

// Design review P0-2 (complete): rank the "changed this week" strip by the
// exported export-time notability score (scoring.score_metric, the same
// signal pick_hero uses), not by recency alone — score desc, nulls last
// (an unscoreable tile shouldn't out-rank a genuinely notable mover just
// because its data happened to land more recently), ties/nulls broken by
// changed_at (most recent first, the strip's old-and-only order).
function sortWhatsNew(tiles: HeroTile[]): HeroTile[] {
  return [...tiles].sort((a, b) => {
    if (a.score != null && b.score != null && a.score !== b.score) return b.score - a.score
    if (a.score != null && b.score == null) return -1
    if (a.score == null && b.score != null) return 1
    return (b.changed_at ?? '').localeCompare(a.changed_at ?? '')
  })
}

export function TodaySection({ site, news, onOpen, now, geo,
                               detailOpen = false }: {
  site: SiteData; news: NewsData; onOpen: (chartId: string) => void
  now: Date; geo: Geo; detailOpen?: boolean }) {
  const top = news.top_story_urls
    .map(u => news.items.find(i => i.url === u))
    .filter(i => i != null)

  // Band-aligned per-geo pool (2026-07-24 banner batch): the banner is
  // always on — no more filters-active gate that zeroed it — and every
  // entry renders at ITS OWN geo (selected-geo first-class, or a band
  // entry's own broader-scope geo, badged), mirroring the page's own grid
  // bands (see headlinePool's doc comment).
  const pool = useMemo(() => headlinePool(site, geo), [site, geo])
  const rotating = pool.length >= MIN_ROTATE
  const [userPaused, setUserPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(() =>
    typeof document !== 'undefined' && document.visibilityState === 'hidden')
  useEffect(() => {
    const onVis = () => setHidden(document.visibilityState === 'hidden')
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  const running = rotating && !userPaused && !hovered && !focused && !hidden &&
    !detailOpen && !prefersReducedMotion()
  const { offset, jump } = useConveyor(pool.length, running)
  const pos = pool.length > 0 ? offset % pool.length : 0
  const leadEntry = pool.length > 0 ? pool[pos] : null
  const secondaryEntries = pool.length > 1
    ? [pool[(pos + 1) % pool.length],
       pool.length > 2 ? pool[(pos + 2) % pool.length] : null]
        .filter((e): e is PoolEntry => e != null)
    : []

  const [expanded, setExpanded] = useState(false)
  const whatsNew = sortWhatsNew(site.whats_new)
  const shownChanges = expanded ? whatsNew : whatsNew.slice(0, WHATS_NEW_CAP)
  const restCount = whatsNew.length - WHATS_NEW_CAP

  return (
    <section aria-label="Today">
      {leadEntry && (
        <div>
          {/* final-review Fix 1: the pause handlers + headline-conveyor
              testid wrap ONLY the cards, not the controls below. When the
              controls lived inside this region, hovering/focusing "Resume"
              kept hovered/focused true, so rotation didn't visibly resume
              until the user moved away — the button was trapped inside the
              very region it was meant to release. Do not "tidy" the
              controls back inside this div. */}
          <div data-testid="headline-conveyor" aria-live="off"
               onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
               onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}>
            <div className="grid gap-3 sm:grid-cols-3">
              <LeadCard site={site} entry={leadEntry} onOpen={onOpen} />
              {secondaryEntries.length > 0 && (
                <div data-testid="secondary-findings"
                     className="grid grid-cols-2 gap-3 sm:grid-cols-1">
                  {secondaryEntries.map(e =>
                    <SecondaryCard key={e.key} site={site} entry={e} onOpen={onOpen} />)}
                </div>
              )}
            </div>
          </div>
          {rotating && (
            <div className="flex items-center gap-1 mt-2" data-testid="conveyor-controls">
              <button type="button" aria-pressed={userPaused}
                      aria-label={userPaused ? 'Resume rotating findings' : 'Pause rotating findings'}
                      onClick={() => setUserPaused(p => !p)}
                      className="text-muted hover:text-ink pointer-coarse:p-2.5">
                <span aria-hidden="true" className="material-symbols-rounded text-lg block">
                  {userPaused ? 'play_arrow' : 'pause'}</span>
              </button>
              {pool.map((entry, i) => (
                <button key={entry.key} type="button" onClick={() => jump(i)}
                        aria-label={`Show finding ${i + 1} of ${pool.length}`}
                        aria-current={i === pos ? 'true' : undefined}
                        className="p-1.5 pointer-coarse:p-2.5 group">
                  <span aria-hidden="true"
                        className={`block w-1.5 h-1.5 rounded-full ${
                          i === pos ? 'bg-blue' : 'bg-line2 group-hover:bg-faint'}`} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* Backlog cleanup: this explainer was a hover-only `title=` attr,
          unreachable by touch or keyboard. A visible caption line matches
          the product's own honest-caption idiom (e.g. ChartCard's band
          caption) rather than an aria-describedby'd sr-only alternative. */}
      <div className={leadEntry ? 'mt-4' : ''} data-testid="hero-strip">
        <p className="text-xs text-faint mb-2">Today's most notable movements</p>
        <HeroTiles tiles={site.hero} extraTiles={site.extra_tiles} onOpen={onOpen} />
      </div>
      {whatsNew.length > 0 && (
        <div className="mt-4" data-testid="whats-new">
          <h3 className="font-display text-lg mb-2">Changed this week</h3>
          <ul className="flex flex-wrap gap-2">
            {shownChanges.map(t => {
              const fmt = TILE_FMT[t.key]
              const { label, code } = splitCadenceCode(t.label)
              const deltaText = t.delta != null && fmt ? fmt.delta(t.delta) : null
              const vintage = whatsNewVintage(t, site, now)
              return (
                <li key={t.key}>
                  <button type="button" onClick={() => onOpen(TILE_CHART[t.key])}
                          className="text-xs bg-card border border-line rounded-full px-3 py-1.5 hover:border-blue num">
                    <span className="text-muted">{label}</span>{' '}
                    <span className="font-medium">
                      {t.value != null && fmt ? fmt.value(t.value) : '—'}</span>
                    {deltaText && (
                      <span className="font-medium ml-1" style={{ color: deltaColor(t) }}>
                        {deltaText}{code ? ` (${code})` : ''}
                      </span>
                    )}
                    {vintage && (
                      <span className="ml-1"
                            style={{ color: vintage.kind === 'failed' ? PALETTE.down : PALETTE.warn }}>
                        · {vintage.text}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
          {restCount > 0 && (
            <button type="button" onClick={() => setExpanded(x => !x)} aria-expanded={expanded}
                    className="text-xs text-blue mt-2">
              {expanded ? 'Show fewer' : `and ${restCount} more changes`}
            </button>
          )}
        </div>
      )}
      {top.length > 0 && (
        <div className="mt-5">
          <h3 className="font-display text-lg mb-1">Top stories</h3>
          <p className="text-xs text-faint mb-2">Ranked by source, topic and recency</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {top.map(item => (
              <article key={item.url} className="flex gap-3 bg-card border border-line rounded-lg p-3">
                {item.image
                  ? <img src={item.image} alt="" loading="lazy"
                         className="w-16 h-16 object-cover rounded-md shrink-0" />
                  : <span aria-hidden="true"
                          className="material-symbols-rounded text-muted w-16 h-16 flex items-center justify-center bg-bg2 rounded-md shrink-0">
                      newspaper</span>}
                <div className="min-w-0">
                  <a href={item.url} target="_blank" rel="noreferrer"
                     className="font-medium text-sm leading-snug hover:text-blue">
                    {item.title}</a>
                  <p className="text-xs text-faint mt-1">
                    {newsByline(item.source, item.published, item.dup_sources.length > 0
                      ? `covered by ${item.dup_sources.length + 1} outlets` : undefined)}
                  </p>
                </div>
              </article>
            ))}
          </div>
        </div>
      )}
      {news.digest && (
        <p className="mt-4 text-sm text-muted border-t border-line pt-3 max-w-[70ch]">
          {news.digest}</p>
      )}
    </section>
  )
}
