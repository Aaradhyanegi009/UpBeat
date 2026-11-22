"""Music discovery, search, AI curation, lyrics proxy, and stream metadata routes."""

import asyncio
from collections import OrderedDict
import copy
import json
import math
import os
import sys
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple, Union
import requests as ext_requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field

try:
    from curator import analyze_taste_dna, curate_playlist
    from routers import resolve_main_attr
    from safari_bridge import extract_all_safari_yt_tracks
    from youtube_search import (
        VIDEO_ID_REGEX,
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
    from backend.routers import resolve_main_attr
    from backend.safari_bridge import extract_all_safari_yt_tracks
    from backend.youtube_search import (
        VIDEO_ID_REGEX,
        browse_youtube_music_playlist,
        direct_search_youtube_music,
        format_seconds,
        get_audio_stream_url,
        is_valid_music_track,
        resolve_tracks_batch,
        search_youtube_single,
    )

router = APIRouter()

ALLOWED_INNERTUBE_ENDPOINTS = frozenset({"search", "browse", "next", "player"})
ALLOWED_INNERTUBE_SERVICES = frozenset({"music", "youtube"})


def _get_app_version() -> str:
    filters_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "music_filters.json")
    try:
        with open(filters_path, "r", encoding="utf-8") as f:
            ver = json.load(f).get("app_version")
            if ver:
                return str(ver)
    except Exception:
        pass
    return "7.7.0"


_APP_VERSION = _get_app_version()


class CurateRequest(BaseModel):
    seed_tracks: List[Dict[str, Any]] = Field(default_factory=list)
    mood_prompt: str = Field("Focused late night session")
    energy_level: int = Field(78, ge=0, le=100)
    count: int = Field(20, ge=3, le=50)
    model_name: str = Field("gemini-4-argon")


class TasteDnaRequest(BaseModel):
    tracks: List[Dict[str, Any]] = Field(default_factory=list)
    model_name: str = Field("gemini-4-argon")


class ResolveBatchRequest(BaseModel):
    tracks: List[Dict[str, Any]] = Field(default_factory=list)


@router.post("/api/taste-dna")
def get_taste_profile(req: TasteDnaRequest):
    """Generates a structured sonic DNA profile from seed tracks."""
    fn = resolve_main_attr("analyze_taste_dna", analyze_taste_dna)
    return fn(req.tracks, model_name=req.model_name)


@router.post("/api/curate")
def generate_playlist(req: CurateRequest):
    """Curates a personalized playlist using Gemini + Safari/seed tracks and resolves playback IDs."""
    try:
        curate_fn = resolve_main_attr("curate_playlist", curate_playlist)
        resolve_fn = resolve_main_attr("resolve_tracks_batch", resolve_tracks_batch)
        extract_fn = resolve_main_attr("extract_all_safari_yt_tracks", extract_all_safari_yt_tracks)

        seeds = [t for t in (req.seed_tracks or []) if is_valid_music_track(t)]
        if not seeds and sys.platform == "darwin" and not os.environ.get("VERCEL"):
            extracted = extract_fn()
            seeds = [t for t in extracted.get("tracks", []) if is_valid_music_track(t)]

        playlist_data = curate_fn(
            seed_tracks=seeds,
            mood_prompt=req.mood_prompt,
            energy_level=req.energy_level,
            count=req.count,
            model_name=req.model_name,
        )

        tracks = playlist_data.get("tracks", [])
        if tracks:
            playlist_data["tracks"] = resolve_fn(tracks)

        return playlist_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/search")
def search_track(q: str):
    """Resolves a single query into the closest verified music track."""
    fn = resolve_main_attr("search_youtube_single", search_youtube_single)
    res = fn(q)
    if not res:
        raise HTTPException(status_code=404, detail="Track not found")
    return res


@router.get("/api/direct-search")
def direct_search_endpoint(q: str, mode: str = "auto"):
    """Zero-token direct YouTube Music lookup for both prepared playlists and songs."""
    fn = resolve_main_attr("direct_search_youtube_music", direct_search_youtube_music)
    return fn(q, mode=mode)


