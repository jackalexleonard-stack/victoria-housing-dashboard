import { useEffect, useMemo, useRef, useState } from 'react'
import { buildChart, nearest, type FlatPt } from '../lib/chartMath'
import { COLORWAY, PALETTE } from '../theme/tokens'
import { fmtDate, fmtUnit } from '../lib/format'
import type { Pt } from '../lib/types'

export interface LineChartProps {
  lines: { name: string; pts: Pt[] }[]
  percent: boolean
  unit: string
  label: string
  markers?: boolean
  annotations?: { date: string; label: string }[]
  interactive?: boolean
  touchScrub?: boolean   // false on cards (tap opens detail); true in DetailView
  height?: number
}

const reduced = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

export function LineChart({ lines, percent, unit, label, markers = false,
                            annotations = [], interactive = true,
                            touchScrub = false, height = 220 }: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [drawn, setDrawn] = useState(reduced())
  const [hover, setHover] = useState<FlatPt | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(e => setWidth(e[0].contentRect.width || 600))
    ro.observe(el)
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) { setDrawn(true); io.disconnect() }
    })
    io.observe(el)
    return () => { ro.disconnect(); io.disconnect() }
  }, [])

  const b = useMemo(() => buildChart(lines, width, height,
    { colorway: COLORWAY, percent }), [lines, width, height, percent])

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return
    if (e.pointerType === 'touch' && !touchScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = b.x.invert(e.clientX - rect.left).getTime()
    setHover(nearest(b.flat, t))
  }

  return (
    <div ref={wrap} style={{ position: 'relative' }}>
      <svg role="img" aria-label={label} width="100%" height={height}
           viewBox={`0 0 ${width} ${height}`}
           style={{ touchAction: 'pan-y', display: 'block' }}
           onPointerMove={onMove} onPointerLeave={() => setHover(null)}
           onPointerCancel={() => setHover(null)}>
        {b.yTicks.map(t => (
          <g key={t.y}>
            <line x1={b.margin.l} x2={width - b.margin.r} y1={t.y} y2={t.y}
                  stroke={PALETTE.line} />
            <text x={b.margin.l - 6} y={t.y + 4} textAnchor="end" fontSize="11"
                  fill={PALETTE.muted} className="num">{t.label}</text>
          </g>
        ))}
        {b.xTicks.map(t => (
          <text key={t.x} x={t.x} y={height - 6} textAnchor="middle" fontSize="11"
                fill={PALETTE.muted} className="num">{t.label}</text>
        ))}
        {annotations.map(a => {
          const ax = b.x(Date.parse(`${a.date}T00:00:00Z`))
          if (!Number.isFinite(ax) || ax < b.margin.l) return null
          return (
            <g key={a.date}>
              <line x1={ax} x2={ax} y1={b.margin.t} y2={height - b.margin.b}
                    stroke={PALETTE.clay} strokeWidth="1" strokeDasharray="2 3" />
              <text x={ax + 3} y={b.margin.t + 9} fontSize="10"
                    fill={PALETTE.clay}>{a.label}</text>
            </g>
          )
        })}
        {b.paths.map(p => (
          <path key={p.name} d={p.d} fill="none" stroke={p.color}
                strokeWidth="2.25" strokeLinejoin="round"
                className={drawn && !reduced() ? 'draw-in' : undefined}
                pathLength={1} />
        ))}
        {/* Paths are ALWAYS visible by default — the draw-in class is additive
            choreography on viewport entry. Never gate visibility on the
            IntersectionObserver: if it doesn't fire (headless, hidden tab),
            the chart must still render. */}
        {b.flat.filter(p => markers ||
            b.flat.filter(q => q.name === p.name).length < 2)
          .map((p, i) => (
            <circle key={i} className="pt-marker" cx={b.x(p.t)} cy={b.y(p.value)}
                    r="3.5" fill={COLORWAY[0]} />
        ))}
        {hover && (
          <g>
            <line x1={b.x(hover.t)} x2={b.x(hover.t)} y1={b.margin.t}
                  y2={height - b.margin.b} stroke={PALETTE.line2} />
            <circle cx={b.x(hover.t)} cy={b.y(hover.value)} r="4"
                    fill={PALETTE.clay} />
          </g>
        )}
      </svg>
      {hover && (
        <div role="status" style={{
          position: 'absolute', pointerEvents: 'none',
          left: Math.min(b.x(hover.t) + 10, width - 150),
          top: Math.max(b.y(hover.value) - 44, 0),
          background: PALETTE.card, border: `1px solid ${PALETTE.line2}`,
          borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
          <div style={{ color: PALETTE.faint }}>{fmtDate(hover.date)}</div>
          <div className="num" style={{ fontWeight: 500 }}>
            {fmtUnit(hover.value, unit)}
            <span style={{ color: PALETTE.muted, fontWeight: 400 }}> {hover.name}</span>
          </div>
        </div>
      )}
    </div>
  )
}
