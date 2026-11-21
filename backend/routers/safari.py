"""Safari Companion bridge and backend status routes."""

from typing import Literal, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

try:
    from routers import require_local_origin, resolve_main_attr
    from safari_bridge import (
        control_safari,
        extract_all_safari_yt_tracks,
        get_safari_now_playing,
        get_safari_youtube_profile,
        list_safari_tabs,
        open_safari_url,
        validate_youtube_url,
    )
except ImportError:
    from backend.routers import require_local_origin, resolve_main_attr
    from backend.safari_bridge import (
        control_safari,
        extract_all_safari_yt_tracks,
        get_safari_now_playing,
        get_safari_youtube_profile,
        list_safari_tabs,
        open_safari_url,
        validate_youtube_url,
    )

router = APIRouter()


class SafariOpenRequest(BaseModel):
    destination: str = Field("yt_liked", description="music, music_liked, yt_liked, yt_history, custom")
    custom_url: Optional[str] = None


class SafariExtractRequest(BaseModel):
    window_idx: Optional[int] = Field(None, ge=1)
    tab_idx: Optional[int] = Field(None, ge=1)


class SafariControlRequest(BaseModel):
    action: Literal["play_pause", "next", "prev"] = Field("play_pause", description="play_pause, next, prev")
    window_idx: Optional[int] = Field(None, ge=1)
    tab_idx: Optional[int] = Field(None, ge=1)


@router.get("/api/status")
def get_status():
    """Returns backend readiness and available Gemini curator model list."""
    return {
        "status": "online",
        "app": "UpBeat",
        "models": [
            {"id": "gemini-4-argon", "name": "Gemini 4 Argon (⚡ 1s Fastest)", "recommended": True},
            {"id": "gemini-3.1-flash-lite", "name": "Gemini 3.1 Flash Lite (2s Fast)", "recommended": False},
            {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (Active)", "recommended": False},
            {"id": "gemini-flash-lite-latest", "name": "Gemini Flash Lite Latest", "recommended": False},
            {"id": "gemini-3-flash-preview", "name": "Gemini 3 Flash Preview", "recommended": False},
            {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "recommended": False},
            {"id": "gemma-4-26b-a4b-it", "name": "Gemma 4 26B MoE", "recommended": False},
            {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash (Legacy)", "recommended": False},
        ],
    }


@router.get("/api/safari/tabs")
def get_safari_tabs(request: Request):
    """Lists open Safari tabs and highlights active YouTube / YouTube Music tabs."""
    require_local_origin(request)
    fn = resolve_main_attr("list_safari_tabs", list_safari_tabs)
    tabs = fn(use_cache=True)
    yt_tabs = [t for t in tabs if t.get("is_yt")]
    return {
        "tabs": tabs,
        "yt_tabs": yt_tabs,
        "has_yt": len(yt_tabs) > 0,
    }


@router.post("/api/safari/open")
def open_in_safari(req: SafariOpenRequest, request: Request):
    """Opens a validated YouTube / YouTube Music URL in Safari for easy library access."""
    require_local_origin(request)
    url_map = {
        "music": "https://music.youtube.com",
        "music_liked": "https://music.youtube.com/playlist?list=LM",
        "yt_liked": "https://www.youtube.com/playlist?list=LL",
        "yt_history": "https://www.youtube.com/feed/history",
    }
    if req.destination == "custom":
        if not req.custom_url or not req.custom_url.strip():
            raise HTTPException(status_code=400, detail="custom_url is required when destination is custom")
        raw_target = req.custom_url
    elif req.custom_url is not None:
        raw_target = req.custom_url
    else:
        raw_target = url_map.get(req.destination, "https://www.youtube.com/playlist?list=LL")

    try:
        safe_url = validate_youtube_url(raw_target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    fn = resolve_main_attr("open_safari_url", open_safari_url)
    return fn(safe_url)


@router.post("/api/safari/extract")
def extract_safari_data(req: SafariExtractRequest, request: Request):
    """Extracts music tracks from the specified or active Safari YouTube tab."""
    require_local_origin(request)
    fn = resolve_main_attr("extract_all_safari_yt_tracks", extract_all_safari_yt_tracks)
    result = fn(req.window_idx, req.tab_idx)
    if result.get("error") and not result.get("tracks"):
        raise HTTPException(
            status_code=404,
            detail=result["error"],
        )
    return result


@router.get("/api/safari/now-playing")
def get_now_playing(request: Request):
    """Reads currently playing YouTube Music / YouTube track state from Safari."""
    require_local_origin(request)
    fn = resolve_main_attr("get_safari_now_playing", get_safari_now_playing)
    np = fn()
    return {"now_playing": np}


@router.get("/api/safari/profile")
def get_safari_profile(request: Request):
    """Reads the signed-in YouTube channel profile info from Safari when open."""
    require_local_origin(request)
    fn = resolve_main_attr("get_safari_youtube_profile", get_safari_youtube_profile)
    return fn()


@router.post("/api/safari/control")
def send_control(req: SafariControlRequest, request: Request):
    """Sends play/pause, next, or prev commands to Safari's active YouTube player."""
    require_local_origin(request)
    fn = resolve_main_attr("control_safari", control_safari)
    return fn(req.action, req.window_idx, req.tab_idx)