@router.get("/api/playlist-browse")
def playlist_browse_endpoint(browse_id: str, title: str = "", subtitle: str = ""):
    """Fetches tracks inside a prepared YouTube Music playlist (0 AI tokens)."""
    fn = resolve_main_attr("browse_youtube_music_playlist", browse_youtube_music_playlist)
    tracks = fn(browse_id, playlist_title=title, playlist_subtitle=subtitle)
    return {
        "browse_id": browse_id,
        "title": title,
        "subtitle": subtitle,
        "tracks": tracks,
    }


@router.post("/api/resolve-batch")
def resolve_batch_endpoint(req: ResolveBatchRequest):
    """Batch-resolves track metadata and video IDs in parallel."""
    fn = resolve_main_attr("resolve_tracks_batch", resolve_tracks_batch)
    return {"tracks": fn(req.tracks)}


@router.post("/api/innertube")
async def innertube_proxy_endpoint(request: Request):
    """Proxies allowlisted YouTube / YouTube Music Innertube API requests without blocking the event loop."""
    try:
        data = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    if not isinstance(data, dict):
        raise HTTPException(status_code=400, detail="Payload must be a JSON object")

    endpoint = str(data.get("endpoint") or "").strip()
    if endpoint not in ALLOWED_INNERTUBE_ENDPOINTS:
        raise HTTPException(status_code=400, detail="Unsupported Innertube endpoint")

    service = str(data.get("service") or "music").strip()
    if service not in ALLOWED_INNERTUBE_SERVICES:
        raise HTTPException(status_code=400, detail="Unsupported Innertube service")

    body = data.get("body", {})
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Innertube request body must be a JSON object")

    host = "https://www.youtube.com" if service == "youtube" else "https://music.youtube.com"
    target_url = f"{host}/youtubei/v1/{endpoint}?prettyPrint=false"
    headers = {
        "Content-Type": "application/json",
        "User-Agent": (
            "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) "
            "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"
        ),
        "Referer": host,
    }

    try:
        resp = await asyncio.to_thread(
            ext_requests.post,
            target_url,
            json=body,
            headers=headers,
            timeout=15,
        )
        return Response(content=resp.content, status_code=resp.status_code, media_type="application/json")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/api/audio-info", operation_id="audio_info_query_get")
def audio_info_query_endpoint(
    id: str = "",
    video_id: str = "",
    title: str = "",
    artist: str = "",
    expected_duration: int = 0,
):
    """Query-parameter alias (/api/audio-info?id=...) matching Edge audio-info handler."""
    return audio_info_endpoint(
        id or video_id,
        title=title,
        artist=artist,
        expected_duration=expected_duration,
    )


@router.get("/api/audio-info/{video_id}")
def audio_info_endpoint(video_id: str, title: str = "", artist: str = "", expected_duration: int = 0):
    """Resolves stream availability and returns canonical proxy streaming metadata."""
    clean_id = (video_id or "").strip()
    if not VIDEO_ID_REGEX.match(clean_id):
        raise HTTPException(status_code=400, detail="Invalid 11-character YouTube video ID")

    fn = resolve_main_attr("get_audio_stream_url", get_audio_stream_url)
    info = fn(clean_id, title=title, artist=artist, expected_duration=expected_duration)
    if not info or not info.get("url"):
        raise HTTPException(status_code=404, detail="Audio stream unavailable")
    dur_sec = int(info.get("duration") or 0)
    resolved_id = info.get("video_id") or clean_id
    q_params = []
    if title:
        q_params.append(f"title={urllib.parse.quote(title)}")
    if artist:
        q_params.append(f"artist={urllib.parse.quote(artist)}")
    if expected_duration:
        q_params.append(f"expected_duration={expected_duration}")
    qs = f"?{'&'.join(q_params)}" if q_params else ""
    return {
        "video_id": resolved_id,
        "resolved_video_id": resolved_id,
        "original_video_id": clean_id,
        "duration": dur_sec,
        "duration_text": format_seconds(dur_sec),
        "url": f"/api/audio/{clean_id}{qs}",
        "title": info.get("title", ""),
        "artist": info.get("uploader", ""),
    }


LYRICS_CACHE_HIT_TTL_SEC = 6 * 3600
LYRICS_CACHE_MISS_TTL_SEC = 5 * 60
LYRICS_CACHE_MAX_ENTRIES = 500
_LYRICS_CACHE_LOCK = threading.Lock()
_LYRICS_CACHE: "OrderedDict[Tuple[str, str, str, int], Tuple[float, List[Dict[str, Any]]]]" = OrderedDict()


