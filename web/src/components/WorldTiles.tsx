import { Tile } from './HeroTiles'
import { Chip } from './Chip'
import { chartPoints } from '../lib/selectors'
import { staleness } from '../lib/staleness'
import { fmtUnit } from '../lib/format'
import { DEFAULT_GEO } from '../lib/urlState'
import { PALETTE } from '../theme/tokens'
import type { ChartSpec, SiteData } from '../lib/types'

// Design review P1-World / D1(f): the World section is six largely
// unrelated context series (a bond yield, an FX pair, three commodities) —
// six full-height single-series LineChart cards cost far more vertical
// space than an expanded glance needs, and every series' full history/
// provenance stays one tap away via the SAME detail modal used everywhere
// else (onOpen === App's openDetail, unchanged). Shares HeroTiles' `Tile`
// shell rather than forking a near-copy of it; unlike the hero/whats-new
// tiles (pre-scored and pre-formatted server-side via TILE_FMT), these six
// series have no hero-registry entry, so value/delta are derived here
// directly from the series' own points — the same latest-vs-previous
// derivation DetailView's stat block uses (`fmtUnit(latest - prev, unit)`
// with the sign moved outside the `$`/unit), just for each chart's one line.
//
// Delta colour is deliberately 'off' (muted) for every tile, not the
// up/down judgement HeroTiles/whats-new make elsewhere: a rise in Brent or
// iron ore isn't unambiguously good or bad news on a HOUSING dashboard
// (higher input costs vs. stronger export income are both defensible
// readings), and AUD/USD or the US 10-year don't have a housing-relevant
// "good" direction at all. Asserting green/red on six series this dashboard
// doesn't editorialise about would be a call this task declined to make —
// disclosed here and in the D1 report, not decided per-series.
const WORLD_TILE_COLOR = PALETTE.muted

export function WorldTiles({ site, charts, now, onOpen }: {
  site: SiteData; charts: ChartSpec[]; now: Date; onOpen: (chartId: string) => void }) {
  return (
    <>
      {site.section_summaries?.world && (
        <p className="font-display text-lg mb-3">{site.section_summaries.world}</p>
      )}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {charts.map(c => {
          const entry = site.series[c.series_id]
          const metric = c.metrics?.[0] ?? (entry ? Object.keys(entry.units)[0] : undefined)
          // Range 'all' deliberately ignores the page's own range filter — a
          // KPI tile's "latest value" shouldn't shrink just because a user
          // zoomed some OTHER chart's history; geo is irrelevant for these
          // fixed:global charts (chartPoints only consults it in 'geo' mode).
          const { lines } = chartPoints(site, c, 'all', DEFAULT_GEO, now)
          const pts = lines[0]?.pts ?? []
          const latest = pts.at(-1)
          const prev = pts.at(-2)
          const unit = entry && metric ? (entry.units[metric] ?? '') : ''
          const valueText = latest ? fmtUnit(latest.value, unit) : '—'
          const deltaText = latest && prev
            ? fmtUnit(latest.value - prev.value, unit)
                .replace(/^/, latest.value >= prev.value ? '+' : '')
            : null
          const st = entry ? staleness(entry, now) : null
          const chip = st && (st.kind === 'fresh'
            ? <span className="text-[11px] text-faint">{st.label}</span>
            : <Chip kind={st.kind === 'ageing' ? 'warn' : 'bad'}>{st.label}</Chip>)
          return (
            <Tile key={c.id} label={c.title} valueText={valueText} deltaText={deltaText}
                  color={WORLD_TILE_COLOR} chip={chip} hasValue={!!latest}
                  chartId={c.id} onOpen={onOpen} />
          )
        })}
      </div>
    </>
  )
}
