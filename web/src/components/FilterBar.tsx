import { useRef } from 'react'
import { GEOS, RANGES, type Geo, type Range } from '../lib/urlState'

const GEO_SHORT: Record<Geo, string> = {
  melbourne: 'Melbourne', regional_vic: 'Regional', vic: 'Victoria',
  australia: 'Australia',
}

function Segmented<T extends string>({ options, value, label, format, onPick }: {
  options: readonly T[]; value: T; label: string
  format: (o: T) => string; onPick: (o: T) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = options.indexOf(value)
    let next: number | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % options.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + options.length) % options.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = options.length - 1
    if (next === null) return
    e.preventDefault()
    onPick(options[next])
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus()
  }
  return (
    <div ref={ref} role="radiogroup" aria-label={label} onKeyDown={onKeyDown}
         className="inline-flex rounded-md border border-line overflow-hidden">
      {options.map(o => (
        <button key={o} role="radio" aria-checked={o === value} type="button"
                tabIndex={o === value ? 0 : -1}
                onClick={() => onPick(o)}
                className={`px-2.5 py-1 text-xs num ${o === value
                  ? 'bg-blue/10 text-blue font-medium' : 'text-muted hover:text-ink'}`}>
          {format(o)}
        </button>
      ))}
    </div>
  )
}

export function FilterBar({ range, geo, sections, activeSection, onFilters, onJump }: {
  range: Range; geo: Geo; sections: [string, string][]; activeSection: string
  onFilters: (p: { range?: Range; geo?: Geo }) => void
  onJump: (id: string) => void }) {
  const sheet = useRef<HTMLDialogElement>(null)
  const controls = (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented options={RANGES} value={range} label="Date range"
                 format={r => r} onPick={r => onFilters({ range: r })} />
      <Segmented options={GEOS} value={geo} label="Geography"
                 format={g => GEO_SHORT[g]} onPick={g => onFilters({ geo: g })} />
    </div>
  )
  return (
    <nav className="sticky top-0 z-20 bg-bg/95 backdrop-blur-sm border-b border-line py-2"
         aria-label="Filters and sections">
      <div className="hidden sm:flex flex-wrap items-center gap-3">{controls}</div>
      <div className="sm:hidden flex items-center gap-2">
        <span className="text-xs num text-muted">{range} · {GEO_SHORT[geo]}</span>
        <button type="button" className="text-xs text-blue ml-auto"
                onClick={() => sheet.current?.showModal()}>Filters</button>
        <dialog ref={sheet} className="m-0 mt-auto w-full max-w-none rounded-t-xl p-4"
                style={{ maxHeight: '80dvh', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {controls}
          <button type="button" className="mt-4 text-sm text-blue"
                  onClick={() => sheet.current?.close()}>Done</button>
        </dialog>
      </div>
      <div className="flex gap-1 overflow-x-auto mt-2" role="group" aria-label="Jump to section">
        {sections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onJump(id)}
                  aria-current={id === activeSection ? 'true' : undefined}
                  className={`px-3 py-1 text-xs whitespace-nowrap rounded-full border
                    ${id === activeSection
                      ? 'border-blue text-blue font-medium'
                      : 'border-line text-muted hover:text-ink'}`}>
            {label}
          </button>
        ))}
      </div>
    </nav>
  )
}
