import { useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { deltaColor, HeroTiles, splitCadenceCode, TILE_CHART } from './HeroTiles'
import { Chip } from './Chip'
import { TILE_FMT, fmtPeriod, newsByline } from '../lib/format'
import { staleness } from '../lib/staleness'
import { headlinePool, latestForGeo, MIN_ROTATE, prefersReducedMotion,
         tileValueGeoMatch, useConveyor, type PoolEntry } from '../lib/conveyor'
import { PALETTE } from '../theme/tokens'
import type { Geo } from '../lib/urlState'
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

// Final-review fix (2026-07-24): the tri-state value-line rule shared by
// LeadCard and SecondaryCard, superseding the old two-path version (a
// geo===DEFAULT_GEO fast path for the default view, plus a binary
// tileValueMatchesPrimary guard for everything else). That split had two
// bugs, both stemming from the fast path trusting the export tile's value
// unconditionally whenever the RENDER geo happened to be the default,
// without checking whether the tile's number actually described that geo:
//   - a band/badge entry's `entry.geo` is always its OWN chart geo (e.g.
//     'australia' for a national card), never DEFAULT_GEO, so the fast path
//     never fired for it — au_dwelling_values then fell to the binary guard,
//     which only ever probed chart.geos[0] for a match; its export value is
//     a MoM% (not the geos[0] level), so the guard failed and the value line
//     was silently dropped.
//   - a first-class entry CAN land on DEFAULT_GEO with an export tile whose
//     number belongs to a DIFFERENT geo the same chart also covers —
//     vic_approvals' tile is the vic-wide figure, but at geo='melbourne' the
//     fast path paired it with the Melbourne finding sentence regardless,
//     mismatching a "fell 16.3% to 3,343" headline with a "4,704" number.
// tileValueGeoMatch(site, key, entry.geo) replaces both paths with one
// three-way read of what the export tile's number actually IS, relative to
// the geo this card is rendering:
//   'at-render-geo' -> the tile's value already IS entry.geo's primary-metric
//     level -> show the export tile's value/delta verbatim.
//   'other-geo'      -> the tile's value is the SAME metric at a DIFFERENT
//     geo of this chart -> recompute value+delta from the chart's own series
//     AT entry.geo instead, so the number always agrees with the finding
//     sentence sitting above it.
//   'none'           -> the tile is a different REPRESENTATION of its own
//     chart (e.g. an HVI MoM% next to a level chart) -> still show the
//     export tile's value/delta, but only when entry.geo IS that chart's own
//     primary geo (chart.geos[0]); anywhere else the number isn't honestly
//     attributable to the rendered geo, so the line is omitted entirely
//     (spec §1: when in doubt, omit). `deltaColor` always receives the
//     DISPLAYED delta paired with the registry's own delta_color.
function valueLine(site: SiteData, tileKey: string, entry: PoolEntry, tile: HeroTile):
    { valueText: string; deltaText: string | null; deltaSrc: { delta: number | null
        delta_color: HeroTile['delta_color'] } } | null {
  const fmt = TILE_FMT[tileKey]
  if (!fmt) return null
  const match = tileValueGeoMatch(site, tileKey, entry.geo)
  if (match.kind === 'other-geo') {
    const latest = latestForGeo(site, tileKey, entry.geo)
    if (!latest) return null
    return { valueText: fmt.value(latest.value),
             deltaText: latest.delta != null ? fmt.delta(latest.delta) : null,
             deltaSrc: { delta: latest.delta, delta_color: tile.delta_color } }
  }
  const ownGeo = match.kind === 'at-render-geo' ||
    site.charts.find(c => c.id === TILE_CHART[tileKey])?.geos[0] === entry.geo
  if (!ownGeo || tile.value == null) return null
  return { valueText: fmt.value(tile.value),
           deltaText: tile.delta != null ? fmt.delta(tile.delta) : null,
           deltaSrc: tile }
}

// The lead-finding card [P0-1]: a pool entry names a hero registry key, the
// geo its finding/value should render at, and (band entries only) a scope
// badge — look up the chart via TILE_CHART and the sentence via
// site.findings, exactly the contract T1 exported headlinePool for. Renders
// nothing (not a broken card) when any link in that chain is missing, e.g.
// hero_lead is absent (older export) or resolves to the "empty" sentinel.
// Value line: see valueLine's tri-state rule, above.
function LeadCard({ site, entry, onOpen }: {
  site: SiteData; entry: PoolEntry; onOpen: (id: string) => void }) {
  const { key: leadKey, geo, badge } = entry
  const tile = site.hero.find(t => t.key === leadKey)
  const chartId = TILE_CHART[leadKey]
  const finding = chartId ? site.findings[chartId]?.[geo] ?? '' : undefined
  if (!tile || !chartId || !finding) return null
  const line = valueLine(site, leadKey, entry, tile)
  const valueText = line?.valueText ?? null
  const deltaText = line?.deltaText ?? null
  const deltaSrc: { delta: number | null; delta_color: HeroTile['delta_color'] } =
    line?.deltaSrc ?? tile
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
// "keep the pins visually first". Same tri-state value-line rule as
// LeadCard, above (valueLine), minus the delta (it never showed one).
function SecondaryCard({ site, entry, onOpen }: {
  site: SiteData; entry: PoolEntry; onOpen: (id: string) => void }) {
  const { key: tileKey, geo, badge } = entry
  const tile = site.hero.find(t => t.key === tileKey)
  const chartId = TILE_CHART[tileKey]
  const finding = chartId ? site.findings[chartId]?.[geo] ?? '' : undefined
  if (!tile || !chartId || !finding) return null
  const valueText = valueLine(site, tileKey, entry, tile)?.valueText ?? null
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
