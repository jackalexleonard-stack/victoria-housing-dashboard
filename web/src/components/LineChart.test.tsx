import { render, screen, fireEvent, within } from '@testing-library/react'
import { LineChart } from './LineChart'
import { PALETTE } from '../theme/tokens'

const lines = [{ name: 'cash rate', pts: [
  { date: '2026-05-31', region: 'australia', metric: 'cash_rate', value: 3.85 },
  { date: '2026-06-30', region: 'australia', metric: 'cash_rate', value: 3.85 },
] }]

beforeAll(() => {
  // jsdom has no IntersectionObserver or SVG layout
  vi.stubGlobal('IntersectionObserver', class {
    observe() {} disconnect() {} unobserve() {}
  })
  // jsdom also lacks ResizeObserver, which the component constructs in its
  // layout-measuring effect
  vi.stubGlobal('ResizeObserver', class {
    observe() {} disconnect() {} unobserve() {}
  })
})

test('renders an accessible image with the finding as its label', () => {
  render(<LineChart lines={lines} percent unit="percent"
                    label="The cash rate has held at 3.85% since Jan 2026" />)
  const fig = screen.getByRole('img')
  expect(fig).toHaveAccessibleName(/held at 3.85%/)
})

test('single-point lines render a visible marker circle', () => {
  const single = [{ name: 'rent', pts: [lines[0].pts[0]] }]
  const { container } = render(
    <LineChart lines={single} percent={false} unit="aud" label="median rent" />)
  expect(container.querySelectorAll('circle.pt-marker').length).toBe(1)
})

test('chart surface cedes vertical panning', () => {
  const { container } = render(
    <LineChart lines={lines} percent unit="percent" label="x" />)
  expect((container.querySelector('svg') as SVGElement).style.touchAction).toBe('pan-y')
})

test('markers on a multi-line chart use their own line’s color', () => {
  const twoLines = [
    { name: 'a', pts: [
      { date: '2026-05-31', region: 'x', metric: 'a', value: 10 },
      { date: '2026-06-30', region: 'x', metric: 'a', value: 12 },
    ] },
    { name: 'b', pts: [
      { date: '2026-06-30', region: 'x', metric: 'b', value: 99 },
    ] },
  ]
  const { container } = render(
    <LineChart lines={twoLines} percent={false} unit="index" label="two lines" />)
  const markers = container.querySelectorAll('circle.pt-marker')
  expect(markers.length).toBe(1)                        // only line b is single-point
  expect(markers[0].getAttribute('fill')).toBe('#BC5215')  // line b = colorway[1], not [0]
})

const sharedDateLines = [
  { name: 'a', pts: [
    { date: '2026-01-31', region: 'x', metric: 'a', value: 10 },
    { date: '2026-06-30', region: 'x', metric: 'a', value: 12 },
  ] },
  { name: 'b', pts: [
    { date: '2026-01-31', region: 'x', metric: 'b', value: 99 },
    { date: '2026-06-30', region: 'x', metric: 'b', value: 101 },
  ] },
]

test('hovering shows an x-unified tooltip listing every line at the hovered date', () => {
  const { container } = render(
    <LineChart lines={sharedDateLines} percent={false} unit="index" label="two lines" />)
  const svg = container.querySelector('svg') as SVGSVGElement
  // clientX near the left margin lands on/near the leftmost shared date
  // (2026-01-31), where both lines have a point.
  fireEvent.pointerMove(svg, { clientX: 50, clientY: 100, pointerId: 1 })
  const tooltip = screen.getByRole('status')
  expect(tooltip).toHaveTextContent('a')
  expect(tooltip).toHaveTextContent('b')
  expect(tooltip).toHaveTextContent('10')
  expect(tooltip).toHaveTextContent('99')
})

test('no legend for a single-line chart', () => {
  render(<LineChart lines={lines} percent unit="percent" label="one line" />)
  expect(screen.queryByText('cash rate')).not.toBeInTheDocument()
})

test('legend lists every line name for a multi-line chart', () => {
  render(<LineChart lines={sharedDateLines} percent={false} unit="index" label="two lines" />)
  expect(screen.getByText('a')).toBeInTheDocument()
  expect(screen.getByText('b')).toBeInTheDocument()
})

test('a y2 line is labelled "(right axis)" in the legend', () => {
  render(<LineChart lines={sharedDateLines} percent={false} unit="index" label="two lines"
                    y2Lines={['b']} />)
  expect(screen.getByText('a')).toBeInTheDocument()
  expect(screen.getByText(/^b \(right axis\)$/)).toBeInTheDocument()
})

