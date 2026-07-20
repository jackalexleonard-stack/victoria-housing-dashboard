import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterBar } from './FilterBar'

const sections: [string, string][] = [['today', 'Today'], ['prices', 'Prices']]

test('range and geo are keyboard-operable radiogroups', async () => {
  const onFilters = vi.fn()
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="today" onFilters={onFilters} onJump={() => {}} />)
  const groups = screen.getAllByRole('radiogroup')
  expect(groups).toHaveLength(2)
  await userEvent.click(screen.getByRole('radio', { name: '1y' }))
  expect(onFilters).toHaveBeenCalledWith({ range: '1y' })
  await userEvent.click(screen.getByRole('radio', { name: 'Victoria' }))
  expect(onFilters).toHaveBeenCalledWith({ geo: 'vic' })
})

test('section chips jump and mark the active section', async () => {
  const onJump = vi.fn()
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="prices" onFilters={() => {}} onJump={onJump} />)
  const active = screen.getByRole('button', { name: 'Jump to Prices' })
  expect(active).toHaveAttribute('aria-current', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Jump to Today' }))
  expect(onJump).toHaveBeenCalledWith('today')
})

test('arrow keys move selection within a radiogroup', async () => {
  const onFilters = vi.fn()
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="today" onFilters={onFilters} onJump={() => {}} />)
  const group = screen.getByRole('radiogroup', { name: /date range/i })
  const selected = within(group).getByRole('radio', { checked: true })
  selected.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(onFilters).toHaveBeenCalledWith({ range: '10y' })   // RANGES: 1y,3y,5y,10y,all → after 5y is 10y
  await userEvent.keyboard('{Home}')
  expect(onFilters).toHaveBeenCalledWith({ range: '1y' })
})

test('roving tabindex: only the selected radio is in the tab order', () => {
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="today" onFilters={() => {}} onJump={() => {}} />)
  const group = screen.getByRole('radiogroup', { name: /date range/i })
  const radios = within(group).getAllByRole('radio')
  const tabbable = radios.filter(r => r.getAttribute('tabindex') === '0')
  expect(tabbable).toHaveLength(1)
  expect(tabbable[0]).toHaveAttribute('aria-checked', 'true')
})
