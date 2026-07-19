from datetime import date

import pandas as pd
import pytest

from pipeline import scoring

TODAY = date(2026, 7, 17)


# ---------------------------------------------------------------------------
# News importance
# ---------------------------------------------------------------------------
def _item(**kw):
    base = {"title": "t", "url": "https://x.test/a", "source": "Google News",
            "published": "2026-07-17", "tags": ["prices"]}
    base.update(kw)
    return base


def test_worked_example_a_rba_rate_cut():
    it = _item(title="RBA cuts cash rate to 3.35 per cent", source="RBA",
               published="2026-07-17", tags=["policy"],
               dup_sources=["ABC News", "Guardian Australia", "The Age"])
    assert scoring.score_news(it, TODAY) == pytest.approx(13.00, abs=0.005)


def test_worked_example_b_melbourne_prices():
    it = _item(title="Melbourne house prices fall for third straight month, Cotality says",
               source="The Age", published="2026-07-16", tags=["prices"],
               dup_sources=["ABC News"])
    assert scoring.score_news(it, TODAY) == pytest.approx(6.01, abs=0.005)


def test_worked_example_c_iron_ore_below_gate():
    it = _item(title="Iron ore hits record as Chinese economy stirs",
               source="The Age", published="2026-07-14", tags=["international"])
    assert scoring.score_news(it, TODAY) == pytest.approx(1.24, abs=0.005)
    assert scoring.top_stories([it], TODAY) == []          # excluded by the 2.0 gate


def test_decay_halves_at_two_days():
    fresh = _item(published="2026-07-17")
    stale = _item(published="2026-07-15")
    assert scoring.score_news(stale, TODAY) == pytest.approx(
        scoring.score_news(fresh, TODAY) / 2, rel=1e-9)


def test_dup_weight_caps_at_three():
    three = _item(dup_sources=["a", "b", "c"])
    five = _item(dup_sources=["a", "b", "c", "d", "e"])
    assert scoring.score_news(three, TODAY) == scoring.score_news(five, TODAY)


def test_vic_and_policy_bonuses_are_flat_and_stack_with_each_other():
    one_kw = _item(title="Victoria housing update")
    many_kw = _item(title="Victoria Melbourne Geelong Ballarat housing update")
    assert scoring.score_news(one_kw, TODAY) == scoring.score_news(many_kw, TODAY)
    both = _item(title="Victoria stamp duty overhaul")
    vic_only = _item(title="Victoria housing overhaul")
    assert scoring.score_news(both, TODAY) - scoring.score_news(vic_only, TODAY) \
        == pytest.approx(1.5)


def test_rank_deterministic_tiebreaks():
    a = _item(title="AAA housing market report", url="https://x.test/aaa", source="The Age")
    b = _item(title="BBB housing market report", url="https://x.test/bbb", source="The Age")
    assert scoring.score_news(a, TODAY) == scoring.score_news(b, TODAY)
    ranked = scoring.rank_news([b, a], TODAY)
    assert [it["title"][:3] for it in ranked] == ["AAA", "BBB"]  # title tiebreak
    newer = _item(title="CCC housing market report", published="2026-07-17", source="Google News")
    older = _item(title="CCC housing market report 2", published="2026-07-15", source="Google News")
    ranked = scoring.rank_news([older, newer], TODAY)
    assert ranked[0]["published"] > ranked[1]["published"]       # higher score (fresher) first


def test_top_stories_age_gate_and_no_padding():
    old_but_big = _item(title="RBA cuts cash rate", source="RBA", tags=["policy"],
                        published="2026-07-01")                  # 16 days old
    assert scoring.top_stories([old_but_big], TODAY) == []
    fresh = _item(title="Melbourne house prices fall", source="Cotality",
                  published="2026-07-17")
    assert len(scoring.top_stories([fresh], TODAY, n=4)) == 1    # fewer than n, no pad


# ---------------------------------------------------------------------------
# Hero notability — fake loaders
# ---------------------------------------------------------------------------
def _df(series_rows):
    return pd.DataFrame(series_rows, columns=["date", "region", "metric", "value", "unit"])


