"""Modular FastAPI APIRouter package and shared runtime override lookup."""

import sys
from typing import Any


def resolve_main_attr(name: str, default: Any) -> Any:
    """
    Resolves patchable attributes from the active main module when loaded
    (supporting monkeypatching/TestClient overrides in unit tests).
    """
    for mod_name in ("backend.main", "main"):
        mod = sys.modules.get(mod_name)
        if mod is not None and hasattr(mod, name):
            return getattr(mod, name)
    return default
