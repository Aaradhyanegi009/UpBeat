"""UpBeat Music Studio FastAPI entry point composing modular API routers."""

import json
import os
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

try:
    from curator import analyze_taste_dna, curate_playlist
    from favorites_store import get_favorites, toggle_favorite
    from routers.music import (
        CurateRequest,
        ResolveBatchRequest,
        TasteDnaRequest,
        router as music_router,
    )
    from routers.offline import (
        DOWNLOADS_DIR,
        DOWNLOADS_META_FILE,
        FavoriteTrackRequest,
        IS_VERCEL,
        router as offline_router,
    )
    from routers.safari import (
        SafariControlRequest,
        SafariExtractRequest,
        SafariOpenRequest,
        router as safari_router,
    )
    from routers.social import (
        JamRoomSendRequest,
        PROFILE_FILE,
        SocialPollRequest,
        SocialSendRequest,
        _JAM_ROOMS,
        _SOCIAL_MAILBOX,
        _SOCIAL_PRESENCE,
        router as social_router,
    )
    from safari_bridge import (
        control_safari,
        extract_all_safari_yt_tracks,
        get_safari_now_playing,
        get_safari_youtube_profile,
        list_safari_tabs,
        open_safari_url,
    )
    from youtube_search import (
        _resolve_cloud_fallback_audio,
        browse_youtube_music_playlist,
        direct_search_youtube_music,
        format_seconds,
        get_audio_stream_url,
        is_valid_music_track,
        resolve_tracks_batch,
        search_youtube_single,
    )
except ImportError:
    from backend.curator import analyze_taste_dna, curate_playlist
    from backend.favorites_store import get_favorites, toggle_favorite
    from backend.routers.music import (
        CurateRequest,
        ResolveBatchRequest,
        TasteDnaRequest,
        router as music_router,
    )
    from backend.routers.offline import (
        DOWNLOADS_DIR,
        DOWNLOADS_META_FILE,
        FavoriteTrackRequest,
        IS_VERCEL,
        router as offline_router,
    )
    from backend.routers.safari import (
        SafariControlRequest,
        SafariExtractRequest,
        SafariOpenRequest,
        router as safari_router,
    )
    from backend.routers.social import (
        JamRoomSendRequest,
        PROFILE_FILE,
        SocialPollRequest,
        SocialSendRequest,
        _JAM_ROOMS,
        _SOCIAL_MAILBOX,
        _SOCIAL_PRESENCE,
        router as social_router,
    )
    from backend.safari_bridge import (
        control_safari,
        extract_all_safari_yt_tracks,
        get_safari_now_playing,
        get_safari_youtube_profile,
        list_safari_tabs,
        open_safari_url,
    )
    from backend.youtube_search import (
        _resolve_cloud_fallback_audio,
        browse_youtube_music_playlist,
        direct_search_youtube_music,
        format_seconds,
        get_audio_stream_url,
        is_valid_music_track,
        resolve_tracks_batch,
        search_youtube_single,
    )


def _resolve_app_version() -> str:
    """Reads canonical app version from synced music_filters.json or root package.json."""
    filters_path = os.path.join(os.path.dirname(__file__), "music_filters.json")
    try:
        with open(filters_path, "r", encoding="utf-8") as f:
            ver = json.load(f).get("app_version")
            if ver:
                return str(ver)
    except Exception:
        pass
    pkg_path = os.path.join(os.path.dirname(__file__), "..", "package.json")
    try:
        with open(pkg_path, "r", encoding="utf-8") as f:
            ver = json.load(f).get("version")
            if ver:
                return str(ver)
    except Exception:
        pass
    return "7.6.1"


APP_VERSION = _resolve_app_version()

app = FastAPI(
    title="UpBeat Music API",
    version=APP_VERSION,
    description=f"UpBeat v{APP_VERSION} - Modular Music Studio Backend",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def ensure_api_prefix(request: Request, call_next):
    """Normalizes stripped /api prefixes when deployed inside Vercel Multi-Services."""
    if os.environ.get("VERCEL") or os.environ.get("VERCEL_ENV"):
        path = request.scope.get("path", "")
        if path and not path.startswith("/api") and path not in ("/docs", "/openapi.json", "/redoc"):
            request.scope["path"] = f"/api{path if path.startswith('/') else '/' + path}"
    return await call_next(request)


app.include_router(safari_router)
app.include_router(music_router)
app.include_router(offline_router)
app.include_router(social_router)

frontend_dist = os.path.join(os.path.dirname(__file__), "../frontend/dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
