"""Compatibility shim — scoring moved to pipeline/ for Dashboard 2.0.
The Streamlit app keeps importing app.scoring until it is retired."""
from pipeline.scoring import *  # noqa: F401,F403
from pipeline.scoring import _build_tile  # noqa: F401  (used by streamlit_app)
