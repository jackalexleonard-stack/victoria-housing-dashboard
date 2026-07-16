"""Pipeline orchestrator.

Runs every source in isolation — each fetcher gets its own try/except so one
broken source can never block the others. Failures are logged and recorded in
the series' metadata; the run continues. Exits non-zero only if *every* source
failed (so CI notifies on a total outage, not on a single flaky source).

Run locally:  python -m pipeline.run
"""
from __future__ import annotations

import importlib
import logging
import sys

from pipeline import common

SOURCE_MODULES = [
    "pipeline.sources.abs",
    "pipeline.sources.rba",
    "pipeline.sources.fred",
    "pipeline.sources.accord",
]

log = logging.getLogger("pipeline")


def collect_series() -> list[common.Series]:
    series: list[common.Series] = []
    for name in SOURCE_MODULES:
        series.extend(importlib.import_module(name).SERIES)
    return series


def main() -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s"
    )
    common.load_env()
    series = collect_series()
    log.info("running %d series from %d modules", len(series), len(SOURCE_MODULES))

    results = []
    for s in series:
        try:
            r = common.process_series(s)
            log.info(
                "OK   %-18s rows=%-5d changed=%-5s data_to=%s",
                r.id, r.rows, r.changed, r.last_data_date,
            )
        except Exception as exc:  # isolation: never let one source stop the rest
            r = common.mark_failed(s, exc)
            log.error("FAIL %-18s %s", s.id, r.error)
        results.append(r)

    ok = [r for r in results if r.status == "ok"]
    failed = [r for r in results if r.status == "failed"]
    changed = [r for r in ok if r.changed]
    log.info(
        "done: %d ok, %d failed, %d changed", len(ok), len(failed), len(changed)
    )

    if not ok:
        log.error("every source failed — exiting non-zero")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
