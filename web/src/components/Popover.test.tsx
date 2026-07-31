import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover } from './Popover'

const setup = () => render(
  <div>
    <Popover trigger="why?" panelLabel="Details"><p>the explanation</p></Popover>
    <button type="button">elsewhere</button>
  </div>)

test('closed by default; click opens; Escape closes and keeps focus on the trigger', async () => {
  setup()
  const btn = screen.getByRole('button', { name: 'why?' })
  expect(btn).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('the explanation')).not.toBeInTheDocument()
  await userEvent.click(btn)
  expect(btn).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('group', { name: 'Details' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(btn).toHaveAttribute('aria-expanded', 'false')
  expect(btn).toHaveFocus()
})

test('focus leaving the control closes the panel', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'why?' }))
  await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
  expect(screen.getByRole('button', { name: 'why?' })).toHaveAttribute('aria-expanded', 'false')
})

test('ariaLabel overrides the accessible name without changing the visible text', async () => {
  render(<Popover trigger="Sep qtr 2025 · stale" ariaLabel="Sep qtr 2025 · stale — why?"
                  panelLabel="Details"><p>x</p></Popover>)
  expect(screen.getByRole('button', { name: 'Sep qtr 2025 · stale — why?' }))
    .toHaveTextContent('Sep qtr 2025 · stale')
})
