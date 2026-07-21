import { LineChart } from './LineChart'
import { DataTable } from './DataTable'
import { Chip } from './Chip'
import { chartPoints, lineName } from '../lib/selectors'
import { staleness } from '../lib/staleness'
import type { ChartSpec, SiteData } from '../lib/types'
import type { Geo, Range } from '../lib/urlState'

export function ChartCard({ site, chart, finding, range, geo, now, onOpen }: {
  site: SiteData; chart: ChartSpec; finding: string; range: Range; geo: Geo
  now: Date; onOpen: (id: string) => void }) {
  const entry = site.series[chart.series_id]
  const { lines, scopeNote } = chartPoints(site, chart, range, geo, now)
  // A series can carry mixed units across its metrics (e.g. vic_rents:
  // rent_growth_annual=percent, median_rent=aud) — one scalar unit for the
  // whole chart would misformat whichever metric isn't first. Build a
  // per-line unit map from the chart's own metrics (or, for region-mode
  // charts with no explicit metrics list, every metric the series has)
  // and let LineChart/DataTable key off the line name. The scalar `unit`
  // stays as a fallback for lines that don't match (e.g. region_mode
  // 'all', whose line names are region labels, not metric names) —
  // derived from the chart's primary metric where identifiable.
  const chartMetrics = chart.metrics ?? (entry ? Object.keys(entry.units) : [])
  const unitByName = entry
    ? Object.fromEntries(chartMetrics.map(m => [lineName(m), entry.units[m] ?? '']))
    : undefined
  const primaryMetric = chartMetrics[0]
  const unit = entry ? (entry.units[primaryMetric] ?? Object.values(entry.units)[0] ?? '') : ''
  const st = entry ? staleness(entry, now) : null
  const annotations = chart.annotate
    ? site.annotations.cash_rate_moves.map(m => ({
        date: m.date, label: `${m.delta > 0 ? '+' : ''}${m.delta}` }))
    : []
  const failedEmpty = !lines.length

  return (
    <article className="bg-card border border-line rounded-lg p-4">
      <button type="button" onClick={() => onOpen(chart.id)}
              className="block w-full text-left cursor-pointer group"
              aria-label={`${chart.title} — open details`}>
        <h3 className="font-display text-lg leading-snug mb-2 group-hover:text-blue">
          {finding}
        </h3>
        {failedEmpty ? (
          <p className="text-sm text-muted py-8 text-center">
            No recent data — source currently unavailable
          </p>
        ) : (
          <LineChart lines={lines} percent={chart.percent} unit={unit}
                     markers={chart.markers} annotations={annotations}
                     label={finding} unitByName={unitByName} />
        )}
      </button>
      {!failedEmpty && <DataTable lines={lines} unit={unit} unitByName={unitByName} />}
      <p className="flex flex-wrap items-center gap-2 text-xs text-faint mt-2">
        <span>{chart.title}</span>
        {st && (st.kind === 'fresh'
          ? <span>{st.label}</span>
          : <Chip kind={st.kind === 'ageing' ? 'warn' : 'bad'}>{st.label}</Chip>)}
        {scopeNote && <Chip kind="neutral">{scopeNote}</Chip>}
        {entry?.meta.source_url && (
          <a href={entry.meta.source_url} target="_blank" rel="noreferrer"
             className="hover:text-blue underline-offset-2"
             onClick={e => e.stopPropagation()}>{entry.meta.source_name}</a>
        )}
      </p>
      {chart.note && <p className="text-xs text-faint mt-1">{chart.note}</p>}
    </article>
  )
}
