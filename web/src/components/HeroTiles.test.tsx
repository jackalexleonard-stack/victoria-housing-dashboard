import tileChartFixture from '../../../pipeline/tile_chart.json'
import { TILE_CHART } from './HeroTiles'

// Backlog cleanup: TILE_CHART here is a hand-maintained mirror of
// pipeline/scoring.py's own TILE_CHART (this side can't import a Python
// dict directly) — previously with no test checking the two actually
// agree. pipeline/tile_chart.json is a small checked-in fixture both sides
// are tested against (see tests/test_scoring.py's matching test): if
// either dict drifts from it, that side's own test fails immediately,
// which transitively proves the two dicts still agree with each other.
test('TILE_CHART matches the cross-language parity fixture', () => {
  expect(TILE_CHART).toEqual(tileChartFixture)
})
