# Design review board — usability / appearance / information overload

**Trigger:** team feedback that the dashboard "may be a bit of information overload"; user pinpointed **the long scroll of charts** (9 sections, 27 charts, ~16k px) as where it bites. Approved 2026-07-21.

**Primary hypothesis:** the founding principle "fast scan first, depth on demand" is not surviving the page's growth. The board diagnoses; the user selects remedies; nothing ships without their pick (becomes the 2.3 batch).

## Phase 0 — ground truth
Playwright capture of the LIVE site (the deployed truth): full-page + per-section screenshots at desktop (1280×800) and phone (393×852) + one open detail view; `metrics.json` with page heights, per-section chart counts and pixel heights, above-the-fold inventory at both viewports, per-card element inventory (headline/legend/table-toggle/caption chips/notes), findings word counts from site.json. Artifacts to the session scratchpad; no commits.

## Phase 1 — seven lenses (parallel), each grounded in installed skill guidance + PRODUCT.md + the 2.0 spec
1. **Cognitive load & IA** (PRIMARY — impeccable `distill`+`critique`, product register): scan test, Today-vs-sections redundancy, section order/count, whether collapse-by-default or an overview layer is warranted.
2. **Visual hierarchy & density** (PRIMARY — impeccable `layout`): per-card element budget, caption-row load, rhythm across the scroll.
3. **Data-viz craft** (dataviz skill): does each chart earn its place; multi-line vs small multiples; annotation/legend balance.
4. **Typography & colour** (impeccable `typeset`/`colorize`): serif/sans balance; chip-vocabulary sprawl.
5. **Mobile experience** (impeccable `adapt`): the phone scan; scroll fatigue on primary-use device.
6. **UX copy** (impeccable `clarify`): findings scannability, captions, notes.
7. **Economist job-to-be-done** (PRODUCT.md): 60-second market picture; 3-click citation.

## Phase 2 — adversarial verification
Per significant finding: a practicality refuter ("real usability cost or reviewer taste?") AND an identity defender (the chosen personality — warm/editorial/crafted — may not be quietly redesigned). Survivors only.

## Phase 3 — synthesis
One report: scores per lens, P0 (harms the daily scan) → P2 (polish), each finding with a concrete proposed change + effort, plus considered-and-rejected. Presented to the user for selection → 2.3 plan.

Scale ≈ 30–40 agents (cf. the 52-agent spec review). The live site is untouched throughout.