def _monthly(values, metric, region, end="2026-06-30"):
    dates = pd.date_range(end=end, periods=len(values), freq="ME")
    return [(d.strftime("%Y-%m-%d"), region, metric, v, "u") for d, v in zip(dates, values)]


def _loaders(frames, freq="monthly", last_changed="2026-07-16T03:00:00Z"):
    def load_series(sid):
        return frames.get(sid, _df([]))
    def load_meta(sid):
        return {"frequency": freq, "last_changed": last_changed}
    return load_series, load_meta


def test_sigma_zero_rate_move_maxes_z():
    vals = [4.35] * 21 + [4.10]                                  # 20 holds then a cut
    ls, lm = _loaders({"au_cash_rate": _df(_monthly(vals, "cash_rate", "australia"))})
    r = scoring.score_metric("cash_rate", ls, lm, TODAY)
    assert r["z"] == 1.0                                         # dead-flat run -> cap
    assert r["n"] >= scoring.QUALIFY


def test_confirmed_trend_flip_scores_f_one():
    changes = [1] * 9 + [-1, -1, -1]
    vals = [100.0]
    for c in changes:
        vals.append(vals[-1] + c)
    ls, lm = _loaders({"au_credit": _df(_monthly(vals, "credit_housing_yoy", "australia"))})
    r = scoring.score_metric("credit_growth", ls, lm, TODAY)
    assert r["f"] == 1.0


def test_stale_series_excluded():
    vals = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    ls, lm = _loaders({"au_cash_rate": _df(_monthly(vals, "cash_rate", "australia",
                                                    end="2025-09-30"))})   # ~9.5 months old
    assert scoring.score_metric("cash_rate", ls, lm, TODAY) is None


def test_single_point_unscoreable():
    ls, lm = _loaders({"au_cash_rate": _df(_monthly([4.35], "cash_rate", "australia"))})
    assert scoring.score_metric("cash_rate", ls, lm, TODAY) is None


def _full_frames():
    """Data for the 5 default tiles only, all flat (nothing qualifies)."""
    flat = [100.0] * 15
    return {
        "au_cash_rate": _df(_monthly(flat, "cash_rate", "australia")),
        "vic_hvi": _df(_monthly(flat, "hvi_index", "melbourne")
                       + _monthly([-1.0], "hvi_change_mom", "melbourne")
                       + _monthly([2.0], "hvi_change_yoy", "melbourne")),
        "au_dwelling_stock": _df(_monthly(flat, "mean_price", "vic")),
        "vic_approvals": _df(_monthly(flat, "approvals_dwellings_total", "vic")),
        "au_accord": _df(_monthly(flat, "accord_quarterly_actual", "australia")
                         + _monthly(flat, "accord_quarterly_target", "australia")),
    }


def test_pick_hero_pins_first_and_pads_to_five():
    ls, lm = _loaders(_full_frames())
    tiles = scoring.pick_hero(ls, lm, TODAY)
    assert len(tiles) == 5
    assert tiles[0]["key"] == "cash_rate"
    assert tiles[1]["key"] == "melb_dwelling_values"
    # Flat data: nothing qualifies, so the rest pad from DEFAULT_ORDER.
    assert [t["key"] for t in tiles[2:]] == ["vic_mean_price", "vic_approvals",
                                             "accord_runrate"]


def test_pick_hero_promotes_notable_metric():
    frames = _full_frames()
    vals = [5.0] * 21 + [5.5]                                    # surprise move
    frames["au_credit"] = _df(_monthly(vals, "credit_housing_yoy", "australia"))
    ls, lm = _loaders(frames)
    tiles = scoring.pick_hero(ls, lm, TODAY)
    assert tiles[2]["key"] == "credit_growth"                    # first dynamic slot
    assert "notability" in (tiles[2]["help"] or "")


def test_pick_hero_deterministic():
    ls, lm = _loaders(_full_frames())
    assert scoring.pick_hero(ls, lm, TODAY) == scoring.pick_hero(ls, lm, TODAY)


def test_pick_hero_survives_total_outage():
    ls, lm = _loaders({})
    tiles = scoring.pick_hero(ls, lm, TODAY)
    assert len(tiles) == 5
    assert all(t["value"] == "—" for t in tiles)
