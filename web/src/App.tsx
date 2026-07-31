import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAll } from './lib/load'
import type { NewsData, SiteData } from './lib/types'
import { siteIsStale, staleness } from './lib/staleness'
import { fmtDate, fmtPeriod } from './lib/format'
import { sectionOutageNotice, type SectionState } from './lib/sections'
import { bandFor, hiddenTitles, isDeadChart, SCOPE_BADGE } from './lib/geoBands'
import { GEO_LABEL } from './lib/selectors'
import { useUrlState } from './lib/urlState'
import { PALETTE } from './theme/tokens'
import { Masthead, type FailedSource } from './components/Masthead'
import { FilterBar } from './components/FilterBar'
import { TodaySection } from './components/TodaySection'
import { ChartCard } from './components/ChartCard'
import { NewsSection } from './components/NewsSection'
import { WorldTiles } from './components/WorldTiles'
import { DetailView } from './components/DetailView'
import { WelcomeModal } from './components/WelcomeModal'
import { Popover } from './components/Popover'
import { ExplainerPanel } from './components/StatusChip'

const DATA_URL =
  'https://github.com/jackalexleonard-stack/victoria-housing-dashboard/tree/main/data'

function Skeleton() {
  return (
    <div aria-busy="true" className="animate-pulse space-y-4 pt-6">
      <div className="h-8 w-64 bg-bg2 rounded" />
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {Array.from({ length: 5 }, (_, i) =>
          <div key={i} className="h-24 bg-bg2 rounded-lg" />)}
      </div>
      {Array.from({ length: 3 }, (_, i) =>
        <div key={i} className="h-64 bg-bg2 rounded-lg" />)}
    </div>
  )
}

// A section <h2> that doubles as a disclosure control: the heading text
// stays a real heading (screen-reader landmark navigation still works) while
// the button carries the toggle semantics and the rotating chevron. The
// icon span is aria-hidden so the button's accessible name is just the
// label — the global prefers-reduced-motion rule already zeroes out the
// rotation transition, so no extra handling is needed here.
function SectionHeading({ label, open, onToggle }: {
  label: string; open: boolean; onToggle: () => void }) {
  return (
    <h2 className="font-display text-2xl mb-4">
      <button type="button" onClick={onToggle} aria-expanded={open}
              className="flex items-center gap-1.5 text-left hover:text-blue">
        {label}
        <span aria-hidden="true"
              className={`material-symbols-rounded text-xl text-muted transition-transform duration-200 ${
                open ? '' : '-rotate-90'}`}>
          expand_more
        </span>
      </button>
    </h2>
  )
}

const SECTIONS_KEY = 'vh.sections'
// Superseded by SECTIONS_KEY (a flat array can't carry per-section
// open/closed state) — read once for migration, then removed.
const OLD_COLLAPSED_KEY = 'vh.collapsed'
const HINT_KEY = 'vh.sectionsHintDismissed'
const WELCOME_KEY = 'vh.welcomeSeen'

// Storage can throw (private-mode Safari, disabled cookies, etc.) — degrade
// to "everything closed" (the app's default, 2.5) rather than crash the app
// over a persistence nicety. Migrates the old vh.collapsed array into
// explicit 'closed' overrides under the new key — sections that were open
// under the old scheme carry no override at all, so they now fall back to
// the default-closed state like everything else.
function readSectionOverrides(): Record<string, SectionState> {
  try {
    const raw = localStorage.getItem(SECTIONS_KEY)
    if (raw) return JSON.parse(raw) as Record<string, SectionState>
    const old = localStorage.getItem(OLD_COLLAPSED_KEY)
    if (!old) return {}
    const ids = JSON.parse(old) as string[]
    const migrated = Object.fromEntries(ids.map(id => [id, 'closed' as const]))
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(migrated))
    localStorage.removeItem(OLD_COLLAPSED_KEY)
    return migrated
  } catch {
    return {}
  }
}

function writeSectionOverrides(overrides: Record<string, SectionState>) {
  try {
    localStorage.setItem(SECTIONS_KEY, JSON.stringify(overrides))
  } catch {
    // ignore — collapse state just won't persist this session
  }
}

