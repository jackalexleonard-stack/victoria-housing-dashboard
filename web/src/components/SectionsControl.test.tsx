import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SectionsControl } from './SectionsControl'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  HTMLDialogElement.prototype.close ??= function () { this.open = false }
})

const SECTIONS: [string, string][] = [
  ['prices', 'Prices'], ['rents', 'Rents & vacancy'], ['money', 'Money & credit'],
]

function setup(openIds: string[] = ['prices']) {
  const onSetAll = vi.fn()
  const onReset = vi.fn()
  render(<SectionsControl sections={SECTIONS} isOpen={id => openIds.includes(id)}
                          onSetAll={onSetAll} onReset={onReset} />)
  return { onSetAll, onReset }
}

test('opens a dialog listing every themed section with its open state', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: 'Sections' }))
  expect(screen.getByRole('dialog', { name: 'Choose sections' })).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: 'Prices' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Money & credit' })).not.toBeChecked()
})

test('ticking a box calls onSetAll with the checkbox added to the open set', async () => {
  const { onSetAll } = setup(['prices'])
  await userEvent.click(screen.getByRole('button', { name: 'Sections' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Money & credit' }))
  expect(onSetAll).toHaveBeenCalledWith(['prices', 'money'])
})

test('unticking calls onSetAll with the id removed', async () => {
  const { onSetAll } = setup(['prices', 'money'])
  await userEvent.click(screen.getByRole('button', { name: 'Sections' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
  expect(onSetAll).toHaveBeenCalledWith(['money'])
})

test('Open all passes every id; Reset calls onReset', async () => {
  const { onSetAll, onReset } = setup()
  await userEvent.click(screen.getByRole('button', { name: 'Sections' }))
  await userEvent.click(screen.getByRole('button', { name: 'Open all' }))
  expect(onSetAll).toHaveBeenCalledWith(['prices', 'rents', 'money'])
  await userEvent.click(screen.getByRole('button', { name: 'Reset' }))
  expect(onReset).toHaveBeenCalled()
})
