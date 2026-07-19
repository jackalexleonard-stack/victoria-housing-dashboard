import { useState } from 'react'
import { fmtDate, fmtUnit } from '../lib/format'
import type { Pt } from '../lib/types'

export function DataTable({ lines, unit, unitByName }: {
  lines: { name: string; pts: Pt[] }[]; unit: string; unitByName?: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const dates = open ? [...new Set(lines.flatMap(l => l.pts.map(p => p.date)))].sort() : []
  return (
    <details className="mt-2" onToggle={e => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="text-xs text-muted cursor-pointer">View data table</summary>
      {open && (
        <div className="max-h-64 overflow-auto mt-1">
          <table className="num text-xs w-full">
            <thead><tr>
              <th className="text-left font-medium p-1">Date</th>
              {lines.map(l => <th key={l.name} className="text-right font-medium p-1">{l.name}</th>)}
            </tr></thead>
            <tbody>
              {dates.map(d => (
                <tr key={d}>
                  <td className="p-1">{fmtDate(d)}</td>
                  {lines.map(l => {
                    const p = l.pts.find(p => p.date === d)
                    const u = unitByName?.[l.name] ?? unit
                    return <td key={l.name} className="text-right p-1">
                      {p ? fmtUnit(p.value, u) : '—'}</td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  )
}
