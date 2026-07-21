import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildChart, atTime, placeAnnotationLabels, type FlatPt } from '../lib/chartMath'
import { COLORWAY, PALETTE } from '../theme/tokens'
import { fmtDate, fmtDayMonth, fmtUnit } from '../lib/format'
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
  y2Percent?: boolean  // whether the y2 axis's series is a percent unit
  unitByName?: Record<string, string>   // per-line unit override for the tooltip
}

const reduced = () =>
  typeof matchMedia !== 'undefined' &&
  matchMedia('(prefers-reduced-motion: reduce)').matches

export function LineChart({ lines, percent, unit, label, markers = false,
                            annotations = [], interactive = true,
                            touchScrub = false, height = 220,
                            y2Lines, y2Percent, unitByName }: LineChartProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [drawn, setDrawn] = useState(reduced())
  const [hover, setHover] = useState<{ t: number; points: FlatPt[] } | null>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 })

  // Measure the tooltip's REAL rendered size (its row count varies with the
  // hovered point, so a hard-coded width/height would either clip long
  // names or leave dead space) — runs after every render; cheap (two
  // offset* reads), and the equality guard stops it looping when the size
  // hasn't actually changed.
  useLayoutEffect(() => {
    const el = tipRef.current
    if (!el) return
    const w = el.offsetWidth, h = el.offsetHeight
    setTipSize(prev => (prev.w === w && prev.h === h) ? prev : { w, h })
  })

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
    { colorway: COLORWAY, percent, y2Lines, y2Percent }),
    [lines, width, height, percent, y2Lines, y2Percent])
  const colorByName = new Map(b.paths.map(p => [p.name, p.color]))
  // Points on a y2 line read off the right-hand scale; everything else uses
  // the primary (left) scale. Falls back to `y` whenever no y2 axis exists.
  const yFor = (name: string) => (b.y2 && y2Lines?.includes(name)) ? b.y2 : b.y
  const y2Color = b.paths.find(p => p.axis === 'y2')?.color ?? PALETTE.clay
  const y2Name = b.y2Ticks.length ? y2Lines?.[0] : undefined

  // Annotation lines always render (best-effort labels only) — filter to
  // those actually on the visible plot, then stagger their text between two
  // rows so a dense cluster (e.g. the 2022-23 rate-hike cycle) doesn't pile
  // every label at the same height. `annotationRows[i]` is null when even
  // the second row was too crowded, in which case only the dashed marker
  // line renders for that annotation.
  const visibleAnnotations = annotations
    .map(a => ({ ...a, ax: b.x(Date.parse(`${a.date}T00:00:00Z`)) }))
    .filter(a => Number.isFinite(a.ax) && a.ax >= b.margin.l)
  const annotationRows = placeAnnotationLabels(visibleAnnotations.map(a => a.ax), 36)

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!interactive) return
    if (e.pointerType === 'touch' && !touchScrub) return
    const rect = e.currentTarget.getBoundingClientRect()
    const t = b.x.invert(e.clientX - rect.left).getTime()
    const at = atTime(b.flat, t)
    setHover(at.points.length ? at : null)
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
        {visibleAnnotations.map((a, i) => {
          const row = annotationRows[i]
          return (
            <g key={a.date}>
              <line x1={a.ax} x2={a.ax} y1={b.margin.t} y2={height - b.margin.b}
                    stroke={PALETTE.clay} strokeWidth="1" strokeDasharray="2 3" />
              {row !== null && (
                <text x={a.ax + 3} y={b.margin.t + (row === 0 ? 9 : 21)} fontSize="10"
                      fill={PALETTE.clay}>{a.label}</text>
              )}
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
        {b.flat.filter(p => {
            const onY2 = !!(b.y2 && y2Lines?.includes(p.name))
            // A y2/compare line always gets its distinguishing square marker,
            // regardless of the primary chart's `markers` flag — that flag
            // only governs y1 marker behaviour (explicit opt-in, or the
            // single-point auto-marker fallback).
            if (onY2) return true
            return markers || b.flat.filter(q => q.name === p.name).length < 2
          })
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
            {hover.points.map(p => (
              <circle key={p.name} cx={b.x(p.t)} cy={yFor(p.name)(p.value)} r="4"
                      fill={colorByName.get(p.name) ?? PALETTE.clay} />
            ))}
          </g>
        )}
      </svg>
      {hover && (() => {
        // Side-switch so the tooltip never sits on top of the hovered
        // points: crosshair in the left half of the chart -> tooltip's left
        // edge sits just to its right; right half -> tooltip's right edge
        // sits just to its left (so `left` is derived from the MEASURED
        // width, not a guess). Vertically it anchors near the top of the
        // plot area rather than at the hovered value's y, so it's never
        // over the highlighted dots. Both axes then clamp against the
        // chart's own (measured) box using the tooltip's REAL, measured
        // dimensions — no hard-coded size.
        const crosshairX = b.x(hover.t)
        const leftHalf = crosshairX < width / 2
        const rawLeft = leftHalf ? crosshairX + 14 : crosshairX - 14 - tipSize.w
        const rawTop = b.margin.t + 4
        const left = Math.max(0, Math.min(rawLeft, width - tipSize.w))
        const top = Math.max(0, Math.min(rawTop, height - tipSize.h))
        const headerDate = new Date(hover.t).toISOString().slice(0, 10)
        return (
          <div ref={tipRef} role="status" style={{
            position: 'absolute', pointerEvents: 'none',
            left, top,
            background: PALETTE.card, border: `1px solid ${PALETTE.line2}`,
            borderRadius: 6, padding: '4px 8px', fontSize: 12 }}>
            <div style={{ color: PALETTE.faint }}>{fmtDate(headerDate)}</div>
            {hover.points.map(p => (
              <div key={p.name} style={{ display: 'flex', alignItems: 'center',
                                          gap: 4, whiteSpace: 'nowrap' }}>
                <span style={{ display: 'inline-block', width: 8, height: 8,
                               borderRadius: 2, background: colorByName.get(p.name),
                               flex: '0 0 auto' }} />
                <span style={{ color: PALETTE.muted }}>{p.name}</span>
                <span className="num" style={{ fontWeight: 500 }}>
                  {fmtUnit(p.value, unitByName?.[p.name] ?? unit)}
                </span>
                {p.date !== headerDate && (
                  // Honest per-row date (X5): this row's nearest point is a
                  // tolerance match, not an exact one — say so rather than
                  // implying it happened on the header's date.
                  <span style={{ color: PALETTE.faint, fontSize: 10 }}>
                    · {fmtDayMonth(p.date)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )
      })()}
      {lines.length > 1 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted mt-1">
          {lines.map(l => (
            <span key={l.name} className="inline-flex items-center gap-1">
              <span style={{ display: 'inline-block', width: 8, height: 8,
                             borderRadius: 2, background: colorByName.get(l.name) }} />
              {l.name}{y2Lines?.includes(l.name) ? ' (right axis)' : ''}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
