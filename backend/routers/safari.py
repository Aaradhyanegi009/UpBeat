"""Safari Companion bridge and backend status routes."""

from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

try:
    from safari_bridge import (
        control_safari,
        extract_all_safari_yt_tracks,
        get_safari_now_playing,
        get_safari_youtube_profile,
        list_safari_tabs,
        open_safari_url,
    )
except ImportError:
    from backend.safari_bridge import (
        control_safari,
        extract_all_safari_yt_tracks,
        get_safari_now_playing,
        get_safari_youtube_profile,
        list_safari_tabs,
        open_safari_url,
    )

router = APIRouter()


class SafariOpenRequest(BaseModel):
    destination: str = Field("yt_liked", description="music, music_liked, yt_liked, yt_history, custom")
    custom_url: Optional[str] = None


class SafariExtractRequest(BaseModel):
    window_idx: Optional[int] = None
    tab_idx: Optional[int] = None


class SafariControlRequest(BaseModel):
    action: str = Field("play_pause", description="play_pause, next, prev")
    window_idx: Optional[int] = None
    tab_idx: Optional[int] = None


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
def get_safari_tabs():
    """Lists open Safari tabs and highlights active YouTube / YouTube Music tabs."""
    tabs = list_safari_tabs(use_cache=True)
    yt_tabs = [t for t in tabs if t.get("is_yt")]
    return {
        "tabs": tabs,
        "yt_tabs": yt_tabs,
        "has_yt": len(yt_tabs) > 0,
    }


@router.post("/api/safari/open")
def open_in_safari(req: SafariOpenRequest):
    """Opens a YouTube / YouTube Music URL in Safari for easy library access."""
    url_map = {
        "music": "https://music.youtube.com",
        "music_liked": "https://music.youtube.com/playlist?list=LM",
        "yt_liked": "https://www.youtube.com/playlist?list=LL",
        "yt_history": "https://www.youtube.com/feed/history",
    }
    target_url = req.custom_url or url_map.get(req.destination, "https://www.youtube.com/playlist?list=LL")
    return open_safari_url(target_url)


@router.post("/api/safari/extract")
def extract_safari_data(req: SafariExtractRequest):
    """Extracts music tracks from the specified or active Safari YouTube tab."""
    result = extract_all_safari_yt_tracks(req.window_idx, req.tab_idx)
    if result.get("error") and not result.get("tracks"):
        raise HTTPException(
            status_code=404,
            detail=result["error"],
        )
    return result


@router.get("/api/safari/now-playing")
def get_now_playing():
    """Reads currently playing YouTube Music / YouTube track state from Safari."""
    np = get_safari_now_playing()
    return {"now_playing": np}


@router.get("/api/safari/profile")
def get_safari_profile():
    """Reads the signed-in YouTube channel profile info from Safari when open."""
    return get_safari_youtube_profile()


@router.post("/api/safari/control")
def send_control(req: SafariControlRequest):
    """Sends play/pause, next, or prev commands to Safari's active YouTube player."""
    return control_safari(req.action, req.window_idx, req.tab_idx)
