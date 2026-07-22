import { useEffect, useRef, useState } from 'react'

// First-run onboarding gate (spec §2): a native <dialog> opened with
// showModal() — backdrop dimming, background inert, focus containment and
// top-layer stacking are all native. It forces a section choice before the
// dashboard is usable. `onEnter` is the single commit path (App applies the
// ids through setAllSections and marks the modal seen). No entrance
// animation on purpose: an opacity fade is exactly what an axe scan reads as
// a transient contrast failure (see the conveyor deflake), so the modal is
// fully opaque from frame one.
export function WelcomeModal({ sections, onEnter }: {
  sections: [string, string][]
  onEnter: (openIds: string[]) => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  useEffect(() => { dlg.current?.showModal() }, [])
  const toggle = (id: string) => setChecked(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })
  const checkedIds = () => sections.map(([id]) => id).filter(id => checked.has(id))
  return (
    <dialog ref={dlg} aria-labelledby="welcome-title"
            onCancel={e => e.preventDefault()}
            className="rounded-xl border border-line2 bg-card text-ink p-6 w-[min(420px,92vw)] backdrop:bg-black/70">
      <h2 id="welcome-title" className="font-display text-2xl leading-snug">
        Welcome — choose your sections</h2>
      <p className="text-sm text-muted mt-1.5 max-w-[42ch]">
        Pick the housing data you follow. Today always shows; you can change these
        anytime from the <span className="text-blue">Sections</span> control.</p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 mt-4">
        {sections.map(([id, label], i) => (
          <li key={id}>
            <label className="flex items-center gap-2 text-sm py-1 pointer-coarse:py-2.5">
              <input type="checkbox" checked={checked.has(id)} autoFocus={i === 0}
                     onChange={() => toggle(id)} />
              {label}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 mt-5">
        <button type="button" disabled={checked.size === 0}
                onClick={() => onEnter(checkedIds())}
                className="bg-blue text-bg rounded-md px-4 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
          Enter dashboard</button>
        <button type="button" onClick={() => onEnter(sections.map(([id]) => id))}
                className="text-blue border border-line rounded-md px-3 py-2.5 text-sm">
          Show everything</button>
      </div>
    </dialog>
  )
}
