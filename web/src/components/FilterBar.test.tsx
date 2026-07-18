import { render, screen } from '@testing-library/react'
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
  const active = screen.getByRole('button', { name: 'Prices' })
  expect(active).toHaveAttribute('aria-current', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Today' }))
  expect(onJump).toHaveBeenCalledWith('today')
})
