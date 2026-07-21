import { useRef, useState } from 'react'
import { fmtDate } from '../lib/format'
import { Chip } from './Chip'
import { PALETTE } from '../theme/tokens'

export interface FailedSource { source: string; vintage: string }

// Design review P1-stale: the "N sources unavailable" pill used to be an
// inert span — no title, ARIA, or click handler — so it couldn't answer the
// question it raised. It's now a real keyboard-operable disclosure: a
// button (same warn-tint pill look as the old Chip) that opens a small
// popover enumerating each failed source with its own vintage, in the
// existing chip vocabulary. Esc and focus leaving the whole control both
// close it, matching the rest of the app's dialog/disclosure conventions.
function FailedSourcesDisclosure({ failed }: { failed: FailedSource[] }) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  const close = () => setOpen(false)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }
  const onBlur = (e: React.FocusEvent) => {
    if (!root.current?.contains(e.relatedTarget as Node | null)) close()
  }

  return (
    <div ref={root} className="relative" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button type="button" aria-expanded={open} aria-haspopup="true"
              onClick={() => setOpen(o => !o)}
              style={{ background: PALETTE.chip_warn, color: PALETTE.warn, borderRadius: 999,
                       padding: '2px 10px', fontSize: 12, fontWeight: 500, border: 0,
                       cursor: 'pointer' }}>
        {failed.length} source{failed.length === 1 ? '' : 's'} unavailable
      </button>
      {open && (
        <div role="group" aria-label="Unavailable sources"
             className="absolute right-0 z-30 mt-1 min-w-[240px] rounded-md border border-line
                        bg-card p-3 text-xs shadow-md">
          <ul className="space-y-1.5">
            {failed.map(f => (
              <li key={f.source} className="flex items-center justify-between gap-3">
                <span>{f.source}</span>
                <span className="text-faint whitespace-nowrap">{f.vintage}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
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
