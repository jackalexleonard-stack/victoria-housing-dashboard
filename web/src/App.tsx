import { useEffect, useMemo, useRef, useState } from 'react'
import { loadAll } from './lib/load'
import type { NewsData, SiteData } from './lib/types'
import { siteIsStale, staleness } from './lib/staleness'
import { fmtDate } from './lib/format'
import { useUrlState } from './lib/urlState'
import { PALETTE } from './theme/tokens'
import { Masthead } from './components/Masthead'
import { FilterBar } from './components/FilterBar'
import { TodaySection } from './components/TodaySection'
import { ChartCard } from './components/ChartCard'
import { NewsSection } from './components/NewsSection'
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

export default function App({ now = new Date() }: { now?: Date }) {
  const [data, setData] = useState<{ site: SiteData; news: NewsData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { state, setFilters, openDetail, closeDetail, setCompare } = useUrlState()
  const [active, setActive] = useState('today')
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
  const failedCount = Object.values(site.series)
    .filter(s => staleness(s, now).kind === 'failed').length
  const jump = (id: string) => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    sectionsRef.current[id]?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' })
  }
  const contentSections = site.sections.filter(([id]) => !['today', 'news'].includes(id))

  return (
    <main className="max-w-5xl mx-auto px-4 pb-16">
      <Masthead generatedAt={site.generated_at} failedCount={failedCount} />
      {siteIsStale(site.generated_at, now) && (
        <p role="alert" className="text-sm rounded-md px-3 py-2 mb-3"
           style={{ background: PALETTE.chip_warn, color: PALETTE.warn }}>
          The daily update hasn't run since {fmtDate(site.generated_at)} — data may be stale.
        </p>
      )}
      <FilterBar range={state.range} geo={state.geo} sections={site.sections}
                 activeSection={active} onFilters={setFilters} onJump={jump} />
      <div ref={el => { sectionsRef.current.today = el }} id="today" className="pt-6">
        <TodaySection site={site} news={news} onOpen={openDetail} />
      </div>
      {contentSections.map(([id, label]) => {
        const charts = site.charts.filter(c => c.section === id)
        return (
          <section key={id} id={id} ref={el => { sectionsRef.current[id] = el }}
                   className="pt-10" aria-label={label}>
            <h2 className="font-display text-2xl mb-4">{label}</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {charts.map((c, i) => (
                <div key={c.id} className={i === 0 ? 'sm:col-span-2' : ''}>
                  <ChartCard site={site} chart={c} finding={site.findings[c.id]}
                             range={state.range} geo={state.geo} now={now}
                             onOpen={openDetail} />
                </div>
              ))}
            </div>
          </section>
        )
      })}
      <section id="news" ref={el => { sectionsRef.current.news = el }}
               className="pt-10" aria-label="News">
        <h2 className="font-display text-2xl mb-4">News</h2>
        <NewsSection news={news} />
      </section>
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
