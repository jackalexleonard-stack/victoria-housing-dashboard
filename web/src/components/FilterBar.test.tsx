import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilterBar } from './FilterBar'

const sections: [string, string][] = [['today', 'Today'], ['prices', 'Prices']]
// Stub props for the Sections popover (Task 6) — none of the pre-existing
// tests below exercise it, so a fixed no-op/closed-everything shape keeps
// every render call unchanged aside from spreading this in.
const sectionsProps = { isSectionOpen: () => false, onSetSections: () => {}, onResetSections: () => {} }

test('range and geo are keyboard-operable radiogroups', async () => {
  const onFilters = vi.fn()
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="today" onFilters={onFilters} onJump={() => {}} {...sectionsProps} />)
  const groups = screen.getAllByRole('radiogroup')
  expect(groups).toHaveLength(2)
  await userEvent.click(screen.getByRole('radio', { name: '1y' }))
  expect(onFilters).toHaveBeenCalledWith({ range: '1y' })
  await userEvent.click(screen.getByRole('radio', { name: 'Victoria' }))
  expect(onFilters).toHaveBeenCalledWith({ geo: 'vic' })
})

test('section chips jump and mark the active section', async () => {
  const onJump = vi.fn()
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="prices" onFilters={() => {}} onJump={onJump} {...sectionsProps} />)
  const active = screen.getByRole('button', { name: 'Jump to Prices' })
  expect(active).toHaveAttribute('aria-current', 'true')
  await userEvent.click(screen.getByRole('button', { name: 'Jump to Today' }))
  expect(onJump).toHaveBeenCalledWith('today')
})

test('arrow keys move selection within a radiogroup', async () => {
  const onFilters = vi.fn()
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="today" onFilters={onFilters} onJump={() => {}} {...sectionsProps} />)
  const group = screen.getByRole('radiogroup', { name: /date range/i })
  const selected = within(group).getByRole('radio', { checked: true })
  selected.focus()
  await userEvent.keyboard('{ArrowRight}')
  expect(onFilters).toHaveBeenCalledWith({ range: '10y' })   // RANGES: 1y,3y,5y,10y,all → after 5y is 10y
  await userEvent.keyboard('{Home}')
  expect(onFilters).toHaveBeenCalledWith({ range: '1y' })
})

