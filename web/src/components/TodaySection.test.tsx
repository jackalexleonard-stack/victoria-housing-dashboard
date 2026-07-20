import { render, screen } from '@testing-library/react'
import siteEdge from '../test/fixtures/site.edge.json'
import { assertSiteData, type NewsData } from '../lib/types'
import { TodaySection } from './TodaySection'

const site = assertSiteData(siteEdge)
const news: NewsData = {
  schema_version: 1, generated_at: '2026-07-18T04:00:00Z',
  items: [{ title: 'Rates on hold again', url: 'https://n/1', source: 'RBA',
            published: '2026-07-17', tags: ['policy'], image: null,
            dup_sources: ['The Age', 'ABC News'], score: 9.1 }],
  top_story_urls: ['https://n/1'], digest: 'Two-line digest.',
}

test('hero formats machine values through the tile map', () => {
  render(<TodaySection site={site} news={news} onOpen={() => {}} />)
  expect(screen.getByText('3.85%')).toBeInTheDocument()      // cash_rate tile
  expect(screen.getByText('$580/wk')).toBeInTheDocument()    // melb_rent tile
})

test('top stories render with outlet count and digest shows', () => {
  render(<TodaySection site={site} news={news} onOpen={() => {}} />)
  expect(screen.getByText('Rates on hold again')).toHaveAttribute('href', 'https://n/1')
  expect(screen.getByText(/covered by 3 outlets/)).toBeInTheDocument()
  expect(screen.getByText('Two-line digest.')).toBeInTheDocument()
})

test('empty whats_new hides the strip entirely', () => {
  render(<TodaySection site={site} news={news} onOpen={() => {}} />)
  expect(screen.queryByText(/changed this week/i)).not.toBeInTheDocument()
})

test('dates render human-formatted, not raw ISO', () => {
  render(<TodaySection site={site} news={news} onOpen={() => {}} />)
  expect(screen.getByText(/30 Jun 2026/)).toBeInTheDocument()   // hero tile "Data to …"
  expect(screen.queryByText(/2026-06-30/)).not.toBeInTheDocument()
  expect(screen.getByText(/17 Jul 2026/)).toBeInTheDocument()   // top story published
})

test('a flat delta is not coloured as a move', () => {
  render(<TodaySection site={site} news={news} onOpen={() => {}} />)
  // edge fixture: cash_rate tile has delta 0 with delta_color 'inverse'
  const flat = screen.getByText('+0.00 pp')
  expect(flat).toHaveStyle({ color: '#575653' })   // PALETTE.muted, not up-green
})

test('hero tiles and top stories carry a one-line explainer tooltip', () => {
  render(<TodaySection site={site} news={news} onOpen={() => {}} />)
  expect(screen.getByText('3.85%').closest('[title]'))
    .toHaveAttribute('title', "Today's most notable movements")
  expect(screen.getByRole('heading', { name: 'Top stories' }))
    .toHaveAttribute('title', 'Ranked by source, topic and recency')
})
