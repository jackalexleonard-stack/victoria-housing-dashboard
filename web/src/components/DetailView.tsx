import { useEffect, useRef, useState } from 'react'
import { LineChart } from './LineChart'
import { DataTable } from './DataTable'
import { Chip } from './Chip'
import { chartPoints, lineName } from '../lib/selectors'
import { staleness, nextUpdate } from '../lib/staleness'
import { ago, fmtPeriod, fmtUnit } from '../lib/format'
import { RANGES, type Geo, type Range } from '../lib/urlState'
import type { ChartSpec, SiteData } from '../lib/types'

function toCsv(lines: { name: string; pts: { date: string; value: number }[] }[]) {
  const rows = lines.flatMap(l => l.pts.map(p => `${p.date},${l.name},${p.value}`))
  return `date,series,value\n${rows.join('\n')}\n`
}

export function DetailView({ site, chart, finding, range, geo, compare, now,
                             onClose, onCompare }: {
  site: SiteData; chart: ChartSpec; finding: string; range: Range; geo: Geo
  compare: string | null; now: Date
  onClose: () => void; onCompare: (id: string | null) => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const h2 = useRef<HTMLHeadingElement>(null)
  const [localRange, setLocalRange] = useState<Range>(range)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const d = dlg.current
    if (d && !d.open) d.showModal()
    h2.current?.focus()
    const onCancel = (e: Event) => { e.preventDefault(); onClose() }
    d?.addEventListener('cancel', onCancel)
    return () => d?.removeEventListener('cancel', onCancel)
  }, [onClose])

  const entry = site.series[chart.series_id]
  const { lines, scopeNote } = chartPoints(site, chart, localRange, geo, now)
  // See ChartCard.tsx: a series can carry mixed units across its metrics, so
  // one scalar unit for the whole chart would misformat whichever metric
  // isn't first. Build a per-line unit map from the primary chart's own
  // metrics (or every metric the series has, when the chart doesn't name
  // specific ones) and merge in the compare chart's unit under its line's
  // name. The scalar `unit`/`cmpUnit` stay as fallbacks, derived from each
  // chart's primary metric where identifiable, else the first unit found.
  const chartMetrics = chart.metrics ?? (entry ? Object.keys(entry.units) : [])
  const primaryUnits = entry
    ? Object.fromEntries(chartMetrics.map(m => [lineName(m, site.metric_labels), entry.units[m] ?? '']))
    : {}
  const unit = entry ? (entry.units[chartMetrics[0]] ?? Object.values(entry.units)[0] ?? '') : ''
  const st = entry ? staleness(entry, now) : null
  const cmpChart = compare ? site.charts.find(c => c.id === compare) : null
  const cmpEntry = cmpChart ? site.series[cmpChart.series_id] : null
  const cmpMetrics = cmpChart ? (cmpChart.metrics ?? (cmpEntry ? Object.keys(cmpEntry.units) : [])) : []
  const cmpUnit = cmpEntry ? (cmpEntry.units[cmpMetrics[0]] ?? Object.values(cmpEntry.units)[0] ?? '') : ''
  const cmpLines = cmpChart
    ? chartPoints(site, cmpChart, localRange, geo, now).lines.slice(0, 1)
      .map(l => ({ ...l, name: cmpChart.title }))
    : []
  const unitByName = cmpChart ? { ...primaryUnits, [cmpChart.title]: cmpUnit } : primaryUnits
  // The stat block (Latest / vs previous / vs year ago) always describes the
  // primary chart's first line, so it should format with that line's own
  // unit rather than the chart-wide scalar fallback.
  const statUnit = (lines[0] && unitByName[lines[0].name]) ?? unit
  const primary = lines[0]?.pts ?? []
  const latest = primary[primary.length - 1]
  const prev = primary[primary.length - 2]
  const yearAgo = latest ? primary.filter(p =>
    Date.parse(p.date) <= Date.parse(latest.date) - 360 * 86_400_000).at(-1) : undefined

  const download = () => {
    const url = URL.createObjectURL(new Blob([toCsv([...lines, ...cmpLines])],
      { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url; a.download = `${chart.id}.csv`; a.click()
    URL.revokeObjectURL(url)
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href)
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard write can reject (permissions, unsupported context, etc.) —
      // fail quietly and leave the button label unchanged rather than
      // throwing an unhandled promise rejection.
    }
  }

  return (
    <dialog ref={dlg} aria-label={chart.title}
            className="w-full sm:max-w-2xl sm:rounded-xl bg-card p-5 m-auto
                       max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:max-w-none"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
      <div className="flex items-start gap-2">
        <h2 ref={h2} tabIndex={-1} className="font-display text-xl leading-snug flex-1">
          {finding}
        </h2>
        <button type="button" onClick={onClose} aria-label="Close"
                className="text-muted hover:text-ink text-xl leading-none px-1">×</button>
      </div>
      {/* Design review P1-touch: this inline range control was px-2.5 py-1
          (~24px tall), below the project's 44px mandate — the same defect
          class T5 already fixed on the action row below (Download CSV /
          Copy link / Source / Compare) and on FilterBar's Segmented.
          pointer-coarse:px-4 pointer-coarse:py-3.5 is the identical bump
          used on this component's own action row, kept consistent rather
          than inventing new sizing; fine-pointer sizing is untouched. */}
      <div role="radiogroup" aria-label="Range"
           className="inline-flex rounded-md border border-line overflow-hidden my-3">
        {RANGES.map(r => (
          <button key={r} role="radio" aria-checked={r === localRange} type="button"
                  onClick={() => setLocalRange(r)}
                  className={`px-2.5 py-1 text-xs num
                    pointer-coarse:px-4 pointer-coarse:py-3.5 ${r === localRange
                    ? 'bg-blue/10 text-blue font-medium' : 'text-muted'}`}>{r}</button>
        ))}
      </div>
      {lines.length
        ? <LineChart lines={[...lines, ...cmpLines]} percent={chart.percent}
                     unit={unit} markers={chart.markers} label={finding} height={280}
                     touchScrub
                     y2Lines={cmpChart ? cmpLines.map(l => l.name) : undefined}
                     y2Percent={cmpChart?.percent}
                     unitByName={unitByName}
                     annotations={chart.annotate
                       ? site.annotations.cash_rate_moves.map(m => ({
                           date: m.date, label: `${m.delta > 0 ? '+' : ''}${m.delta}` }))
                       : []}
                     // The detail modal always gets the complete, fully
                     // labelled annotation set (design review P0-4) — the
                     // card-level 'band'/'latest-label' compaction is
                     // ChartCard-only. Also deliberately never passes
                     // `emphasize`: the modal is the deep-dive, so every
                     // line stays full-colour even on charts that
                     // de-emphasise at card size (design review P1-emphasis).
                     annotationMode="full" />
        : <p className="text-sm text-muted py-10 text-center">
            No recent data — source currently unavailable
            {entry?.meta.error && <span className="block text-xs mt-1">{entry.meta.error}</span>}
          </p>}
      {latest && (
        <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm num my-3">
          <div><dt className="text-xs text-faint">Latest</dt>
               <dd className="font-medium">{fmtUnit(latest.value, statUnit)}</dd></div>
          {prev && <div><dt className="text-xs text-faint">vs previous</dt>
               <dd>{fmtUnit(latest.value - prev.value, statUnit).replace(/^/, latest.value >= prev.value ? '+' : '')}</dd></div>}
          {yearAgo && <div><dt className="text-xs text-faint">vs year ago</dt>
               <dd>{fmtUnit(latest.value - yearAgo.value, statUnit).replace(/^/, latest.value >= yearAgo.value ? '+' : '')}</dd></div>}
          <div><dt className="text-xs text-faint">Period</dt>
               <dd>{fmtPeriod(latest.date, entry?.meta.frequency ?? null)}</dd></div>
        </dl>
      )}
      {lines.length > 0 &&
        <DataTable lines={[...lines, ...cmpLines]} unit={unit} unitByName={unitByName} />}
      <p className="flex flex-wrap items-center gap-2 text-xs text-faint mt-3">
        {entry?.meta.source_url &&
          <a href={entry.meta.source_url} target="_blank" rel="noreferrer"
             className="underline underline-offset-2 hover:text-blue">
            {entry.meta.source_name}</a>}
        {st && (st.kind === 'fresh' ? <span>{st.label}</span>
          : <Chip kind={st.kind === 'ageing' ? 'warn' : 'bad'}>{st.label}</Chip>)}
        {entry && <span>fetched {ago(entry.meta.last_fetched, now)}</span>}
        {entry && nextUpdate(entry, now) && <span>{nextUpdate(entry, now)}</span>}
        {scopeNote && <Chip kind="neutral">{scopeNote}</Chip>}
      </p>
      {chart.note && <p className="text-xs text-faint mt-1">{chart.note}</p>}
      {/* Design review P1-touch: this row's actions were px-3 py-1.5
          (~30px tall) — below the project's 44px mandate. pointer-coarse:
          py-3.5 (28px top+bottom + the 16px text-xs line-height + the 2px
          border = 46px) clears it with margin; fine-pointer sizing is
          untouched. */}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button type="button" onClick={download}
                className="text-xs border border-line rounded-md px-3 py-1.5
                           pointer-coarse:px-4 pointer-coarse:py-3.5 hover:border-blue hover:text-blue">
          Download CSV</button>
        <button type="button" onClick={copy}
                className="text-xs border border-line rounded-md px-3 py-1.5
                           pointer-coarse:px-4 pointer-coarse:py-3.5 hover:border-blue hover:text-blue">
          {copied ? 'Copied ✓' : 'Copy link'}</button>
        {entry?.meta.source_url &&
          <a href={entry.meta.source_url} target="_blank" rel="noreferrer"
             className="text-xs border border-line rounded-md px-3 py-1.5
                        pointer-coarse:px-4 pointer-coarse:py-3.5 hover:border-blue hover:text-blue">
            Source</a>}
        <label className="text-xs text-muted ml-auto">
          Compare{' '}
          <select aria-label="Compare with" value={compare ?? ''}
                  onChange={e => onCompare(e.target.value || null)}
                  className="border border-line rounded-md px-2 py-1
                             pointer-coarse:px-3 pointer-coarse:py-3.5 bg-card">
            <option value="">—</option>
            {site.charts.filter(c => c.id !== chart.id).map(c =>
              <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
        </label>
      </div>
    </dialog>
  )
}
