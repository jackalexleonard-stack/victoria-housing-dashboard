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
