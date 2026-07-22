import { useRef } from 'react'

// The compact "customize" surface (spec §4): a native <dialog> (built-in
// Esc + focus containment) listing every themed section as a checkbox.
// Checked simply MEANS open — the unified state model, so this control,
// the heading toggles and the ?sections= URL param are three surfaces
// over one state. Today is pinned: it is not in `sections` at all.
export function SectionsControl({ sections, isOpen, onSetAll, onReset }: {
  sections: [string, string][]
  isOpen: (id: string) => boolean
  onSetAll: (openIds: string[]) => void
  onReset: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null)
  const openIds = sections.map(([id]) => id).filter(isOpen)
  return (
    <>
      <button type="button" aria-haspopup="dialog"
              onClick={() => dlg.current?.showModal()}
              className="text-xs text-blue flex items-center gap-1 pointer-coarse:border pointer-coarse:border-line pointer-coarse:rounded-md pointer-coarse:px-3 pointer-coarse:py-2.5">
        <span aria-hidden="true" className="material-symbols-rounded text-base">tune</span>
        Sections
      </button>
      <dialog ref={dlg} aria-label="Choose sections"
              className="rounded-lg border border-line bg-card text-ink p-4 w-72 max-w-[90vw] backdrop:bg-black/50">
        <p className="text-sm font-medium mb-2">Show sections</p>
        <ul className="space-y-1">
          {sections.map(([id, label]) => (
            <li key={id}>
              <label className="flex items-center gap-2 text-sm py-1 pointer-coarse:py-2.5">
                <input type="checkbox" checked={isOpen(id)}
                       onChange={e => onSetAll(e.target.checked
                         ? [...openIds, id] : openIds.filter(x => x !== id))} />
                {label}
              </label>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-3 mt-3 text-xs">
          <button type="button" className="text-blue"
                  onClick={() => onSetAll(sections.map(([id]) => id))}>Open all</button>
          <button type="button" className="text-blue" onClick={onReset}>Reset</button>
          <button type="button" className="text-blue ml-auto"
                  onClick={() => dlg.current?.close()}>Done</button>
        </div>
      </dialog>
    </>
  )
}
