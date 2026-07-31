import { LineChart } from './LineChart'
import { DataTable } from './DataTable'
import { Chip } from './Chip'
import { StatusChip } from './StatusChip'
import { lineName, useChartData } from '../lib/selectors'
import { fmtUnit, shortSource } from '../lib/format'
import { xExtentOf } from '../lib/chartMath'
import { isDeadChart } from '../lib/geoBands'
import type { ChartSpec, SiteData } from '../lib/types'
import type { Geo, Range } from '../lib/urlState'

// Design review P1-emphasis / D1(c): the finding's actual analytical
// "primary" metric (pipeline/findings.py's `primary=`) isn't exported to the
// frontend chart spec — only `metrics` (display order, or for a chart with
// no explicit `metrics` list, the series' own units-object key order) is —
// so metrics[0] is a correct fallback EXCEPT where display order
// deliberately differs from the analytical primary. Two things key off this
// map: (1) on a ≥4-line card, the line matching the chart's own finding gets
// the emphasis treatment (everything else de-emphasises to grey) —
// median_rent_by_type's metrics are ordered by bedroom count, but the
// finding is specifically about the 3-bed house; (2) a stat-tile chart's
// (D1c below) headline numeral shows THIS metric's latest value —
// vic_land's units-object keys sort alphabetically (lot_supply, lots_titled,
// years_of_supply), so metrics[0] would show the wrong figure without this
// override.
const FINDING_PRIMARY_METRIC: Record<string, string> = {
  median_rent_by_type: 'rent_3br_house',
  land: 'greenfield_years_of_supply',
}

// Design review P1-outage: a dead card (status failed, zero points) used to
// repeat one generic sentence three times over (serif headline, body
// placeholder, red chip) — the headline now carries the series name instead
// (see the `failedEmpty` branch below), so the body only needs to add ONE
// honest, source-specific line. Task 5: that line now comes from the
// pipeline's own curated `meta.status_note` (export.py's STATUS_NOTES —
// character-for-character, so the frontend never re-authors cause copy) with
// this as the honest, non-presumptuous fallback for a source the pipeline
// hasn't curated a note for (no promised fix date — the pipeline doesn't
// record a first-failure date yet).
const DEFAULT_DEAD_BODY = 'This source isn’t returning data right now; the card will populate once it does.'

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

