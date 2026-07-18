import { renderHook, act } from '@testing-library/react'
import { parseUrl, useUrlState } from './urlState'

test('parse defaults and explicit values', () => {
  expect(parseUrl('')).toMatchObject({ range: '5y', geo: 'melbourne', detail: null, compare: null })
  expect(parseUrl('?range=1y&geo=vic&s=cash_rate&vs=credit'))
    .toMatchObject({ range: '1y', geo: 'vic', detail: 'cash_rate', compare: 'credit' })
  expect(parseUrl('?range=99y&geo=mars')).toMatchObject({ range: '5y', geo: 'melbourne' })
})

test('filters replace, detail pushes, close pops', async () => {
  history.replaceState(null, '', '/?range=5y')
  const depth = history.length
  const { result } = renderHook(() => useUrlState())
  act(() => result.current.setFilters({ range: '1y' }))
  expect(location.search).toContain('range=1y')
  expect(history.length).toBe(depth)               // replace, not push
  act(() => result.current.openDetail('cash_rate'))
  expect(location.search).toContain('s=cash_rate')
  expect(history.length).toBe(depth + 1)           // pushed one entry
  await act(async () => {
    result.current.closeDetail()
    // jsdom's history.back() queues two nested setTimeout(0) tasks before
    // firing popstate (SessionHistory.js traverseByDelta -> traverseHistory),
    // so wait two ticks for the popstate handler to re-sync state.
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
  })
  expect(result.current.state.detail).toBeNull()
})

test('close on a shared link strips params without popping', () => {
  history.replaceState(null, '', '/?s=cash_rate&vs=credit')
  const { result } = renderHook(() => useUrlState())
  expect(result.current.state.detail).toBe('cash_rate')
  const depth = history.length
  act(() => result.current.closeDetail())
  expect(location.search).not.toContain('s=')
  expect(history.length).toBe(depth)               // replaced, not popped
})
