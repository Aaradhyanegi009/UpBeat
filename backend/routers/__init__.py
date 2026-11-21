"""Modular FastAPI APIRouter package, shared runtime overrides, and origin security helpers."""

import os
import re
import sys
import urllib.parse
from typing import Any, List
from fastapi import HTTPException, Request

CORS_EXPOSE_HEADERS: List[str] = [
    "Content-Range",
    "Content-Length",
    "Accept-Ranges",
    "X-Track-Duration",
    "Content-Disposition",
    "X-From-Offline-Cache",
]

_BASE_ALLOWED_ORIGINS = [
    "http://localhost",
    "https://localhost",
    "http://127.0.0.1",
    "https://127.0.0.1",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "capacitor://localhost",
    "ionic://localhost",
    "https://upbeat.app",
    "https://www.upbeat.app",
    "https://upbeat.vercel.app",
    "https://upbeat-music.vercel.app",
]


def get_allowed_origins() -> List[str]:
    """Builds strict explicit CORS origin allowlist from defaults and deployment env vars."""
    origins = list(_BASE_ALLOWED_ORIGINS)
    for env_key in ("VERCEL_URL", "VERCEL_PROJECT_PRODUCTION_URL"):
        val = (os.environ.get(env_key) or "").strip()
        if val:
            origin = val if val.startswith(("http://", "https://")) else f"https://{val}"
            if origin not in origins:
                origins.append(origin)
    extra = (os.environ.get("UPBEAT_ALLOWED_ORIGINS") or "").strip()
    if extra:
        for item in extra.split(","):
            clean = item.strip().rstrip("/")
            if clean and clean != "*" and clean not in origins:
                origins.append(clean)
    return origins


ALLOWED_ORIGIN_REGEX = (
    r"^(?:"
    r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?"
    r"|https?://(?:192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{1,5})?"
    r"|(?:capacitor|ionic)://localhost"
    r")$"
)
_ALLOWED_ORIGIN_RE = re.compile(ALLOWED_ORIGIN_REGEX, re.IGNORECASE)
_LOOPBACK_CLIENTS = {"127.0.0.1", "::1", "localhost", "testclient"}


def is_allowed_origin(origin: str) -> bool:
    """Returns True only when origin matches an explicit UpBeat/local/LAN origin."""
    clean = str(origin or "").strip().rstrip("/")
    if not clean or clean.lower() == "null":
        return False
    if clean in get_allowed_origins():
        return True
    return bool(_ALLOWED_ORIGIN_RE.match(clean))


def require_local_origin(request: Request, require_loopback: bool = False) -> None:
    """
    Blocks untrusted cross-origin or remote requests to sensitive local desktop/Safari routes.
    Allows same-origin, Electron/Capacitor, localhost/LAN origins, and FastAPI TestClient.
    """
    if require_loopback:
        client_host = (request.client.host if request.client else "") or ""
        if client_host not in _LOOPBACK_CLIENTS:
            raise HTTPException(status_code=403, detail="Local loopback access required")

    origin = request.headers.get("origin")
    if origin is not None:
        if not is_allowed_origin(origin):
            raise HTTPException(status_code=403, detail="Forbidden origin")
        return

    referer = request.headers.get("referer")
    if referer:
        parsed = urllib.parse.urlparse(referer)
        ref_origin = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
        if not is_allowed_origin(ref_origin):
            raise HTTPException(status_code=403, detail="Forbidden referer")

    fetch_site = (request.headers.get("sec-fetch-site") or "").strip().lower()
    if fetch_site == "cross-site":
        raise HTTPException(status_code=403, detail="Cross-site request blocked")


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
