import { assertSiteData, assertNewsData, type SiteData, type NewsData } from './types'

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path)  // relative: works under the Pages subpath
  if (!res.ok) throw new Error(`fetch ${path}: HTTP ${res.status}`)
  return res.json()
}

export async function loadAll(): Promise<{ site: SiteData; news: NewsData }> {
  const [site, news] = await Promise.all([
    fetchJson('data/site.json'), fetchJson('data/news.json'),
  ])
  return { site: assertSiteData(site), news: assertNewsData(news) }
}
