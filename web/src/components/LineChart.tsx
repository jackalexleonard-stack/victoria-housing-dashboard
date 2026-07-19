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
  y2Lines?: string[]   // names plotted against an independent right-hand axis
}

const reduced = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

export function LineChart({ lines, percent, unit, label, markers = false,
                            annotations = [], interactive = true,
                            touchScrub = false, height = 220,
                            y2Lines }: LineChartProps) {
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
    { colorway: COLORWAY, percent, y2Lines }), [lines, width, height, percent, y2Lines])
  const colorByName = new Map(b.paths.map(p => [p.name, p.color]))
  // Points on a y2 line read off the right-hand scale; everything else uses
  // the primary (left) scale. Falls back to `y` whenever no y2 axis exists.
  const yFor = (name: string) => (b.y2 && y2Lines?.includes(name)) ? b.y2 : b.y
  const y2Color = b.paths.find(p => p.axis === 'y2')?.color ?? PALETTE.clay
  const y2Name = b.y2Ticks.length ? y2Lines?.[0] : undefined

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
        {b.y2Ticks.length > 0 && (
          <>
            {/* Thin colour-matched rail anchors the right axis to its line,
                so it reads as "belonging" to that series rather than a
                second independent gridline system. */}
            <line x1={width - b.margin.r} x2={width - b.margin.r}
                  y1={b.margin.t} y2={height - b.margin.b}
                  stroke={y2Color} strokeOpacity={0.4} />
            {b.y2Ticks.map(t => (
              <text key={`y2-${t.y}`} x={width - b.margin.r + 6} y={t.y + 4}
                    textAnchor="start" fontSize="11" fill={y2Color} className="num">
                {t.label}
              </text>
            ))}
            {y2Name && (
              <text x={width - b.margin.r} y={Math.max(b.margin.t - 2, 10)}
                    textAnchor="end" fontSize="10" fontWeight="600" fill={y2Color}>
                {y2Name}
              </text>
            )}
          </>
        )}
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
          .map((p, i) => {
            const onY2 = !!(b.y2 && y2Lines?.includes(p.name))
            const cx = b.x(p.t); const cy = yFor(p.name)(p.value)
            const fill = colorByName.get(p.name) ?? COLORWAY[0]
            // A square marker (vs. the default circle) is the second visual
            // cue — alongside its own colour and axis — that a point belongs
            // to the right-hand (compare) scale, not the primary one.
            return onY2
              ? <rect key={i} className="pt-marker" x={cx - 3} y={cy - 3}
                      width="6" height="6" fill={fill} />
              : <circle key={i} className="pt-marker" cx={cx} cy={cy}
                        r="3.5" fill={fill} />
          })}
        {hover && (
          <g>
            <line x1={b.x(hover.t)} x2={b.x(hover.t)} y1={b.margin.t}
                  y2={height - b.margin.b} stroke={PALETTE.line2} />
            <circle cx={b.x(hover.t)} cy={yFor(hover.name)(hover.value)} r="4"
                    fill={PALETTE.clay} />
          </g>
        )}
      </svg>
      {hover && (
        <div role="status" style={{
          position: 'absolute', pointerEvents: 'none',
          left: Math.min(b.x(hover.t) + 10, width - 150),
          top: Math.max(yFor(hover.name)(hover.value) - 44, 0),
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
