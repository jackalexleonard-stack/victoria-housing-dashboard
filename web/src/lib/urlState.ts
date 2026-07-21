import { useCallback, useEffect, useState } from 'react'

export const RANGES = ['1y', '3y', '5y', '10y', 'all'] as const
export const GEOS = ['melbourne', 'regional_vic', 'vic', 'australia'] as const
export type Range = (typeof RANGES)[number]
export type Geo = (typeof GEOS)[number]
export const DEFAULT_RANGE: Range = '5y'
export const DEFAULT_GEO: Geo = 'melbourne'

export interface UrlState {
  range: Range; geo: Geo
  detail: string | null; compare: string | null; detailPushed: boolean
}

export function parseUrl(search: string): UrlState {
  const q = new URLSearchParams(search)
  const range = RANGES.includes(q.get('range') as Range) ? (q.get('range') as Range) : DEFAULT_RANGE
  const geo = GEOS.includes(q.get('geo') as Geo) ? (q.get('geo') as Geo) : DEFAULT_GEO
  return { range, geo, detail: q.get('s'), compare: q.get('vs'),
           detailPushed: history.state?.detailPushed === true }
}

function writeUrl(next: Partial<UrlState>, prev: UrlState, push: boolean) {
  const merged = { ...prev, ...next }
  const q = new URLSearchParams()
  if (merged.range !== DEFAULT_RANGE) q.set('range', merged.range)
  if (merged.geo !== DEFAULT_GEO) q.set('geo', merged.geo)
  if (merged.detail) q.set('s', merged.detail)
  if (merged.compare) q.set('vs', merged.compare)
  const url = q.toString() ? `?${q}` : location.pathname
  if (push) history.pushState({ detailPushed: true }, '', url)
  else history.replaceState(history.state, '', url)
}

export function useUrlState() {
  const [state, setState] = useState<UrlState>(() => parseUrl(location.search))
  useEffect(() => {
    const onPop = () => setState(parseUrl(location.search))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const sync = useCallback(() => setState(parseUrl(location.search)), [])

  const setFilters = useCallback((p: { range?: Range; geo?: Geo }) => {
    writeUrl(p, parseUrl(location.search), false); sync()
  }, [sync])

  const openDetail = useCallback((id: string) => {
    writeUrl({ detail: id, compare: null }, parseUrl(location.search), true); sync()
  }, [sync])

  const closeDetail = useCallback(() => {
    const cur = parseUrl(location.search)
    if (cur.detailPushed) history.back()  // popstate handler re-syncs
    else { writeUrl({ detail: null, compare: null }, cur, false); sync() }
  }, [sync])

  const setCompare = useCallback((id: string | null) => {
    writeUrl({ compare: id }, parseUrl(location.search), false); sync()
  }, [sync])

  return { state, setFilters, openDetail, closeDetail, setCompare }
}
