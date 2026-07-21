import { useRef } from 'react'
import { GEOS, RANGES, type Geo, type Range } from '../lib/urlState'

const GEO_SHORT: Record<Geo, string> = {
  melbourne: 'Melbourne', regional_vic: 'Regional', vic: 'Victoria',
  australia: 'Australia',
}

function Segmented<T extends string>({ options, value, label, format, onPick, touch }: {
  options: readonly T[]; value: T; label: string
  format: (o: T) => string; onPick: (o: T) => void
  // Design review P1-touch: this same component renders both in the
  // always-visible desktop toolbar row (>=640px, any pointer type) and the
  // coarse-pointer-only bottom sheet. Only the sheet instance passes
  // touch — so a wide fine-pointer viewport keeps today's compact size,
  // while a genuinely coarse-pointer device (matched via `pointer: coarse`,
  // not viewport width — the same media feature T4's defaultSectionOpen
  // gates on in lib/sections.ts) gets the full 44px target inside the
  // sheet. text-sm replaces text-xs there too (44 = 12px py-3 top+bottom +
  // 20px text-sm line-height). px-3, not px-4: measured at 393px (Playwright,
  // Pixel-7 emulation) the 4-option Geography group overflowed its 361px
  // available width by ~6px at px-4 (365 scrollWidth vs 359 clientWidth);
  // px-3 brings it to ~333px with room to spare. Date range (5 short
  // options) already fit at ~254px either way. See the T5 report.
  touch?: boolean }) {
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
                className={`px-2.5 py-1 text-xs num
                  ${touch ? 'pointer-coarse:px-3 pointer-coarse:py-3 pointer-coarse:text-sm' : ''}
                  ${o === value
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
  // Design review P1-touch: the toolbar row (desktop-width, any pointer)
  // keeps today's compact Segmented; the bottom sheet — reachable only via
  // the coarse-pointer-gated "Filters" disclosure below — passes touch so
  // its copy gets the full 44px bump. Rendered as a function rather than a
  // shared element so the two call sites can differ.
  const renderControls = (touch: boolean) => (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented options={RANGES} value={range} label="Date range"
                 format={r => r} onPick={r => onFilters({ range: r })} touch={touch} />
      <Segmented options={GEOS} value={geo} label="Geography"
                 format={g => GEO_SHORT[g]} onPick={g => onFilters({ geo: g })} touch={touch} />
    </div>
  )
  // Design review P1-touch: "Filters"/"Done" were bare text links (~16-20px)
  // — below even WCAG 2.2's 24px AA floor. Bordered buttons on coarse
  // pointers only (py-2.5/px-4, a quiet border — never a solid blue fill,
  // per the report's explicit "never solid blue fills"); fine-pointer
  // desktop visuals (the plain text link) are unchanged.
  const touchButton = 'pointer-coarse:border pointer-coarse:border-line ' +
    'pointer-coarse:rounded-md pointer-coarse:px-4 pointer-coarse:py-2.5'
  return (
    <nav className="sticky top-0 z-20 bg-bg/95 backdrop-blur-sm border-b border-line py-2"
         aria-label="Filters and sections">
      <div className="hidden sm:flex flex-wrap items-center gap-3">{renderControls(false)}</div>
      <div className="sm:hidden flex items-center gap-2">
        <span className="text-xs num text-muted">{range} · {GEO_SHORT[geo]}</span>
        <button type="button" className={`text-xs text-blue ml-auto ${touchButton}`}
                onClick={() => sheet.current?.showModal()}>Filters</button>
        <dialog ref={sheet} className="m-0 mt-auto w-full max-w-none rounded-t-xl p-4"
                style={{ maxHeight: '80dvh', paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {renderControls(true)}
          <button type="button" className={`mt-4 text-sm text-blue ${touchButton}`}
                  onClick={() => sheet.current?.close()}>Done</button>
        </dialog>
      </div>
      <div className="flex gap-1 overflow-x-auto mt-2" role="group" aria-label="Jump to section">
        {/* Design review P2-a (narrowed): restyled from a filled/outlined
            pill to an underlined text-tab — pale-tint/outline pills are now
            exclusively status/provenance chips (Chip.tsx, staleness/scope),
            so a control (this scrollspy nav) no longer shares their
            silhouette. Active mirrors the Segmented control's own active
            language (text-blue font-medium) with a bottom border standing
            in for the filled bg-blue/10 pill.
            P1-touch: the sticky bar's own height must not grow (the page's
            problem is too little content per screen, not too much chrome)
            — so the hit area still grows via the classic padding +
            equal-and-opposite negative-margin technique instead of a bigger
            visible tab. The outer <button> is the invisible hit-box: its
            padding extends the clickable/tappable region (padding is part
            of an element's hit-tested box regardless of what a negative
            margin does to surrounding layout) while the negative margin
            cancels that padding's footprint, so the row's rendered height
            still comes from the inner span's visual tab (py-2 on coarse
            pointers, up from py-1), not the 44px+ hit box the button itself
            occupies. */}
        {sections.map(([id, label]) => (
          <button key={id} type="button" onClick={() => onJump(id)}
                  aria-current={id === activeSection ? 'true' : undefined}
                  aria-label={`Jump to ${label}`}
                  className="pointer-coarse:p-1.5 pointer-coarse:-m-1.5">
            <span className={`block px-1 py-1 pointer-coarse:py-2 text-xs whitespace-nowrap border-b-2
                      ${id === activeSection
                        ? 'border-blue text-blue font-medium'
                        : 'border-transparent text-muted hover:text-ink'}`}>
              {label}
            </span>
          </button>
        ))}
      </div>
    </nav>
  )
}
