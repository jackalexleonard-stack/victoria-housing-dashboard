import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Masthead } from './Masthead'

const GENERATED_AT = '2026-07-18T04:00:00Z'

test('no failed sources renders the plain "run ok" good chip, untouched', () => {
  render(<Masthead generatedAt={GENERATED_AT} failedSources={[]} />)
  expect(screen.getByText('run ok')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('failed sources render as a keyboard-operable disclosure, not an inert chip', () => {
  render(<Masthead generatedAt={GENERATED_AT}
                   failedSources={[{ source: 'REIV median house & unit prices', vintage: 'No data' }]} />)
  const button = screen.getByRole('button', { name: '1 source unavailable' })
  expect(button).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByText('REIV median house & unit prices')).not.toBeInTheDocument()
})

test('clicking the disclosure opens a popover listing each failed source with its vintage', async () => {
  render(<Masthead generatedAt={GENERATED_AT} failedSources={[
    { source: 'REIV median house & unit prices', vintage: 'No data' },
    { source: 'Melbourne auction clearance rate (Cotality/Domain)', vintage: 'No data' },
  ]} />)
  const button = screen.getByRole('button', { name: '2 sources unavailable' })
  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText('REIV median house & unit prices')).toBeInTheDocument()
  expect(screen.getByText('Melbourne auction clearance rate (Cotality/Domain)')).toBeInTheDocument()
  expect(screen.getAllByText('No data')).toHaveLength(2)
})

test('Escape closes the popover', async () => {
  render(<Masthead generatedAt={GENERATED_AT}
                   failedSources={[{ source: 'REIV median house & unit prices', vintage: 'No data' }]} />)
  const button = screen.getByRole('button', { name: '1 source unavailable' })
  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  await userEvent.keyboard('{Escape}')
  expect(button).toHaveAttribute('aria-expanded', 'false')
})

test('blurring out of the whole control closes the popover', async () => {
  render(
    <div>
      <Masthead generatedAt={GENERATED_AT}
                failedSources={[{ source: 'REIV median house & unit prices', vintage: 'No data' }]} />
      <button type="button">elsewhere</button>
    </div>)
  const button = screen.getByRole('button', { name: '1 source unavailable' })
  await userEvent.click(button)
  expect(button).toHaveAttribute('aria-expanded', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
  expect(button).toHaveAttribute('aria-expanded', 'false')
})
