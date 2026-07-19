import { useMemo, useState } from 'react'
import { fmtDate } from '../lib/format'
import type { NewsData } from '../lib/types'

export function NewsSection({ news }: { news: NewsData }) {
  const [tags, setTags] = useState<string[]>([])
  const [source, setSource] = useState('')
  const allTags = useMemo(() =>
    [...new Set(news.items.flatMap(i => i.tags))].sort(), [news])
  const allSources = useMemo(() =>
    [...new Set(news.items.map(i => i.source))].sort(), [news])
  const filtering = tags.length > 0 || source !== ''
  const items = news.items.filter(i =>
    (tags.length === 0 || i.tags.some(t => tags.includes(t))) &&
    (source === '' || i.source === source) &&
    (filtering || !news.top_story_urls.includes(i.url)))

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {allTags.map(t => (
          <button key={t} type="button"
                  onClick={() => setTags(x => x.includes(t) ? x.filter(y => y !== t) : [...x, t])}
                  aria-pressed={tags.includes(t)}
                  className={`text-xs rounded-full border px-3 py-1 ${tags.includes(t)
                    ? 'border-blue text-blue font-medium' : 'border-line text-muted'}`}>
            {t}</button>
        ))}
        <label className="text-xs text-muted ml-auto">Source{' '}
          <select aria-label="Source" value={source}
                  onChange={e => setSource(e.target.value)}
                  className="border border-line rounded-md px-2 py-1 bg-card">
            <option value="">All</option>
            {allSources.map(s => <option key={s}>{s}</option>)}
          </select>
        </label>
      </div>
      <ul className="divide-y divide-line">
        {items.map(i => (
          <li key={i.url} className="py-2.5">
            <a href={i.url} target="_blank" rel="noreferrer"
               className="text-sm font-medium leading-snug hover:text-blue">{i.title}</a>
            <p className="text-xs text-faint mt-0.5">
              {i.source} · {fmtDate(i.published)}{i.tags.length > 0 && ` · ${i.tags.join(', ')}`}
            </p>
          </li>
        ))}
        {items.length === 0 && (
          <li className="py-6 text-sm text-muted">No stories match these filters</li>)}
      </ul>
    </div>
  )
}
