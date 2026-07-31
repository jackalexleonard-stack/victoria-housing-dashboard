import { fmtDate } from '../lib/format'
import { Chip } from './Chip'
import { Popover } from './Popover'
import { PALETTE } from '../theme/tokens'

export interface FailedSource { source: string; vintage: string }

function FailedSourcesDisclosure({ failed }: { failed: FailedSource[] }) {
  return (
    <Popover align="right" panelLabel="Unavailable sources"
             trigger={`${failed.length} source${failed.length === 1 ? '' : 's'} unavailable`}
             triggerStyle={{ background: PALETTE.chip_warn, color: PALETTE.warn,
                             borderRadius: 999, padding: '2px 10px', fontSize: 12,
                             fontWeight: 500, border: 0, cursor: 'pointer' }}>
      <ul className="space-y-1.5">
        {failed.map(f => (
          <li key={f.source} className="flex items-center justify-between gap-3">
            <span>{f.source}</span>
            <span className="text-faint whitespace-nowrap">{f.vintage}</span>
          </li>
        ))}
      </ul>
    </Popover>
  )
}

export function Masthead({ generatedAt, failedSources }: {
  generatedAt: string; failedSources: FailedSource[] }) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-6 pb-4">
      <h1 className="font-display text-3xl">Victorian Housing</h1>
      <span className="text-sm text-muted">a daily briefing</span>
      <span className="text-xs text-faint ml-auto num">
        as at {fmtDate(generatedAt)}</span>
      {failedSources.length > 0
        ? <FailedSourcesDisclosure failed={failedSources} />
        : <Chip kind="good">run ok</Chip>}
    </header>
  )
}
