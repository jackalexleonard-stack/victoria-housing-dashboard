import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DataTable } from './DataTable'

const lines = [{ name: 'a', pts: [
  { date: '2026-01-31', region: 'vic', metric: 'a', value: 1 },
  { date: '2026-02-28', region: 'vic', metric: 'a', value: 2 },
] }]

test('every header cell is sticky within the scrolling container (structural guard; actual scroll-pinning is CSS)', async () => {
  render(<DataTable lines={lines} unit="aud" />)
  await userEvent.click(screen.getByText('View data table'))
  const headers = screen.getAllByRole('columnheader')
  expect(headers.length).toBeGreaterThan(0)
  for (const th of headers) {
    expect(th.className).toMatch(/\bsticky\b/)
    expect(th.className).toMatch(/\btop-0\b/)
    expect(th.className).toMatch(/\bbg-card\b/)
  }
})

// Design review P1-touch: the "View data table" disclosure was a bare
// ~20px-tall text link. pointer-coarse:py-3.5 is a static CSS-variant
// class (Tailwind's `pointer-coarse:` -> `@media (pointer: coarse)`) that
// ships in the same markup for every device — no matchMedia branch to
// stub, so one render confirms both the coarse-pointer bump and that the
// fine-pointer/desktop classes are untouched.
test('the "View data table" toggle gets a coarse-pointer touch-size bump; fine-pointer classes are untouched', () => {
  render(<DataTable lines={lines} unit="aud" />)
  const summary = screen.getByText('View data table')
  expect(summary).toHaveClass('text-xs', 'text-muted', 'cursor-pointer')   // unchanged
  expect(summary).toHaveClass('pointer-coarse:py-3.5')
})
