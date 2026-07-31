import { useLayoutEffect, useRef, useState } from 'react'

// Shared disclosure mechanics, extracted from Masthead's FailedSourcesDisclosure
// (2.3) so the staleness-chip explainers (spec 2026-07-31 §1.3) and the section
// banner reuse ONE implementation: button with aria-expanded/haspopup, Escape
// and focus-leave both close, panel flips right when it would overflow the
// right viewport edge (jsdom rects are all zero, so the flip only ever
// engages in a real browser — covered by e2e, not vitest).
export function Popover({ trigger, ariaLabel, triggerStyle, triggerClassName,
                          panelLabel, align = 'left', children }: {
  trigger: React.ReactNode
  ariaLabel?: string
  triggerStyle?: React.CSSProperties
  triggerClassName?: string
  panelLabel: string
  align?: 'left' | 'right'
  children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const root = useRef<HTMLSpanElement>(null)
  const panel = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open) { setFlip(false); return }
    const r = panel.current?.getBoundingClientRect()
    if (r && r.width > 0 && r.right > window.innerWidth - 8) setFlip(true)
  }, [open])

  const close = () => setOpen(false)
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); close() }
  }
  const onBlur = (e: React.FocusEvent) => {
    if (!root.current?.contains(e.relatedTarget as Node | null)) close()
  }
  const side = flip || align === 'right' ? 'right-0' : 'left-0'

  return (
    <span ref={root} className="relative inline-block" onKeyDown={onKeyDown} onBlur={onBlur}>
      <button type="button" aria-expanded={open} aria-haspopup="true"
              aria-label={ariaLabel}
              onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
              className={triggerClassName} style={triggerStyle}>
        {trigger}
      </button>
      {open && (
        <div ref={panel} role="group" aria-label={panelLabel}
             className={`absolute ${side} z-30 mt-1 min-w-[240px] max-w-[320px]
                         rounded-md border border-line bg-card p-3 text-xs
                         shadow-md text-left font-normal normal-case`}>
          {children}
        </div>
      )}
    </span>
  )
}
