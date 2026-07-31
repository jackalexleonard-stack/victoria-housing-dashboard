import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatusChip } from './StatusChip'
import { staleness } from '../lib/staleness'
import type { SeriesEntry } from '../lib/types'

const NOW = new Date('2026-07-31T00:00:00Z')
const entry = (over: Partial<SeriesEntry['meta']> = {},
               status: 'ok' | 'failed' = 'ok'): SeriesEntry => ({
  status, units: {}, points: [],
  meta: { source_name: 'DFFH / Homes Victoria Rental Report', source_url: 'u',
    frequency: 'quarterly', last_fetched: '2026-07-30T05:39:44Z', last_changed: null,
    last_data_date: '2025-09-30', error: null, cadence_days: 92,
    status_note: 'Homes Victoria hasn’t published a new Rental Report for several quarters.',
    ...over },
})
const chip = (e: SeriesEntry, quiet = false) =>
  render(<StatusChip entry={e} st={staleness(e, NOW)} now={NOW} quiet={quiet} />)

test('fresh renders inert text, no button', () => {
  chip(entry({ last_data_date: '2026-06-30' }))
  expect(screen.getByText('Data to Jun qtr 2026')).toBeInTheDocument()
  expect(screen.queryByRole('button')).not.toBeInTheDocument()
})

test('stale chip is a button; popover explains cause, releases behind, next due', async () => {
  chip(entry({}, 'failed'))
  const btn = screen.getByRole('button',
    { name: 'Data to Sep qtr 2025 · stale — why?' })
  await userEvent.click(btn)
  const panel = screen.getByRole('group', { name: 'Stale data — details' })
  expect(panel).toHaveTextContent('Well past this series’ expected release date.')
  expect(panel).toHaveTextContent('Latest data: Sep qtr 2025 · published quarterly · ~2 releases behind')
  expect(panel).toHaveTextContent('Homes Victoria hasn’t published a new Rental Report')
  expect(panel).toHaveTextContent('next update was due ~Dec qtr 2025')
})

test('without a curated note, a failed fetch explains itself honestly', async () => {
  chip(entry({ status_note: null, last_data_date: null }, 'failed'))
  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('group', { name: 'Source unavailable — details' }))
    .toHaveTextContent('The source hasn’t responded to the daily updater. Last attempt: 30 Jul 2026.')
})

test('without a curated note, an ok-but-old series blames the publisher', async () => {
  chip(entry({ status_note: null, last_data_date: '2026-01-31' }, 'ok'))
  await userEvent.click(screen.getByRole('button'))
  expect(screen.getByRole('group'))
    .toHaveTextContent('The publisher hasn’t released newer figures yet.')
})

test('quiet form shows the short pill but the same popover', async () => {
  chip(entry({}, 'failed'), true)
  const btn = screen.getByRole('button', { name: 'Sep qtr 2025 · stale — why?' })
  expect(btn).toHaveTextContent('Sep qtr 2025 · stale')
  await userEvent.click(btn)
  expect(screen.getByRole('group', { name: 'Stale data — details' })).toBeInTheDocument()
})