def clear_lyrics_cache() -> None:
    """Clears the in-memory LRCLIB lyrics TTL cache."""
    with _LYRICS_CACHE_LOCK:
        _LYRICS_CACHE.clear()


def _parse_duration_sec(duration: Any) -> int:
    if duration in (None, ""):
        return 0
    try:
        val = float(duration)
    except (TypeError, ValueError):
        return 0
    if not math.isfinite(val) or val <= 15:
        return 0
    return int(round(val))


def _get_cached_lyrics(cache_key: Tuple[str, str, str, int]) -> Optional[List[Dict[str, Any]]]:
    now = time.time()
    with _LYRICS_CACHE_LOCK:
        entry = _LYRICS_CACHE.get(cache_key)
        if entry is None:
            return None
        expires_at, payload = entry
        if expires_at <= now:
            _LYRICS_CACHE.pop(cache_key, None)
            return None
        _LYRICS_CACHE.move_to_end(cache_key)
        return copy.deepcopy(payload)


def _set_cached_lyrics(cache_key: Tuple[str, str, str, int], payload: List[Dict[str, Any]], ttl_sec: float) -> None:
    now = time.time()
    expires_at = now + ttl_sec
    stored = copy.deepcopy(payload)
    with _LYRICS_CACHE_LOCK:
        if len(_LYRICS_CACHE) >= LYRICS_CACHE_MAX_ENTRIES:
            expired_keys = [k for k, (exp, _) in _LYRICS_CACHE.items() if exp <= now]
            for k in expired_keys:
                _LYRICS_CACHE.pop(k, None)
        _LYRICS_CACHE[cache_key] = (expires_at, stored)
        _LYRICS_CACHE.move_to_end(cache_key)
        while len(_LYRICS_CACHE) > LYRICS_CACHE_MAX_ENTRIES:
            _LYRICS_CACHE.popitem(last=False)


@router.get("/api/lyrics")
def search_lyrics_endpoint(
    q: str = "",
    track_name: str = "",
    artist_name: str = "",
    duration: Union[float, int, str, None] = None,
):
    """Server-side proxy for LRCLIB /api/get duration-matched lookup and /api/search with bounded TTL caching."""
    clean_q = (q or "").strip()
    clean_track = (track_name or "").strip()
    clean_artist = (artist_name or "").strip()
    dur_int = _parse_duration_sec(duration)

    if not (clean_q or clean_track or clean_artist):
        return []

    cache_key = (clean_q.lower(), clean_track.lower(), clean_artist.lower(), dur_int)
    cached = _get_cached_lyrics(cache_key)
    if cached is not None:
        return cached

    headers = {"User-Agent": f"UpBeat/{_APP_VERSION} (https://upbeat.app)"}

    if clean_track and clean_artist:
        get_params: Dict[str, Any] = {
            "track_name": clean_track,
            "artist_name": clean_artist,
        }
        if dur_int > 15:
            get_params["duration"] = dur_int
        try:
            r_get = ext_requests.get("https://lrclib.net/api/get", params=get_params, headers=headers, timeout=8)
            if r_get.status_code == 200:
                get_data = r_get.json()
                if isinstance(get_data, dict) and (get_data.get("syncedLyrics") or get_data.get("plainLyrics")):
                    wrapped = [get_data]
                    _set_cached_lyrics(cache_key, wrapped, LYRICS_CACHE_HIT_TTL_SEC)
                    return wrapped
        except Exception as e:
            print(f"Lyrics /api/get proxy error: {e}")

    params: Dict[str, str] = {}
    if clean_q:
        params["q"] = clean_q
    if clean_track:
        params["track_name"] = clean_track
    if clean_artist:
        params["artist_name"] = clean_artist

    try:
        r = ext_requests.get("https://lrclib.net/api/search", params=params, headers=headers, timeout=8)
        if r.status_code == 200:
            data = r.json()
            normalized = data if isinstance(data, list) else []
            ttl = LYRICS_CACHE_HIT_TTL_SEC if normalized else LYRICS_CACHE_MISS_TTL_SEC
            _set_cached_lyrics(cache_key, normalized, ttl)
            return normalized
        if r.status_code == 404:
            _set_cached_lyrics(cache_key, [], LYRICS_CACHE_MISS_TTL_SEC)
    except Exception as e:
        print(f"Lyrics proxy error: {e}")
    return []
