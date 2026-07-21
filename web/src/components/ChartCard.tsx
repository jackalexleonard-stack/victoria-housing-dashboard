import { LineChart } from './LineChart'
import { DataTable } from './DataTable'
import { Chip } from './Chip'
import { chartPoints, lineName } from '../lib/selectors'
import { staleness } from '../lib/staleness'
import { xExtentOf } from '../lib/chartMath'
import type { ChartSpec, SiteData } from '../lib/types'
import type { Geo, Range } from '../lib/urlState'

// Design review P1-emphasis: on a ≥4-line card, the line matching the
// chart's own finding gets the emphasis treatment; everything else
// de-emphasises to grey. The finding's actual analytical "primary" metric
// (pipeline/findings.py's `primary=`) isn't exported to the frontend chart
// spec — only `metrics` (display order) is — so metrics[0] is a correct
// fallback EXCEPT where display order deliberately differs from the
// analytical primary. Currently only median_rent_by_type does (its metrics
// are ordered by bedroom count; the finding is specifically about the
// 3-bed house).
const EMPHASIS_PRIMARY: Record<string, string> = {
  median_rent_by_type: 'rent_3br_house',
}

// Design review P0-4: the per-move annotation "picket fence" is replaced,
// card-side, by either a single pale cycle-band (lending/credit/HVI) or a
// single latest-move label (cash rate) — see LineChart's `annotationMode`.
// The band's meaning is spelled out once here rather than per chart.
const BAND_CAPTION = 'Shaded: cash-rate cycle'

// A band-mode chart with fewer than 2 visible annotations degenerates to a
// ~1px sliver (LineChart's own fix — design review MINOR #3); the caption
// must disappear along with it rather than describing a band that no longer
// renders. "Visible" mirrors LineChart's own pixel/margin check exactly:
// because buildChart's x scale is an UNPADDED linear map of `lines`' own
// date extent onto the plot width, "falls within the margins" and "falls
// within [minDate, maxDate] of `lines`" are the same condition — so
// xExtentOf(lines) (chartMath's single source of truth for that extent)
// decides this without duplicating LineChart's own width/margin internals.
function visibleAnnotationCount(
  annotations: { date: string }[], lines: { pts: { date: string }[] }[],
): number {
  const chartExtent = xExtentOf(lines)
  if (!chartExtent) return 0
  const [t0, t1] = chartExtent
  return annotations.filter(a => {
    const t = Date.parse(`${a.date}T00:00:00Z`)
    return Number.isFinite(t) && t >= t0 && t <= t1
  }).length
}

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
  // Cash rate keeps just the latest-move label (its own step line already
  // shows every move); the other annotated charts (lending, credit, both
  // HVI cards) get one shaded cycle-band instead of a per-move fence.
  const annotationMode: 'band' | 'latest-label' | undefined = !chart.annotate
    ? undefined
    : chart.id === 'cash_rate' ? 'latest-label' : 'band'
  const isMortgage = chart.id === 'mortgage_rates'
  // The mortgage-rates card small-multiples into New vs Outstanding minis
  // (design review P1-emphasis) instead of taking the emphasize treatment,
  // so it's excluded from the general ≥4-line emphasis rule below.
  const emphasize = (!isMortgage && lines.length >= 4)
    ? lineName(EMPHASIS_PRIMARY[chart.id] ?? primaryMetric)
    : undefined
  // mortgage_rates' chart spec has no explicit `metrics` list (the whole
  // series is new+outstanding x fixed+variable), so `lines` already carries
  // all six — split by the lineName prefix ("mortgage new..." vs "mortgage
  // outstanding...") into two ≤3-line, full-colour minis sharing the same
  // x-range (both come from this one already-filtered `lines`).
  const newLines = isMortgage ? lines.filter(l => l.name.startsWith('mortgage new')) : []
  const outstandingLines = isMortgage
    ? lines.filter(l => l.name.startsWith('mortgage outstanding')) : []
  // The minis' "shared x-range" must be STRUCTURAL, not coincidental (design
  // review P1): each mini is built from an independently-filtered subset, so
  // computing the combined extent across BOTH here and handing it down as an
  // explicit xDomain guarantees they align even if the two subsets' own date
  // ranges ever diverge (e.g. one metric reporting late).
  const mortgageXDomain = isMortgage
    ? xExtentOf([...newLines, ...outstandingLines]) ?? undefined : undefined
  const showBandCaption = annotationMode === 'band' &&
    visibleAnnotationCount(annotations, lines) >= 2
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
        ) : isMortgage ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-muted mb-1">New</p>
              <LineChart lines={newLines} percent={chart.percent} unit={unit}
                         markers={chart.markers} unitByName={unitByName}
                         xDomain={mortgageXDomain}
                         label={`${finding} — new lending rates`} height={140} />
            </div>
            <div>
              <p className="text-xs font-medium text-muted mb-1">Outstanding</p>
              <LineChart lines={outstandingLines} percent={chart.percent} unit={unit}
                         markers={chart.markers} unitByName={unitByName}
                         xDomain={mortgageXDomain}
                         label={`${finding} — outstanding lending rates`} height={140} />
            </div>
          </div>
        ) : (
          <LineChart lines={lines} percent={chart.percent} unit={unit}
                     markers={chart.markers} annotations={annotations}
                     annotationMode={annotationMode} emphasize={emphasize}
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
      {showBandCaption && <p className="text-xs text-faint mt-1">{BAND_CAPTION}</p>}
      {chart.note && <p className="text-xs text-faint mt-1">{chart.note}</p>}
    </article>
  )
}