// A wide date domain (two years) with annotations only days apart maps to
// pixel gaps well under the 36px min-gap — reproduces the 2022-23 cash-rate
// cycle pile-up. Shared by the 'full'-mode tests below.
const wideLines = [{ name: 'cash rate', pts: [
  { date: '2022-01-01', region: 'australia', metric: 'cash_rate', value: 0.1 },
  { date: '2023-12-31', region: 'australia', metric: 'cash_rate', value: 4.35 },
] }]
const denseAnnotations = [
  { date: '2022-06-01', label: '+0.25' },
  { date: '2022-06-06', label: '-0.25' },
  { date: '2022-06-11', label: '+0.25' },
  { date: '2022-06-16', label: '-0.25' },
  { date: '2022-06-21', label: '+0.25' },
  { date: '2022-06-26', label: '-0.25' },
]

// Deliberate behaviour change (design review P0-4): the per-move markers
// are no longer a dashed picket fence — they're thin SOLID clay lines, and
// this ('full') is the detail-modal-only mode now that ChartCard has
// 'band'/'latest-label' for card-level annotated charts. Stagger/yield
// behaviour (placeAnnotationLabels) is otherwise unchanged.
test('dense annotations in \'full\' mode render every SOLID marker line but stagger/skip crowded text labels', () => {
  const { container } = render(
    <LineChart lines={wideLines} percent unit="percent" label="cash rate"
               annotations={denseAnnotations} annotationMode="full" />)
  expect(container.querySelectorAll('line[stroke-dasharray]').length).toBe(0)  // no dashes
  const clayLines = [...container.querySelectorAll('line')]
    .filter(l => l.getAttribute('stroke') === PALETTE.clay)
  expect(clayLines.length).toBe(6)   // lines always render, now solid
  const labelTexts = container.querySelectorAll(`text[fill="${PALETTE.clay}"]`)
  expect(labelTexts.length).toBeLessThan(6)   // some text labels yield
})

test("'full' mode annotation labels render at >=12px (legible in the detail modal)", () => {
  const { container } = render(
    <LineChart lines={wideLines} percent unit="percent" label="cash rate"
               annotations={[{ date: '2022-06-01', label: '+0.25' }]} annotationMode="full" />)
  const label = [...container.querySelectorAll(`text[fill="${PALETTE.clay}"]`)][0]
  expect(Number(label.getAttribute('font-size'))).toBeGreaterThanOrEqual(12)
})

test("annotationMode 'band' renders one shaded rect spanning earliest to latest date, no per-move lines or labels", () => {
  const { container } = render(
    <LineChart lines={wideLines} percent unit="percent" label="cash rate"
               annotations={denseAnnotations} annotationMode="band" />)
  expect(container.querySelectorAll('rect').length).toBe(1)
  expect(container.querySelectorAll('line[stroke-dasharray]').length).toBe(0)
  const clayLines = [...container.querySelectorAll('line')]
    .filter(l => l.getAttribute('stroke') === PALETTE.clay)
  expect(clayLines.length).toBe(0)          // no per-move lines
  expect(container.querySelectorAll(`text[fill="${PALETTE.clay}"]`).length).toBe(0)
})

test("annotationMode 'latest-label' drops the fence entirely and shows exactly one label, on the LAST annotation", () => {
  const twoMoves = [
    { date: '2022-02-01', label: '+0.25' },
    { date: '2022-06-01', label: '-0.25' },
  ]
  const { container } = render(
    <LineChart lines={wideLines} percent unit="percent" label="cash rate"
               annotations={twoMoves} annotationMode="latest-label" />)
  expect(container.querySelectorAll('rect').length).toBe(0)
  const clayTexts = [...container.querySelectorAll(`text[fill="${PALETTE.clay}"]`)]
  expect(clayTexts.length).toBe(1)
  expect(clayTexts[0].textContent).toContain('-0.25')       // the LAST move
  expect(clayTexts[0].textContent).not.toContain('+0.25')   // not the first
})

test('tooltip still works on a band-mode chart', () => {
  const { container } = render(
    <LineChart lines={sharedDateLines} percent={false} unit="index" label="two lines"
               annotations={denseAnnotations} annotationMode="band" />)
  const svg = container.querySelector('svg') as SVGSVGElement
  fireEvent.pointerMove(svg, { clientX: 50, clientY: 100, pointerId: 1 })
  const tooltip = screen.getByRole('status')
  expect(tooltip).toHaveTextContent('a')
  expect(tooltip).toHaveTextContent('b')
})

