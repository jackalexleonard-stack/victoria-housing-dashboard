import { fmtDate } from '../lib/format'
import { Chip } from './Chip'

export function Masthead({ generatedAt, failedCount }: {
  generatedAt: string; failedCount: number }) {
  return (
    <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pt-6 pb-4">
      <h1 className="font-display text-3xl">Victorian Housing</h1>
      <span className="text-sm text-muted">a daily briefing</span>
      <span className="text-xs text-faint ml-auto num">
        as at {fmtDate(generatedAt)}</span>
      {failedCount > 0
        ? <Chip kind="warn">{failedCount} sources unavailable</Chip>
        : <Chip kind="good">run ok</Chip>}
    </header>
  )
}
