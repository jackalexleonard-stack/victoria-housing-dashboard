import { Popover } from './Popover'
import { CHIP_STYLES } from './Chip'
import { releasesBehind, nextUpdate, staleness } from '../lib/staleness'
import { fmtDate, fmtPeriod } from '../lib/format'
import type { SeriesEntry } from '../lib/types'

type St = ReturnType<typeof staleness>
type BadKind = 'ageing' | 'stale' | 'failed'

const TITLE: Record<BadKind, string> = {
  ageing: 'Ageing data', stale: 'Stale data', failed: 'Source unavailable',
}
const MEANING: Record<BadKind, string> = {
  ageing: 'The newest figures are older than this series’ usual release rhythm.',
  stale: 'Well past this series’ expected release date.',
  failed: 'The daily updater can’t retrieve this series, and there’s no history to show.',
}

// The popover body — what a tag means, how far behind the data is (computed
// live, spec §1.3), why (curated pipeline status_note, else an honest
// generated fallback), and when new data is expected/was due. Also used by
// the section-level banner (App.tsx).
export function ExplainerPanel({ entry, kind, now }: {
  entry: SeriesEntry; kind: BadKind; now: Date }) {
  const m = entry.meta
  const behind = releasesBehind(entry, now)
  const cause = m.status_note ?? (entry.status === 'failed'
    ? `The source hasn’t responded to the daily updater. Last attempt: ${
        m.last_fetched ? fmtDate(m.last_fetched) : 'unknown'}.`
    : 'The publisher hasn’t released newer figures yet.')
  const next = nextUpdate(entry, now)
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-ink">{TITLE[kind]}</p>
      <p className="text-muted">{MEANING[kind]}</p>
      {m.last_data_date && (
        <p className="text-muted">
          Latest data: {fmtPeriod(m.last_data_date, m.frequency)}
          {m.frequency ? ` · published ${m.frequency}` : ''}
          {behind >= 1 ? ` · ~${behind} release${behind === 1 ? '' : 's'} behind` : ''}
        </p>
      )}
      <p className="text-muted">{cause}</p>
      {next && <p className="text-faint">{next}</p>}
    </div>
  )
}

// Every non-fresh staleness tag in the app renders through this one
// component, so "clickable chip with an explanation" can't drift per
// call-site (spec §1.3). Fresh stays an inert span — nothing to explain.
export function StatusChip({ entry, st, now, quiet }: {
  entry: SeriesEntry | undefined; st: St | null; now: Date; quiet?: boolean }) {
  if (!st) return null
  if (st.kind === 'fresh') return <span>{st.label}</span>
  if (!entry) return null
  const kind = st.kind as BadKind
  const useQuiet = !!quiet && (kind === 'stale' || kind === 'failed')
  const label = useQuiet && entry.meta.last_data_date
    ? `${fmtPeriod(entry.meta.last_data_date, entry.meta.frequency)} · ${
        kind === 'failed' ? 'unavailable' : kind}`
    : st.label
  const s = CHIP_STYLES[useQuiet || kind === 'ageing' ? 'warn' : 'bad']
  return (
    <Popover trigger={label} ariaLabel={`${label} — why?`}
             panelLabel={`${TITLE[kind]} — details`}
             triggerClassName="pointer-coarse:py-2.5 pointer-coarse:px-4"
             triggerStyle={{ background: s.bg, color: s.fg, borderRadius: 999,
                             padding: '2px 10px', fontSize: 12, fontWeight: 500,
                             border: 0, cursor: 'pointer' }}>
      <ExplainerPanel entry={entry} kind={kind} now={now} />
    </Popover>
  )
}
