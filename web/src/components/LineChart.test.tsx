import { render, screen, fireEvent } from '@testing-library/react'
import { LineChart } from './LineChart'

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
