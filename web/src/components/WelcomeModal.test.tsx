import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WelcomeModal } from './WelcomeModal'

beforeAll(() => {
  HTMLDialogElement.prototype.showModal ??= function () { this.open = true }
  HTMLDialogElement.prototype.close ??= function () { this.open = false }
})

const SECTIONS: [string, string][] = [
  ['prices', 'Prices'], ['rents', 'Rents & vacancy'], ['money', 'Money & credit'],
]

test('opens on mount and lists every section as an unchecked checkbox', () => {
  render(<WelcomeModal sections={SECTIONS} onEnter={() => {}} />)
  expect(screen.getByRole('dialog', { name: /choose your sections/i })).toBeInTheDocument()
  for (const [, label] of SECTIONS) {
    expect(screen.getByRole('checkbox', { name: label })).not.toBeChecked()
  }
})

test('"Enter dashboard" is disabled until at least one section is checked', async () => {
  render(<WelcomeModal sections={SECTIONS} onEnter={() => {}} />)
  const enter = screen.getByRole('button', { name: 'Enter dashboard' })
  expect(enter).toBeDisabled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
  expect(enter).toBeEnabled()
})

test('"Enter dashboard" calls onEnter with checked ids in declaration order, not click order', async () => {
  const onEnter = vi.fn()
  render(<WelcomeModal sections={SECTIONS} onEnter={onEnter} />)
  // Click in an order that diverges from declaration order (Money & credit
  // is index 2, Prices is index 0) — proves the result is derived from
  // `sections`, not from click/insertion order.
  await userEvent.click(screen.getByRole('checkbox', { name: 'Money & credit' }))
  await userEvent.click(screen.getByRole('checkbox', { name: 'Prices' }))
  await userEvent.click(screen.getByRole('button', { name: 'Enter dashboard' }))
  expect(onEnter).toHaveBeenCalledWith(['prices', 'money'])
})

test('"Show everything" is always enabled and passes all ids', async () => {
  const onEnter = vi.fn()
  render(<WelcomeModal sections={SECTIONS} onEnter={onEnter} />)
  const showAll = screen.getByRole('button', { name: 'Show everything' })
  expect(showAll).toBeEnabled()
  await userEvent.click(showAll)
  expect(onEnter).toHaveBeenCalledWith(['prices', 'rents', 'money'])
})

test('Esc (the dialog cancel event) is prevented — the modal does not close on cancel', () => {
  render(<WelcomeModal sections={SECTIONS} onEnter={() => {}} />)
  const dialog = screen.getByRole('dialog')
  const evt = new Event('cancel', { cancelable: true })
  fireEvent(dialog, evt)
  expect(evt.defaultPrevented).toBe(true)
})