test('emphasize: the named line keeps its colorway hue and width; every other line renders de-emphasis grey at reduced width', () => {
  const threeLines = [
    { name: 'a', pts: [
      { date: '2026-01-31', region: 'x', metric: 'a', value: 1 },
      { date: '2026-02-28', region: 'x', metric: 'a', value: 2 } ] },
    { name: 'b', pts: [
      { date: '2026-01-31', region: 'x', metric: 'b', value: 10 },
      { date: '2026-02-28', region: 'x', metric: 'b', value: 20 } ] },
    { name: 'c', pts: [
      { date: '2026-01-31', region: 'x', metric: 'c', value: 100 },
      { date: '2026-02-28', region: 'x', metric: 'c', value: 200 } ] },
  ]
  const { container } = render(
    <LineChart lines={threeLines} percent={false} unit="index" label="three lines"
               emphasize="b" />)
  const paths = [...container.querySelectorAll('path')]
  const byColor = (c: string) => paths.filter(p => p.getAttribute('stroke') === c)
  expect(byColor(PALETTE.deemphasis).length).toBe(2)          // a and c
  expect(byColor('#BC5215').length).toBe(1)                   // b keeps colorway[1]
  const emphPath = byColor('#BC5215')[0]
  expect(emphPath.getAttribute('stroke-width')).toBe('2.25')
  const deemphPath = byColor(PALETTE.deemphasis)[0]
  expect(deemphPath.getAttribute('stroke-width')).toBe('1.25')
})

test('emphasize: the emphasized line sorts first in the legend', () => {
  const twoLines = [
    { name: 'a', pts: [{ date: '2026-01-31', region: 'x', metric: 'a', value: 1 }] },
    { name: 'b', pts: [{ date: '2026-01-31', region: 'x', metric: 'b', value: 2 }] },
  ]
  render(<LineChart lines={twoLines} percent={false} unit="index" label="two"
                    emphasize="b" />)
  const legendText = screen.getByText('a').parentElement!.textContent
  expect(legendText!.indexOf('b')).toBeLessThan(legendText!.indexOf('a'))
})

test('X3: tooltip side-switches — right of a left-half crosshair, left of a right-half one', () => {
  const { container } = render(
    <LineChart lines={sharedDateLines} percent={false} unit="index" label="two lines" />)
  const svg = container.querySelector('svg') as SVGSVGElement
  // sharedDateLines' only two timestamps sit at the domain extremes, so the
  // crosshair snaps deterministically to margin.l (44) or width-margin.r
  // (592, width defaults to 600 with no y2 axis) regardless of exact clientX.
  fireEvent.pointerMove(svg, { clientX: 50, clientY: 100, pointerId: 1 })
  expect(parseFloat(screen.getByRole('status').style.left)).toBe(58)    // 44 + 14
  fireEvent.pointerMove(svg, { clientX: 550, clientY: 100, pointerId: 1 })
  expect(parseFloat(screen.getByRole('status').style.left)).toBe(578)   // 592 - 14
})

test('X5: tooltip shows a muted per-row date suffix only for a line whose point is a tolerance-match, not exact', () => {
  const mixedCadenceLines = [
    { name: 'primary', pts: [
      { date: '2026-01-01', region: 'x', metric: 'primary', value: 1 },
      { date: '2026-01-15', region: 'x', metric: 'primary', value: 2 },
    ] },
    { name: 'monthly', pts: [
      { date: '2026-01-13', region: 'x', metric: 'monthly', value: 99 },
    ] },
  ]
  const { container } = render(
    <LineChart lines={mixedCadenceLines} percent={false} unit="index" label="mixed cadence" />)
  const svg = container.querySelector('svg') as SVGSVGElement
  // 2026-01-15 is the domain's latest point -> pixel = width - margin.r = 592.
  fireEvent.pointerMove(svg, { clientX: 592, clientY: 100, pointerId: 1 })
  const tooltip = screen.getByRole('status')
  expect(tooltip).toHaveTextContent('15 Jan 2026')   // header date
  const primaryRow = within(tooltip).getByText('primary').closest('div')!
  const monthlyRow = within(tooltip).getByText('monthly').closest('div')!
  expect(primaryRow.textContent).not.toContain('·')       // exact match -> no suffix
  expect(monthlyRow.textContent).toContain('· 13 Jan')    // tolerance match -> own date
})
