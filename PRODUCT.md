# Product

## Register

product

## Platform

web

## Users

Primary: the owner — a Melbourne-based housing-market watcher who checks conditions daily, often from a phone. Secondary: their work team of economists specialising in the Victorian housing space — domain experts who scrutinise sources, definitions and data vintages, and who share specific findings with each other. Both audiences are repeat visitors in a professional context; neither needs the market explained from scratch.

## Product Purpose

An automated, zero-infrastructure dashboard tracking the Victorian housing market — prices, rents, vacancy, supply and construction, credit and rates, population, social housing — plus national context, international leading indicators, and a housing news layer. GitHub Actions fetches free public sources daily and commits tidy CSVs; the front-end renders them with no servers or databases. Success looks like: the owner's daily check takes under a minute and surfaces what changed; an economist on the team can trust a number, trace it to its source, and share the exact chart they mean with one link.

## Positioning

The one place the whole Victorian housing story updates itself every day and reads like a publication, not a BI tool.

## Brand Personality

Warm, editorial, crafted. The dashboard reads like a well-set data publication: charts lead with findings written in plain language, annotations carry the story, typography does the expressive work. Confident and precise without being cold; welcoming without being casual. The numbers are serious; the presentation makes them a pleasure to read.

## Anti-references

Not a Bloomberg terminal — no overwhelming density, no everything-at-once blinking walls of numbers. Not a government report — no default-Excel charts, dry tables, or flat hierarchy (the ABS publishes the data; we publish the story). Not a crypto/fintech landing — no dark neon, gradient text, or hype energy.

## Design Principles

1. **Findings, not figures.** Every chart leads with what it currently says ("Approvals are running below Accord pace"), not what it is ("Building Approvals, monthly"). The series name is the caption, not the headline.
2. **Provenance is a feature.** Source, vintage, staleness and next release are visible everywhere. Economists cite things; the dashboard makes citing effortless.
3. **Fast scan first, depth on demand.** The page answers "what changed?" in seconds; modals carry the full history, stats and actions for whoever wants to dig.
4. **Crafted restraint.** Editorial warmth is carried by type, annotation and finding-led copy — never by decoration, gradients or chart-junk.
5. **Nothing pretends.** Failed scrapers and stale sources say so plainly; an honest gap beats a confident blank.

## Accessibility & Inclusion

WCAG 2.1 AA: text contrast ≥ 4.5:1 (≥ 3:1 for large text), full keyboard operability for filters and modals, visible focus states, and a `prefers-reduced-motion` alternative for every animation. Every chart has keyboard-accessible equivalents — its one-sentence finding as the programmatic summary plus a disclosure-toggled data table — rather than per-point keyboard traversal. Charts never encode meaning by colour alone (direction arrows and labels accompany the up/down palette).
