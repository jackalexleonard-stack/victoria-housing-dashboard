import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewsSection } from './NewsSection'
import type { NewsData, NewsItem } from '../lib/types'

function item(overrides: Partial<NewsItem> & Pick<NewsItem, 'title' | 'url' | 'published'>):
  NewsItem {
  return { source: 'The Age', tags: [], image: null, dup_sources: [], score: 1, ...overrides }
}

const news: NewsData = {
  schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
  items: [
    item({ title: 'Hero story', url: 'https://n/1', source: 'RBA',
           published: '2026-07-17', tags: ['policy'] }),
    item({ title: 'Rents piece', url: 'https://n/2', published: '2026-07-16', tags: ['rents'] }),
    item({ title: 'Both tags piece', url: 'https://n/3',
           published: '2026-07-14', tags: ['rents', 'policy'] }),
    item({ title: 'Prices piece', url: 'https://n/4', published: '2026-07-15', tags: ['prices'] }),
    item({ title: 'Untagged piece', url: 'https://n/5', published: '2026-07-10', tags: [] }),
  ],
  top_story_urls: ['https://n/1'], digest: null,
}

test('unfiltered list hides items already on today', () => {
  render(<NewsSection news={news} />)
  expect(screen.queryByText('Hero story')).not.toBeInTheDocument()
  expect(screen.getByText('Rents piece')).toBeInTheDocument()
})

test('source filter shows every match, including top stories', async () => {
  render(<NewsSection news={news} />)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /source/i }), 'RBA')
  expect(screen.getByText('Hero story')).toBeInTheDocument()
  expect(screen.queryByText('Rents piece')).not.toBeInTheDocument()
})

test('published dates render human-formatted, not raw ISO', () => {
  render(<NewsSection news={news} />)
  expect(screen.getByText(/16 Jul 2026/)).toBeInTheDocument()
  expect(screen.queryByText(/2026-07-16/)).not.toBeInTheDocument()
})

test('an item with multiple tags is grouped under its single highest-priority tag', () => {
  render(<NewsSection news={news} />)
  // Priority order (mirrors scoring.py's TAG_VALUE): policy > prices > rents > ...
  // 'Both tags piece' carries rents+policy, so it must land under Policy only.
  const policyGroup = screen.getByRole('heading', { name: /Policy/ }).closest('div')!
  expect(within(policyGroup).getByText('Both tags piece')).toBeInTheDocument()
  const rentsGroup = screen.getByRole('heading', { name: /Rents/ }).closest('div')!
  expect(within(rentsGroup).queryByText('Both tags piece')).not.toBeInTheDocument()
})

test('an untagged item falls into Other', () => {
  render(<NewsSection news={news} />)
  const otherGroup = screen.getByRole('heading', { name: /Other/ }).closest('div')!
  expect(within(otherGroup).getByText('Untagged piece')).toBeInTheDocument()
})

test('groups render in priority order, then Other last, and empty groups are hidden', () => {
  render(<NewsSection news={news} />)
  const policy = screen.getByRole('heading', { name: /Policy/ })
  const prices = screen.getByRole('heading', { name: /Prices/ })
  const rents = screen.getByRole('heading', { name: /Rents/ })
  const other = screen.getByRole('heading', { name: /Other/ })
  const before = (a: Element, b: Element) =>
    !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
  expect(before(policy, prices)).toBe(true)
  expect(before(prices, rents)).toBe(true)
  expect(before(rents, other)).toBe(true)
  // No supply_construction/construction_costs/international items in the
  // fixture — those groups must not render an (empty) header at all.
  expect(screen.queryByRole('heading', { name: /Supply & construction/ }))
    .not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Construction costs/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /International/ })).not.toBeInTheDocument()
})

test('a group over 5 items is capped with a Show all / Show fewer toggle', async () => {
  const many: NewsData = {
    schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
    items: Array.from({ length: 6 }, (_, i) => item({
      title: `Prices story ${i}`, url: `https://n/p${i}`,
      published: `2026-07-${10 + i}`, tags: ['prices'],
    })),
    top_story_urls: [], digest: null,
  }
  render(<NewsSection news={many} />)
  expect(screen.getAllByText(/Prices story/)).toHaveLength(5)
  // Newest-first: 2026-07-15 is the newest of the six, so the oldest
  // (2026-07-10, "Prices story 0") is the one held back by the cap.
  expect(screen.queryByText('Prices story 0')).not.toBeInTheDocument()
  const toggle = screen.getByRole('button', { name: /show all 6/i })
  expect(toggle).toHaveAttribute('aria-expanded', 'false')

  await userEvent.click(toggle)

  expect(screen.getAllByText(/Prices story/)).toHaveLength(6)
  expect(screen.getByText('Prices story 0')).toBeInTheDocument()
  const collapse = screen.getByRole('button', { name: /show fewer/i })
  expect(collapse).toHaveAttribute('aria-expanded', 'true')

  await userEvent.click(collapse)

  expect(screen.getAllByText(/Prices story/)).toHaveLength(5)
})

test('source filter hides groups left empty by the filter', async () => {
  render(<NewsSection news={news} />)
  await userEvent.selectOptions(screen.getByRole('combobox', { name: /source/i }), 'RBA')
  // Only the RBA-sourced hero story matches — its group (Policy) is the only one left.
  expect(screen.getByRole('heading', { name: /Policy/ })).toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Prices/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Rents/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('heading', { name: /Other/ })).not.toBeInTheDocument()
})

test('tag chips are gone — the topic groups supersede them', () => {
  render(<NewsSection news={news} />)
  expect(screen.queryByRole('button', { name: 'policy' })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'rents' })).not.toBeInTheDocument()
})
