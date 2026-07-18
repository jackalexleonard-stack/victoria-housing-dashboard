import { render, screen } from '@testing-library/react'
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