export default function App({ now = new Date() }: { now?: Date }) {
  const [data, setData] = useState<{ site: SiteData; news: NewsData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { state, setFilters, openDetail, closeDetail, setCompare, setSections } = useUrlState()
  const [active, setActive] = useState('today')
  // Precedence at load: URL > localStorage > default-closed (spec §4). A
  // URL-seeded view is NOT persisted until the user actually toggles
  // something — viewing a shared preset link must not overwrite the
  // visitor's own saved state.
  const [overrides, setOverrides] = useState<Record<string, SectionState>>(() => {
    const fromUrl = state.sections
    if (fromUrl != null) {
      return Object.fromEntries(fromUrl.map(id => [id, 'open' as const]))
    }
    return readSectionOverrides()
  })
  // First-run modal gate (spec §3): show only on a genuine first visit —
  // no saved section state, no preset link, and not already onboarded
  // (WELCOME_KEY, or the legacy 2.5 hint's HINT_KEY — a user who dismissed
  // that hint must not be re-onboarded). Same order-dependency as before:
  // this read must run after the `overrides` initializer's vh.collapsed ->
  // vh.sections migration side effect.
  const [showWelcome, setShowWelcome] = useState(() => {
    try {
      return localStorage.getItem(WELCOME_KEY) == null &&
        localStorage.getItem(SECTIONS_KEY) == null &&
        localStorage.getItem(HINT_KEY) == null &&
        new URLSearchParams(location.search).get('sections') == null
    } catch { return false }
  })
  // Set by jump() when the target section was collapsed: the section body
  // must mount before scrollIntoView measures anything, so the actual scroll
  // happens in an effect that runs after that render commits.
  const [scrollTarget, setScrollTarget] = useState<string | null>(null)
  const sectionsRef = useRef<Record<string, HTMLElement | null>>({})

  const load = () => {
    setError(null)
    loadAll().then(setData).catch(e => setError(String(e)))
  }
  useEffect(load, [])

  useEffect(() => {
    if (!data) return
    const io = new IntersectionObserver(es => {
      const hit = es.find(e => e.isIntersecting)
      if (hit) setActive(hit.target.id)
    }, { rootMargin: '-20% 0px -70% 0px' })
    Object.values(sectionsRef.current).forEach(el => el && io.observe(el))
    return () => io.disconnect()
  }, [data])

  // Runs after the freshly-expanded section's body has actually mounted, so
  // scrollIntoView measures real layout rather than the still-collapsed one.
  useEffect(() => {
    if (scrollTarget == null) return
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    sectionsRef.current[scrollTarget]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
    setScrollTarget(null)
  }, [scrollTarget])

  const detailChart = useMemo(() =>
    data?.site.charts.find(c => c.id === state.detail) ?? null, [data, state.detail])

  // Mirrors the "Wider context" band's own-geo rule (see the `own` comment
  // below): a context-band chart (e.g. a scope="state", region_mode="geo"
  // chart like `activity`, geos:['vic','australia']) has no rows for
  // state.geo at all — passing state.geo straight into DetailView would
  // filter chartPoints down to zero and render the honest-outage empty
  // state under a headline that already quotes the chart's OWN geo (the
  // `finding` lookup below already falls back to geos[0]), a
  // headline/chart contradiction plus a geography gap misreported as an
  // outage. Resolve the modal's geo the same way: only fall back to the
  // chart's own primary geo when it genuinely doesn't cover state.geo.
  // A FAILED source (`geos: []`) must keep state.geo and continue to show
  // the honest outage card — `geos.length > 0` guards that case.
  const detailGeo = detailChart && detailChart.geos.length > 0 &&
      !detailChart.geos.includes(state.geo)
    ? (detailChart.geos[0] as typeof state.geo)
    : state.geo

  if (error) return (
    <main className="max-w-3xl mx-auto px-4 py-16 text-center">
      <h1 className="font-display text-2xl mb-2">The briefing didn't load</h1>
      <p className="text-sm text-muted mb-4">{error}</p>
      <button type="button" onClick={load}
              className="border border-line rounded-md px-4 py-2 text-sm hover:border-blue hover:text-blue">
        Retry</button>
      <p className="text-xs text-faint mt-4">
        The raw data is public on <a className="underline" href={DATA_URL}>GitHub</a>.</p>
    </main>
  )
  if (!data) return <main className="max-w-5xl mx-auto px-4"><Skeleton /></main>

  const { site, news } = data
  const contentSections = site.sections.filter(([id]) => id !== 'today')
  const applySections = (next: Record<string, SectionState>) => {
    setOverrides(next)
    writeSectionOverrides(next)
    setSections(contentSections.map(([id]) => id).filter(id => next[id] === 'open'))
  }
  const toggleSection = (id: string) =>
    applySections({ ...overrides, [id]: sectionOpen(id) ? 'closed' as const : 'open' as const })
  const setAllSections = (openIds: string[]) =>
    applySections(Object.fromEntries(contentSections.map(([id]) =>
      [id, openIds.includes(id) ? 'open' as const : 'closed' as const])))
  const resetSections = () => {
    setOverrides({})
    try { localStorage.removeItem(SECTIONS_KEY) } catch { /* ignore */ }
    setSections(null)
  }
  const enterFromWelcome = (openIds: string[]) => {
    setAllSections(openIds)
    try { localStorage.setItem(WELCOME_KEY, '1') } catch { /* ignore */ }
    setShowWelcome(false)
  }
  const failedSources: FailedSource[] = Object.values(site.series)
    .filter(s => staleness(s, now).kind === 'failed')
    .map(s => ({
      source: s.meta.source_name ?? 'Unknown source',
      vintage: s.meta.last_data_date
        ? fmtPeriod(s.meta.last_data_date, s.meta.frequency) : 'No data',
    }))
  // Today never collapses; every themed section is closed unless the user
  // opened it (2.5: no viewport-aware default — absent override = closed).
  const sectionOpen = (id: string): boolean => {
    if (id === 'today') return true
    return overrides[id] === 'open'
  }
  const jump = (id: string) => {
    if (!sectionOpen(id)) {
      // Expand first — the scroll itself happens once the body has mounted
      // (see the scrollTarget effect above), not synchronously here.
      toggleSection(id)
      setScrollTarget(id)
      return
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    sectionsRef.current[id]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
  }

  return (
    <main className="max-w-5xl mx-auto px-4 pb-16">
      <Masthead generatedAt={site.generated_at} failedSources={failedSources} />
      {siteIsStale(site.generated_at, now) && (
        <p role="alert" className="text-sm rounded-md px-3 py-2 mb-3"
           style={{ background: PALETTE.chip_warn, color: PALETTE.chip_warn_text }}>
          The daily update hasn't run since {fmtDate(site.generated_at)} — data may be stale.
        </p>
      )}
      <FilterBar range={state.range} geo={state.geo} sections={site.sections}
                 activeSection={active} onFilters={setFilters} onJump={jump}
                 isSectionOpen={sectionOpen} onSetSections={setAllSections}
                 onResetSections={resetSections} />
      <div ref={el => { sectionsRef.current.today = el }} id="today"
           className="pt-6 scroll-mt-28">
        <TodaySection site={site} news={news} onOpen={openDetail} now={now}
                      geo={state.geo} detailOpen={!!detailChart} />
      </div>
      {contentSections.map(([id, label]) => {
        const charts = site.charts.filter(c => c.section === id)
        const open = sectionOpen(id)
        const outageNotice = id !== 'news' ? sectionOutageNotice(charts, site, now) : null
        return (
          <section key={id} id={id} ref={el => { sectionsRef.current[id] = el }}
                   className="pt-10 scroll-mt-28" aria-label={label}>
            <SectionHeading label={label} open={open} onToggle={() => toggleSection(id)} />
            {open ? (
              <>
                {/* Design review P1-outage: Rents' five failed/stale cards
                    all trace back to one DFFH outage — say so once, here,
                    instead of five identical red chips (each card's own
                    chip still shows, just downgraded to a quiet pill via
                    ChartCard's `quietOutage`). */}
                {outageNotice && (() => {
                  const nEntry = site.series[outageNotice.seriesId]
                  const nSt = nEntry ? staleness(nEntry, now) : null
                  if (!nEntry || !nSt || nSt.kind === 'fresh') return null
                  return (
                    <div className="mb-3">
                      <Popover panelLabel="Why this section’s data is old" block
                               trigger={`${outageNotice.token} — awaiting new release · data to ${outageNotice.period}`}
                               triggerClassName="text-sm rounded-md px-3 py-2 w-full text-left cursor-pointer border-0"
                               triggerStyle={{ background: PALETTE.chip_warn, color: PALETTE.chip_warn_text }}>
                        <ExplainerPanel entry={nEntry}
                                        kind={nSt.kind as 'ageing' | 'stale' | 'failed'}
                                        now={now} />
                      </Popover>
                    </div>
                  )
                })()}
                {id === 'news' ? (
                  <NewsSection news={news} now={now} />
                ) : id === 'world' ? (
                  // D1(f): the expanded World section renders one compact
                  // KPI tile row instead of six full-height chart cards —
                  // each tile still opens the same detail modal (full line +
                  // provenance) on tap, unchanged from before.
                  <WorldTiles site={site} charts={charts} now={now} onOpen={openDetail} />
                ) : (() => {
                  // T4: geo banding (spec §2) — a chart with no data for the
                  // selected geo either belongs in the "Wider context" band
                  // (broader scope than the selected geo, still legitimate)
                  // or is a genuine gap for this geography, named in the
                  // footnote instead of rendering a dead-looking card.
                  const sectionCharts = site.charts.filter(c => c.section === id)
                  const gridAll = sectionCharts.filter(c =>
                    bandFor(c, state.geo, site.series[c.series_id]) === 'grid')
                  // Design review "unavailable-source cards must always sit
                  // at the END of a section, never the beginning": split the
                  // grid band into healthy charts (registry order preserved)
                  // and dead charts (registry order preserved among
                  // themselves), and render dead charts LAST, after every
                  // healthy card — never as the section's spanning lead. The
                  // D2(e) lead/dangling span logic below is computed against
                  // the HEALTHY sublist only, so a dead chart can never
                  // become the section's lead card even when it happens to
                  // sit first in registry order (e.g. Prices' `auctions`).
                  const healthy = gridAll.filter(c =>
                    !isDeadChart(c, site.series[c.series_id]))
                  const dead = gridAll.filter(c =>
                    isDeadChart(c, site.series[c.series_id]))
                  const context = sectionCharts.filter(c =>
                    bandFor(c, state.geo, site.series[c.series_id]) === 'context')
                  const hidden = hiddenTitles(sectionCharts, state.geo, site.series)
                  return (
                    <>
                      <div className="grid sm:grid-cols-2 gap-4">
                        {healthy.map((c, i) => {
                          // D2(e): the first card always spans full width (the
                          // section's lead chart); everything else pairs up
                          // 2-per-row. When the remaining count (healthy.length
                          // - 1) is odd, the LAST card is left alone in its own
                          // row with the right half of the grid empty — span it
                          // full width too instead of leaving it dangling.
                          const dangling = i === healthy.length - 1 && (healthy.length - 1) % 2 === 1
                          return (
                            <div key={c.id} className={i === 0 || dangling ? 'sm:col-span-2' : ''}>
                              <ChartCard site={site} chart={c} finding={site.findings[c.id]?.[state.geo] ?? ''}
                                         range={state.range} geo={state.geo} now={now}
                                         onOpen={openDetail} quietOutage={!!outageNotice} />
                            </div>
                          )
                        })}
                        {dead.map(c => (
                          <div key={c.id} className="sm:col-span-2">
                            <ChartCard site={site} chart={c} finding={site.findings[c.id]?.[state.geo] ?? ''}
                                       range={state.range} geo={state.geo} now={now}
                                       onOpen={openDetail} quietOutage={!!outageNotice} />
                          </div>
                        ))}
                      </div>
                      {context.length > 0 && (
                        <div data-testid="context-band" className="mt-6">
                          <h3 className="text-xs text-faint uppercase tracking-wide mb-2">
                            Wider context</h3>
                          <div className="grid sm:grid-cols-2 gap-4">
                            {context.map(c => {
                              // A context card is NOT about the selected geo — render it at its
                              // OWN primary geo, for both the data and the finding. Passing
                              // state.geo here would filter a region_mode='geo' context chart
                              // (e.g. `activity` under melbourne) down to zero rows and render
                              // an empty card that falsely reads as a source outage.
                              const own = (c.geos[0] ?? state.geo) as typeof state.geo
                              return (
                                <div key={c.id}>
                                  <ChartCard site={site} chart={c}
                                             finding={site.findings[c.id]?.[own] ?? ''}
                                             range={state.range} geo={own} now={now}
                                             onOpen={openDetail} quietOutage={!!outageNotice}
                                             scopeBadge={SCOPE_BADGE[c.scope]} />
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                      {hidden.length > 0 && (
                        <p data-testid="geo-footnote" className="text-xs text-faint mt-3">
                          Not published for {GEO_LABEL[state.geo] ?? state.geo}: {hidden.join(', ')}.
                        </p>
                      )}
                    </>
                  )
                })()}
              </>
            ) : null}
          </section>
        )
      })}
      <footer className="text-xs text-faint border-t border-line mt-12 pt-4">
        Free public sources, updated daily by GitHub Actions ·{' '}
        <a className="underline" href={DATA_URL}>data & methodology</a>
      </footer>
      {showWelcome && (
        <WelcomeModal sections={contentSections} onEnter={enterFromWelcome} />
      )}
      {!showWelcome && detailChart && (
        <DetailView site={site} chart={detailChart}
                    finding={site.findings[detailChart.id]?.[state.geo] ??
                             site.findings[detailChart.id]?.[detailChart.geos[0]] ?? ''}
                    range={state.range} geo={detailGeo} compare={state.compare}
                    now={now} onClose={closeDetail} onCompare={setCompare} />
      )}
    </main>
  )
}
