import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAll } from './lib/load'
import type { NewsData, SiteData } from './lib/types'
import { siteIsStale, staleness } from './lib/staleness'
import { fmtDate, fmtPeriod } from './lib/format'
import { sectionOutageNotice, type SectionState } from './lib/sections'
import { DEFAULT_GEO, DEFAULT_RANGE, useUrlState } from './lib/urlState'
import { PALETTE } from './theme/tokens'
import { Masthead, type FailedSource } from './components/Masthead'
import { FilterBar } from './components/FilterBar'
import { TodaySection } from './components/TodaySection'
import { ChartCard } from './components/ChartCard'
import { NewsSection } from './components/NewsSection'
import { WorldTiles } from './components/WorldTiles'
import { DetailView } from './components/DetailView'

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
  const filtersActive = state.range !== DEFAULT_RANGE || state.geo !== DEFAULT_GEO
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
                 activeSection={active} onFilters={setFilters} onJump={jump} />
      <div ref={el => { sectionsRef.current.today = el }} id="today"
           className="pt-6 scroll-mt-28">
        <TodaySection site={site} news={news} onOpen={openDetail} now={now}
                      filtersActive={filtersActive} detailOpen={!!detailChart} />
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
                {outageNotice && (
                  <p role="status" className="text-sm rounded-md px-3 py-2 mb-3"
                     style={{ background: PALETTE.chip_warn, color: PALETTE.chip_warn_text }}>
                    {outageNotice.token} source unavailable — data to {outageNotice.period}
                  </p>
                )}
                {id === 'news' ? (
                  <NewsSection news={news} now={now} />
                ) : id === 'world' ? (
                  // D1(f): the expanded World section renders one compact
                  // KPI tile row instead of six full-height chart cards —
                  // each tile still opens the same detail modal (full line +
                  // provenance) on tap, unchanged from before.
                  <WorldTiles site={site} charts={charts} now={now} onOpen={openDetail} />
                ) : (
                  <div className="grid sm:grid-cols-2 gap-4">
                    {charts.map((c, i) => {
                      // D2(e): the first card always spans full width (the
                      // section's lead chart); everything else pairs up
                      // 2-per-row. When the remaining count (charts.length -
                      // 1) is odd, the LAST card is left alone in its own row
                      // with the right half of the grid empty — span it full
                      // width too instead of leaving it dangling.
                      const dangling = i === charts.length - 1 &&
                        (charts.length - 1) % 2 === 1
                      return (
                        <div key={c.id} className={i === 0 || dangling ? 'sm:col-span-2' : ''}>
                          <ChartCard site={site} chart={c} finding={site.findings[c.id]}
                                     range={state.range} geo={state.geo} now={now}
                                     onOpen={openDetail} quietOutage={!!outageNotice} />
                        </div>
                      )
                    })}
                  </div>
                )}
              </>
            ) : null}
          </section>
        )
      })}
      <footer className="text-xs text-faint border-t border-line mt-12 pt-4">
        Free public sources, updated daily by GitHub Actions ·{' '}
        <a className="underline" href={DATA_URL}>data & methodology</a>
      </footer>
      {detailChart && (
        <DetailView site={site} chart={detailChart}
                    finding={site.findings[detailChart.id]}
                    range={state.range} geo={state.geo} compare={state.compare}
                    now={now} onClose={closeDetail} onCompare={setCompare} />
      )}
    </main>
  )
}