export function ChartCard({ site, chart, finding, range, geo, now, onOpen, quietOutage,
                            scopeBadge }: {
  site: SiteData; chart: ChartSpec; finding: string; range: Range; geo: Geo
  now: Date; onOpen: (id: string) => void
  // Design review P1-outage: set when this card's section has a hoisted,
  // section-level shared-outage notice (see sectionOutageNotice) — the
  // card's own chip then drops to the quieter "{period} · unavailable"
  // form instead of repeating the full staleness sentence.
  quietOutage?: boolean
  // T4: set by App's "Wider context" band — the chart's real scope
  // ('Victoria-wide'/'Australia'/'Global'), so a context card is never
  // mistaken for the selected geography.
  scopeBadge?: string }) {
  const { entry, lines, scopeNote, unitByName, primaryMetric, unit, st } =
    useChartData(site, chart, range, geo, now)
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
  const findingPrimaryMetric = FINDING_PRIMARY_METRIC[chart.id] ?? primaryMetric
  const emphasize = (!isMortgage && lines.length >= 4)
    ? lineName(findingPrimaryMetric, site.metric_labels)
    : undefined
  // mortgage_rates' chart spec has no explicit `metrics` list (the whole
  // series is new+outstanding x fixed+variable), so `lines` already carries
  // all six — split into two ≤3-line, full-colour minis sharing the same
  // x-range (both come from this one already-filtered `lines`). Split by the
  // underlying METRIC KEY (mortgage_new_* vs mortgage_outstanding_*), not by
  // matching a prefix against the display name: site.metric_labels (design
  // review P1-labels) can remap "mortgage_new_variable" to "New — variable",
  // which no longer starts with "mortgage new" as a string.
  const mortgageMetrics = isMortgage && entry ? Object.keys(entry.units) : []
  const newLineNames = new Set(mortgageMetrics
    .filter(m => m.startsWith('mortgage_new')).map(m => lineName(m, site.metric_labels)))
  const outstandingLineNames = new Set(mortgageMetrics
    .filter(m => m.startsWith('mortgage_outstanding')).map(m => lineName(m, site.metric_labels)))
  const newLines = isMortgage ? lines.filter(l => newLineNames.has(l.name)) : []
  const outstandingLines = isMortgage ? lines.filter(l => outstandingLineNames.has(l.name)) : []
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
  // D1(c) re-verification: vic_land carries exactly one point per metric —
  // every path degenerates to a zero-length `moveto`+`closepath` (blank
  // plot), and mixed-scale metrics (lots in the hundred-thousands vs. years
  // in the teens) would badly mis-share one axis even if it did render. The
  // gate is data-driven (every LINE has <2 points), not keyed on chart.id —
  // it auto-reverts to the normal LineChart the moment any line accrues a
  // second point. A chart with only SOME short lines (mixed cadence) does
  // NOT qualify — LineChart's own auto-marker fallback (a visible circle on
  // any line with <2 points) already handles that case at the normal chart
  // size, unchanged.
  const isStatTile = !failedEmpty && !isMortgage && lines.every(l => l.pts.length < 2)
  const statLine = isStatTile
    ? (lines.find(l => l.name === lineName(findingPrimaryMetric, site.metric_labels)) ?? lines[0])
    : undefined
  const statValue = statLine?.pts.at(-1)?.value
  const statUnit = entry?.units[findingPrimaryMetric] ?? unit

  // Design review P1-outage: a dead card's headline slot names the SERIES
  // (chart.title), not the generic finding sentence — showing "No recent
  // data — source currently unavailable" as if it were a computed finding
  // reads as a fake result, and repeating it again in the body/chip is the
  // "triple-repeat" the review calls out.
  const headline = failedEmpty ? chart.title : finding
  // Task 5: the dead/empty body line is the pipeline's own curated cause
  // (meta.status_note, export.py's STATUS_NOTES), falling back to the
  // honest generic line only when the pipeline hasn't curated one for this
  // source. Computed once and reused by both the compact outage row and the
  // full-size card's `failedEmpty` paragraph below.
  const deadBody = entry?.meta.status_note ?? DEFAULT_DEAD_BODY
  // Design review d2: prefer the chart's own per-series source override
  // (the three FRED world charts) over the series' one shared
  // meta.source_name — shortSource() collapses either to the same "FRED"
  // token here, so this only changes behaviour where a chart's own name
  // actually differs (the modal, see DetailView.tsx).
  const sourceToken = entry?.meta.source_url && (
    <a href={entry.meta.source_url} target="_blank" rel="noreferrer"
       className="hover:text-blue underline-offset-2"
       onClick={e => e.stopPropagation()}>
      {shortSource(chart.source_name ?? entry.meta.source_name)}</a>
  )
  // Task 5: every non-fresh staleness tag renders through the shared
  // StatusChip (spec §1.3) — clickable, with a popover explainer — instead
  // of ChartCard hand-rolling its own Chip/label logic per render site.
  const statusChip = <StatusChip entry={entry} st={st} now={now} quiet={quietOutage} />

  // 2026-07-24 banner batch (Task 3, design review "unavailable-source cards
  // should be much smaller"): a genuinely dead chart — isDeadChart, NOT bare
  // isBrokenSource/lines.length — renders as one compact row instead of a
  // full-height card, so an outage never wastes a full card of page space.
  // NOT keyed on lines.length: a healthy chart merely empty at the current
  // RANGE keeps the existing full-size `failedEmpty` treatment below
  // unchanged. NOT keyed on bare isBrokenSource either: see isDeadChart's own
  // comment (geoBands.ts) — a source whose fetch failed today but that still
  // carries real historical data for a geo it's known to cover keeps its
  // full chart. A single <button>, matching the same idiom the compact World
  // KPI tiles use (HeroTiles' Tile) rather than the two-layer article+button
  // the full-size card uses below — the row IS the whole clickable surface,
  // reachable/activatable by keyboard exactly like every other card.
  if (isDeadChart(chart, entry)) {
    return (
      <div data-testid="outage-row"
           className="w-full bg-card border border-line rounded-lg px-4 py-2.5
                      flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="button" onClick={() => onOpen(chart.id)}
                aria-label={`${chart.title} — open details`}
                className="text-left cursor-pointer group flex-1 min-w-[12rem]">
          <span className="font-medium text-sm group-hover:text-blue">{chart.title}</span>{' '}
          <span className="text-xs text-faint">{deadBody}</span>
        </button>
        {statusChip}
      </div>
    )
  }

  return (
    <article className="bg-card border border-line rounded-lg p-4">
      <button type="button" onClick={() => onOpen(chart.id)}
              className="block w-full text-left cursor-pointer group"
              aria-label={`${chart.title} — open details`}>
        <h3 className="font-display text-lg leading-snug mb-2 group-hover:text-blue">
          {headline}
        </h3>
        {failedEmpty ? (
          <p className="text-sm text-muted py-6 text-center">
            {deadBody}
          </p>
        ) : isStatTile ? (
          // No <svg>, short fixed height — a plotted line would be zero-length
          // ink here anyway (every line has under 2 points). The headline
          // above already carries the finding sentence; this body's only job
          // is the primary metric's own latest figure, large.
          <div className="h-24 flex items-center justify-center">
            <p className="num text-4xl font-semibold text-ink">
              {statValue != null ? fmtUnit(statValue, statUnit) : '—'}
            </p>
          </div>
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
      {/* Design review P1-metadata: ONE caption line — series name · short
          source token · status chip · table toggle — replaces the old
          up-to-4-row stack (separate caption/chip/source lines plus the
          table-toggle's own row). A <div>, not a <p>: DataTable's <details>
          is flow content, which an actual <p> can't contain (the browser
          would silently close the paragraph early and break the row). The
          methodology note and the full source title move to the modal only
          (added there — see DetailView.tsx). Dead cards skip the repeated
          title (already the headline above) and have no table to toggle. */}
      {!failedEmpty ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-faint mt-2">
          <span>{chart.title}</span>
          {sourceToken}
          {statusChip}
          {scopeBadge && <Chip kind="neutral">{scopeBadge}</Chip>}
          {scopeNote && <Chip kind="neutral">{scopeNote}</Chip>}
          <DataTable lines={lines} unit={unit} unitByName={unitByName} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-xs text-faint mt-2">
          {sourceToken}
          {statusChip}
          {scopeBadge && <Chip kind="neutral">{scopeBadge}</Chip>}
        </div>
      )}
      {showBandCaption && <p className="text-xs text-faint mt-1">{BAND_CAPTION}</p>}
    </article>
  )
}
