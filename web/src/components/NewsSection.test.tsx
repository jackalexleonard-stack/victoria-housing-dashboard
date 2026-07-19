import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewsSection } from './NewsSection'
import type { NewsData } from '../lib/types'

const news: NewsData = {
  schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
  items: [
    { title: 'Hero story', url: 'https://n/1', source: 'RBA', published: '2026-07-17',
      tags: ['policy'], image: null, dup_sources: [], score: 9 },
    { title: 'Rents piece', url: 'https://n/2', source: 'The Age', published: '2026-07-16',
      tags: ['rents'], image: null, dup_sources: [], score: 5 },
    { title: 'Prices piece', url: 'https://n/3', source: 'The Age', published: '2026-07-15',
      tags: ['prices'], image: null, dup_sources: [], score: 4 },
  ],
  top_story_urls: ['https://n/1'], digest: null,
}

test('unfiltered list hides items already on today', () => {
  render(<NewsSection news={news} />)
  expect(screen.queryByText('Hero story')).not.toBeInTheDocument()
  expect(screen.getByText('Rents piece')).toBeInTheDocument()
})

test('tag filter shows every match including hero items', async () => {
  render(<NewsSection news={news} />)
  await userEvent.click(screen.getByRole('button', { name: 'policy' }))
  expect(screen.getByText('Hero story')).toBeInTheDocument()
  expect(screen.queryByText('Rents piece')).not.toBeInTheDocument()
})

test('source filter narrows the list', async () => {
  render(<NewsSection news={news} />)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /source/i }), 'The Age')
  expect(screen.getByText('Rents piece')).toBeInTheDocument()
  expect(screen.queryByText('Hero story')).not.toBeInTheDocument()
})

test('published dates render human-formatted, not raw ISO', () => {
  render(<NewsSection news={news} />)
  expect(screen.getByText(/16 Jul 2026/)).toBeInTheDocument()
  expect(screen.queryByText(/2026-07-16/)).not.toBeInTheDocument()
})