test('roving tabindex: only the selected radio is in the tab order', () => {
  render(<FilterBar range="5y" geo="melbourne" sections={sections}
                    activeSection="today" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
  const group = screen.getByRole('radiogroup', { name: /date range/i })
  const radios = within(group).getAllByRole('radio')
  const tabbable = radios.filter(r => r.getAttribute('tabindex') === '0')
  expect(tabbable).toHaveLength(1)
  expect(tabbable[0]).toHaveAttribute('aria-checked', 'true')
})

// Design review P1-touch ("Bring daily-touch controls up to touch size").
// These size bumps are pure CSS media-variant classes — Tailwind's
// `pointer-coarse:` prefix compiles to `@media (pointer: coarse)`, the same
// media feature App.tsx/lib/sections.ts already gate the mobile
// collapse-by-default behaviour on (via matchMedia('(pointer: coarse)')).
// Unlike that JS branch, there's no matchMedia call to stub HERE: the exact
// same markup ships to every device and the browser's CSS engine decides
// which rules win at paint time, so "coarse-pointer" and "fine-pointer"
// verification both read off the one render — the coarse assertions confirm
// the `pointer-coarse:` classes are wired on, the fine-pointer assertions
// confirm the plain classes fine-pointer/desktop users actually see are
// untouched.
describe('touch targets (design review P1-touch)', () => {
  test('Filters/Done become bordered buttons on coarse pointers, never a solid fill; fine-pointer text-link styling is untouched', () => {
    render(<FilterBar range="5y" geo="melbourne" sections={sections}
                      activeSection="today" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
    // Done lives inside the (closed-by-default) <dialog>, invisible to the
    // default accessibility-tree query — hidden:true reads its classes
    // without needing to actually open the sheet. Task 6: the Sections
    // popover (rendered twice, desktop + mobile) has its own "Done" button
    // too, so three match the name — the sheet's is last in DOM order.
    const filters = screen.getByRole('button', { name: 'Filters' })
    const done = screen.getAllByRole('button', { name: 'Done', hidden: true }).at(-1)!
    for (const btn of [filters, done]) {
      expect(btn).toHaveClass('text-blue')   // fine-pointer look: unchanged
      expect(btn).toHaveClass('pointer-coarse:border', 'pointer-coarse:border-line',
                               'pointer-coarse:rounded-md', 'pointer-coarse:py-2.5',
                               'pointer-coarse:px-4')
      expect(btn.className).not.toMatch(/\bbg-blue\b/)   // never a solid fill
    }
  })

  test('the bottom sheet\'s Segmented copy gets the 44px bump; the desktop toolbar copy is untouched', () => {
    render(<FilterBar range="5y" geo="melbourne" sections={sections}
                      activeSection="today" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
    // Document order: the always-visible toolbar row renders before the
    // sm:hidden/dialog block, so [0] is the toolbar's radio, [1] the sheet's.
    const [toolbarRadio, sheetRadio] =
      screen.getAllByRole('radio', { name: '1y', hidden: true })
    expect(sheetRadio).toHaveClass('pointer-coarse:px-3', 'pointer-coarse:py-3',
                                    'pointer-coarse:text-sm')
    expect(toolbarRadio.className).not.toMatch(/pointer-coarse:/)
  })

  test('section chips enlarge their hit area via padding/negative margin, keeping the visible tab unchanged', () => {
    render(<FilterBar range="5y" geo="melbourne" sections={sections}
                      activeSection="today" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
    const chip = screen.getByRole('button', { name: 'Jump to Prices' })
    // The hit-box classes live on the button; visual sizing moved to the
    // inner span, so the button itself carries no px-1/py-1 tab styling.
    expect(chip).toHaveClass('pointer-coarse:p-1.5', 'pointer-coarse:-m-1.5')
    expect(chip.className).not.toMatch(/\btext-xs\b/)
    const tab = within(chip).getByText('Prices')
    expect(tab).toHaveClass('px-1', 'py-1', 'text-xs', 'border-b-2', 'border-transparent')
    expect(tab).toHaveClass('pointer-coarse:py-2')   // the only coarse-pointer growth
  })
})

// Design review P2-a (narrowed): the scrollspy nav restyles from a filled/
// outlined pill to an underlined text-tab — pale-tint/outline pills are now
// exclusively status/provenance (staleness/scope Chips, the masthead), so a
// control no longer shares their silhouette.
describe('scrollspy de-pill (design review P2-a)', () => {
  test('idle and active tabs carry no rounded-full/border-pill classes', () => {
    render(<FilterBar range="5y" geo="melbourne" sections={sections}
                      activeSection="prices" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
    const idle = within(screen.getByRole('button', { name: 'Jump to Today' })).getByText('Today')
    const active = within(screen.getByRole('button', { name: 'Jump to Prices' })).getByText('Prices')
    for (const tab of [idle, active]) {
      expect(tab.className).not.toMatch(/rounded-full/)
      expect(tab.className).not.toMatch(/\bborder-line\b/)
    }
  })

  test('active tab uses a blue underline + medium weight, not a filled pill', () => {
    render(<FilterBar range="5y" geo="melbourne" sections={sections}
                      activeSection="prices" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
    const active = within(screen.getByRole('button', { name: 'Jump to Prices' })).getByText('Prices')
    expect(active).toHaveClass('border-b-2', 'border-blue', 'text-blue', 'font-medium')
    expect(active.className).not.toMatch(/bg-blue/)
  })

  test('idle tabs get a transparent underline (reserves the same space, no visible border)', () => {
    render(<FilterBar range="5y" geo="melbourne" sections={sections}
                      activeSection="prices" onFilters={() => {}} onJump={() => {}} {...sectionsProps} />)
    const idle = within(screen.getByRole('button', { name: 'Jump to Today' })).getByText('Today')
    expect(idle).toHaveClass('border-b-2', 'border-transparent', 'text-muted')
    expect(idle.className).not.toMatch(/\btext-blue\b|font-medium/)
  })
})
