import os
import re
import json
import time
import unicodedata
import urllib.parse
from typing import Dict, List, Any, Optional
import requests as ext_requests
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.safari_bridge import (
    list_safari_tabs,
    open_safari_url,
    extract_all_safari_yt_tracks,
    get_safari_now_playing,
    control_safari,
    get_safari_youtube_profile,
)
from backend.curator import analyze_taste_dna, curate_playlist
from backend.youtube_search import (
    resolve_tracks_batch,
    search_youtube_single,
    get_audio_stream_url,
    direct_search_youtube_music,
    browse_youtube_music_playlist,
    format_seconds,
)
from backend.favorites_store import get_favorites, toggle_favorite

app = FastAPI(
    title="UpBeat Music API",
    version="4.4.7.1",
    description="UpBeat v4.4.7.1 - Offline Music & AI Studio"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


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


class CurateRequest(BaseModel):
    seed_tracks: List[Dict[str, Any]] = Field(default_factory=list)
    mood_prompt: str = Field("Focused late night session")
    energy_level: int = Field(78, ge=0, le=100)
    count: int = Field(8, ge=3, le=25)
    model_name: str = Field("gemini-4-argon")


class TasteDnaRequest(BaseModel):
    tracks: List[Dict[str, Any]] = Field(default_factory=list)
    model_name: str = Field("gemini-4-argon")


@app.get("/api/status")
def get_status():
    return {
        "status": "online",
        "app": "UpBeat",
        "models": [
            {"id": "gemini-4-argon", "name": "Gemini 4 Argon (⚡ 1s Fastest)", "recommended": True},
            {"id": "gemini-3.8-flash", "name": "Gemini 3.8 Flash (Active)", "recommended": False},
            {"id": "gemini-3.1-flash-lite", "name": "Gemini 3.1 Flash Lite (2s Fast)", "recommended": False},
            {"id": "gemini-3.5-flash-lite", "name": "Gemini 3.5 Flash Lite (Active)", "recommended": False},
            {"id": "gemini-flash-lite-latest", "name": "Gemini Flash Lite Latest", "recommended": False},
            {"id": "gemini-3-flash-preview", "name": "Gemini 3 Flash Preview", "recommended": False},
            {"id": "gemini-2.5-flash", "name": "Gemini 2.5 Flash", "recommended": False},
            {"id": "gemma-4-26b-a4b-it", "name": "Gemma 4 26B MoE", "recommended": False},
        ],
    }


@app.get("/api/safari/tabs")
def get_safari_tabs():
    tabs = list_safari_tabs(use_cache=True)
    yt_tabs = [t for t in tabs if t.get("is_yt")]
    return {
        "tabs": tabs,
        "yt_tabs": yt_tabs,
        "has_yt": len(yt_tabs) > 0,
    }


@app.post("/api/safari/open")
def open_in_safari(req: SafariOpenRequest):
    url_map = {
        "music": "https://music.youtube.com",
        "music_liked": "https://music.youtube.com/playlist?list=LM",
        "yt_liked": "https://www.youtube.com/playlist?list=LL",
        "yt_history": "https://www.youtube.com/feed/history",
    }
    target_url = req.custom_url or url_map.get(req.destination, "https://www.youtube.com/playlist?list=LL")
    return open_safari_url(target_url)


@app.post("/api/safari/extract")
def extract_safari_data(req: SafariExtractRequest):
    result = extract_all_safari_yt_tracks(req.window_idx, req.tab_idx)
    if result.get("error") and not result.get("tracks"):
        raise HTTPException(
            status_code=404,
            detail=result["error"],
        )
    return result


@app.get("/api/safari/now-playing")
def get_now_playing():
    np = get_safari_now_playing()
    return {"now_playing": np}


@app.get("/api/safari/profile")
def get_safari_profile():
    return get_safari_youtube_profile()



@app.post("/api/safari/control")
def send_control(req: SafariControlRequest):
    return control_safari(req.action, req.window_idx, req.tab_idx)


@app.post("/api/taste-dna")
def get_taste_profile(req: TasteDnaRequest):
    return analyze_taste_dna(req.tracks, model_name=req.model_name)


@app.post("/api/curate")
def generate_playlist(req: CurateRequest):
    try:
        # Auto-pull from Safari if seed_tracks is empty and Safari has YT open
        seeds = req.seed_tracks
        if not seeds:
            extracted = extract_all_safari_yt_tracks()
            seeds = extracted.get("tracks", [])

        playlist_data = curate_playlist(
            seed_tracks=seeds,
            mood_prompt=req.mood_prompt,
            energy_level=req.energy_level,
            count=req.count,
            model_name=req.model_name,
        )

        tracks = playlist_data.get("tracks", [])
        if tracks:
            playlist_data["tracks"] = resolve_tracks_batch(tracks)

        return playlist_data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/search")
def search_track(q: str):
    res = search_youtube_single(q)
    if not res:
        raise HTTPException(status_code=404, detail="Track not found")
    return res


@app.get("/api/direct-search")
def direct_search_endpoint(q: str, mode: str = "auto"):
    """Zero-token direct YouTube Music lookup for both prepared playlists and songs."""
    return direct_search_youtube_music(q, mode=mode)


@app.get("/api/playlist-browse")
def playlist_browse_endpoint(browse_id: str, title: str = "", subtitle: str = ""):
    """Fetches tracks inside a prepared YouTube Music playlist (0 AI tokens)."""
    tracks = browse_youtube_music_playlist(browse_id, playlist_title=title, playlist_subtitle=subtitle)
    return {
        "browse_id": browse_id,
        "title": title,
        "subtitle": subtitle,
        "tracks": tracks,
    }


class ResolveBatchRequest(BaseModel):
    tracks: List[Dict[str, Any]] = Field(default_factory=list)


@app.post("/api/resolve-batch")
def resolve_batch_endpoint(req: ResolveBatchRequest):
    return {"tracks": resolve_tracks_batch(req.tracks)}


class FavoriteTrackRequest(BaseModel):
    track: Dict[str, Any]


@app.get("/api/favorites")
def list_favorites():
    return {"favorites": get_favorites()}


@app.post("/api/favorites/toggle")
def toggle_favorite_endpoint(req: FavoriteTrackRequest):
    return toggle_favorite(req.track)


@app.get("/api/audio-info/{video_id}")
def audio_info_endpoint(video_id: str):
    info = get_audio_stream_url(video_id)
    if not info or not info.get("url"):
        raise HTTPException(status_code=404, detail="Audio stream unavailable")
    dur_sec = int(info.get("duration") or 0)
    return {
        "video_id": video_id,
        "duration": dur_sec,
        "duration_text": format_seconds(dur_sec),
        "url": f"/api/audio/{video_id}",
        "title": info.get("title", ""),
        "artist": info.get("uploader", ""),
    }


DOWNLOADS_DIR = os.path.join(os.path.dirname(__file__), "data", "downloads")
DOWNLOADS_META_FILE = os.path.join(os.path.dirname(__file__), "data", "downloads.json")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)


def _load_downloads_meta() -> List[Dict[str, Any]]:
    if not os.path.exists(DOWNLOADS_META_FILE):
        return []
    try:
        with open(DOWNLOADS_META_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return []


def _save_download_meta(track_info: Dict[str, Any]):
    items = _load_downloads_meta()
    items = [x for x in items if x.get("video_id") != track_info.get("video_id")]
    items.insert(0, track_info)
    try:
        with open(DOWNLOADS_META_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error saving download metadata: {e}")


def _delete_download_meta(video_id: str):
    items = _load_downloads_meta()
    items = [x for x in items if x.get("video_id") != video_id]
    try:
        with open(DOWNLOADS_META_FILE, "w", encoding="utf-8") as f:
            json.dump(items, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(f"Error deleting download metadata: {e}")


def _stream_local_file(filepath: str, start: int = 0, end: Optional[int] = None, chunk_size: int = 65536):
    with open(filepath, "rb") as f:
        f.seek(start)
        pos = start
        while end is None or pos <= end:
            read_len = min(chunk_size, end - pos + 1) if end is not None else chunk_size
            data = f.read(read_len)
            if not data:
                break
            pos += len(data)
            yield data


_STREAM_HTTP_SESSION = ext_requests.Session()
_STREAM_HTTP_SESSION.mount(
    "https://",
    ext_requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16, max_retries=2),
)
_STREAM_CHUNK_BYTES = 1024 * 1024  # 1 MB bounded ranges for stable streaming


@app.api_route("/api/audio/{video_id}", methods=["GET", "HEAD"])
def stream_audio_endpoint(video_id: str, request: Request):
    """
    Streams the exact official audio track (m4a/mp4).
    If the track has been downloaded locally, streams instantly from disk with zero network latency.
    Otherwise fetches upstream from YouTube in bounded 1 MB Range chunks.
    """
    local_path = os.path.join(DOWNLOADS_DIR, f"{video_id}.m4a")
    if os.path.exists(local_path):
        file_size = os.path.getsize(local_path)
        range_header = request.headers.get("range") or request.headers.get("Range")
        start = 0
        end = file_size - 1
        is_partial = False

        if range_header and range_header.strip().lower().startswith("bytes="):
            is_partial = True
            spec = range_header.strip()[6:].split(",")[0].strip()
            parts = spec.split("-", 1)
            if parts[0]:
                start = int(parts[0])
                if len(parts) > 1 and parts[1]:
                    end = int(parts[1])
            elif len(parts) > 1 and parts[1]:
                suffix = int(parts[1])
                start = max(0, file_size - suffix)

        end = min(end, file_size - 1)
        content_len = max(0, end - start + 1)
        status_code = 206 if (is_partial or file_size > 0) else 200

        headers = {
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_len),
            "Content-Type": "audio/mp4",
            "Cache-Control": "public, max-age=86400",
            "X-From-Offline-Cache": "true",
        }
        if status_code == 206:
            headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

        if request.method == "HEAD":
            return Response(status_code=status_code, headers=headers)

        return StreamingResponse(
            _stream_local_file(local_path, start, end),
            status_code=status_code,
            media_type="audio/mp4",
            headers=headers,
        )

    info = get_audio_stream_url(video_id)
    if not info or not info.get("url"):
        raise HTTPException(status_code=404, detail="Audio stream unavailable")

    stream_url = info["url"]
    ua = info.get(
        "ua",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    )
    total_size = int(info.get("clen") or 0)

    # If total_size wasn't in metadata, probe the first 2 bytes to discover Content-Range total
    if total_size <= 0:
        probe = _STREAM_HTTP_SESSION.get(
            stream_url,
            headers={"User-Agent": ua, "Range": "bytes=0-1"},
            stream=True,
            timeout=10,
        )
        cr = probe.headers.get("Content-Range", "")
        probe.close()
        if "/" in cr:
            try:
                total_size = int(cr.split("/")[-1])
                info["clen"] = total_size
            except ValueError:
                total_size = 0

    range_header = request.headers.get("range") or request.headers.get("Range")
    start = 0
    end = (total_size - 1) if total_size > 0 else None
    is_partial = False

    if range_header and range_header.strip().lower().startswith("bytes="):
        is_partial = True
        spec = range_header.strip()[6:].split(",")[0].strip()
        parts = spec.split("-", 1)
        if parts[0]:
            start = int(parts[0])
            if len(parts) > 1 and parts[1]:
                end = int(parts[1])
        elif len(parts) > 1 and parts[1] and total_size > 0:
            suffix = int(parts[1])
            start = max(0, total_size - suffix)
            end = total_size - 1

    if total_size > 0 and (end is None or end >= total_size):
        end = total_size - 1

    resp_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
    }
    if info.get("duration"):
        resp_headers["X-Track-Duration"] = str(info["duration"])
    status_code = 206 if (is_partial or total_size > 0) else 200
    if total_size > 0 and end is not None:
        content_len = max(0, end - start + 1)
        resp_headers["Content-Length"] = str(content_len)
        if status_code == 206:
            resp_headers["Content-Range"] = f"bytes {start}-{end}/{total_size}"

    if request.method == "HEAD":
        return Response(
            content=b"",
            status_code=status_code,
            media_type=info.get("mime", "audio/mp4"),
            headers=resp_headers,
        )

    def _iter_chunks():
        pos = start
        target_end = end
        while target_end is None or pos <= target_end:
            chunk_end = (
                min(pos + _STREAM_CHUNK_BYTES - 1, target_end)
                if target_end is not None
                else (pos + _STREAM_CHUNK_BYTES - 1)
            )
            r = _STREAM_HTTP_SESSION.get(
                stream_url,
                headers={"User-Agent": ua, "Range": f"bytes={pos}-{chunk_end}"},
                stream=True,
                timeout=15,
            )
            try:
                if r.status_code not in (200, 206):
                    break
                received = 0
                for piece in r.iter_content(chunk_size=65536):
                    if piece:
                        received += len(piece)
                        yield piece
                if received == 0:
                    break
                pos += received
                if target_end is None and received < _STREAM_CHUNK_BYTES:
                    break
            finally:
                r.close()

    return StreamingResponse(
        _iter_chunks(),
        status_code=status_code,
        media_type=info.get("mime", "audio/mp4"),
        headers=resp_headers,
    )


def _make_content_disposition(filename: str) -> str:
    """
    Constructs an RFC 6266 / RFC 5987 compliant Content-Disposition header.
    Guarantees the legacy 'filename=' parameter is 100% ASCII-safe (preventing
    Starlette latin-1 UnicodeEncodeErrors on apostrophes/unicode), while providing
    full Unicode fidelity via 'filename*=UTF-8\'\'...' for all modern browsers.
    """
    replacements = {
        "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "-",
        "\u2026": "...",
    }
    ascii_cand = filename
    for orig, rep in replacements.items():
        ascii_cand = ascii_cand.replace(orig, rep)

    ascii_clean = (
        unicodedata.normalize("NFKD", ascii_cand)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    ascii_clean = re.sub(r'[\\/*?:"<>|;]', "", ascii_clean).strip() or "Track.m4a"
    if not ascii_clean.endswith(".m4a"):
        ascii_clean += ".m4a"

    encoded_filename = urllib.parse.quote(filename, encoding="utf-8")
    return f'attachment; filename="{ascii_clean}"; filename*=UTF-8\'\'{encoded_filename}'


@app.api_route("/api/download/{video_id}", methods=["GET", "HEAD"])
def download_audio_endpoint(
    video_id: str,
    request: Request,
    title: Optional[str] = None,
    artist: Optional[str] = None,
):
    """
    Downloads high-quality m4a audio file directly with a clean filename
    and proper Content-Disposition: attachment header.
    Caches the audio file in data/downloads/ for instant offline playback.
    """
    # Sanitize video_id in case it was passed as full URL or with extra query params
    if "v=" in video_id:
        video_id = video_id.split("v=")[1].split("&")[0].split("/")[0]
    elif "youtu.be/" in video_id:
        video_id = video_id.split("youtu.be/")[1].split("?")[0].split("/")[0]
    elif "/" in video_id:
        video_id = video_id.split("/")[-1].split("?")[0]
    video_id = video_id.split("&")[0].split("?")[0].strip()

    local_path = os.path.join(DOWNLOADS_DIR, f"{video_id}.m4a")

    raw_title = (title or "Track").strip()
    raw_artist = (artist or "").strip()
    clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip() or "Track"
    clean_artist = re.sub(r'[\\/*?:"<>|]', "", raw_artist).strip()
    if clean_artist and clean_artist.lower() not in clean_title.lower():
        filename = f"{clean_artist} - {clean_title}.m4a"
    else:
        filename = f"{clean_title}.m4a"

    # 1. If file is already cached on disk, serve directly from disk
    if os.path.exists(local_path):
        file_size = os.path.getsize(local_path)
        resp_headers = {
            "Content-Disposition": _make_content_disposition(filename),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=86400",
            "Content-Length": str(file_size),
            "X-From-Offline-Cache": "true",
        }
        if request.method == "HEAD":
            return Response(status_code=200, media_type="audio/mp4", headers=resp_headers)

        return StreamingResponse(
            _stream_local_file(local_path, 0, file_size - 1),
            status_code=200,
            media_type="audio/mp4",
            headers=resp_headers,
        )

    # 2. Otherwise fetch from YouTube stream and cache to disk
    info = get_audio_stream_url(video_id)
    if not info or not info.get("url"):
        raise HTTPException(status_code=404, detail="Audio stream unavailable for download")

    stream_url = info["url"]
    ua = info.get(
        "ua",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    )
    total_size = int(info.get("clen") or 0)

    if not title:
        raw_title = (info.get("title") or "Track").strip()
        clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip() or "Track"
    if not artist:
        raw_artist = (info.get("uploader") or "").strip()
        clean_artist = re.sub(r'[\\/*?:"<>|]', "", raw_artist).strip()

    if clean_artist and clean_artist.lower() not in clean_title.lower():
        filename = f"{clean_artist} - {clean_title}.m4a"
    else:
        filename = f"{clean_title}.m4a"

    resp_headers = {
        "Content-Disposition": _make_content_disposition(filename),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
    }
    if total_size > 0:
        resp_headers["Content-Length"] = str(total_size)

    if request.method == "HEAD":
        return Response(
            status_code=200,
            media_type=info.get("mime", "audio/mp4"),
            headers=resp_headers,
        )

    temp_path = f"{local_path}.part_{int(time.time())}"

    def _iter_download_and_cache():
        pos = 0
        target_end = (total_size - 1) if total_size > 0 else None
        file_writer = None
        try:
            file_writer = open(temp_path, "wb")
        except Exception as e:
            print(f"Warning: unable to create local cache file {temp_path}: {e}")

        try:
            while target_end is None or pos <= target_end:
                chunk_end = (
                    min(pos + _STREAM_CHUNK_BYTES - 1, target_end)
                    if target_end is not None
                    else (pos + _STREAM_CHUNK_BYTES - 1)
                )
                r = _STREAM_HTTP_SESSION.get(
                    stream_url,
                    headers={"User-Agent": ua, "Range": f"bytes={pos}-{chunk_end}"},
                    stream=True,
                    timeout=20,
                )
                try:
                    if r.status_code == 200:
                        # Full content returned directly
                        for piece in r.iter_content(chunk_size=65536):
                            if piece:
                                if file_writer:
                                    file_writer.write(piece)
                                yield piece
                        break
                    elif r.status_code == 206:
                        received = 0
                        for piece in r.iter_content(chunk_size=65536):
                            if piece:
                                received += len(piece)
                                if file_writer:
                                    file_writer.write(piece)
                                yield piece
                        if received == 0:
                            break
                        pos += received
                        if target_end is None and received < _STREAM_CHUNK_BYTES:
                            break
                    else:
                        break
                finally:
                    r.close()

            # Successfully completed streaming: close and atomically save
            if file_writer:
                file_writer.close()
                file_writer = None
                if os.path.exists(temp_path) and os.path.getsize(temp_path) > 0:
                    os.replace(temp_path, local_path)
                    _save_download_meta({
                        "video_id": video_id,
                        "title": clean_title,
                        "artist": clean_artist,
                        "filename": filename,
                        "size": os.path.getsize(local_path),
                        "duration": info.get("duration") or 0,
                        "downloaded_at": int(time.time()),
                    })
        finally:
            if file_writer:
                try:
                    file_writer.close()
                except Exception:
                    pass
            if os.path.exists(temp_path):
                try:
                    os.remove(temp_path)
                except Exception:
                    pass

    return StreamingResponse(
        _iter_download_and_cache(),
        status_code=200,
        media_type=info.get("mime", "audio/mp4"),
        headers=resp_headers,
    )


@app.get("/api/offline/tracks")
def get_offline_tracks_endpoint():
    """
    Returns list of all tracks cached locally on backend disk.
    """
    meta_list = _load_downloads_meta()
    valid_items = []
    for item in meta_list:
        vid = item.get("video_id")
        filepath = os.path.join(DOWNLOADS_DIR, f"{vid}.m4a")
        if os.path.exists(filepath):
            item["size"] = os.path.getsize(filepath)
            valid_items.append(item)
    return {"tracks": valid_items}


@app.delete("/api/offline/tracks/{video_id}")
def delete_offline_track_endpoint(video_id: str):
    """
    Deletes an offline cached track from backend disk.
    """
    filepath = os.path.join(DOWNLOADS_DIR, f"{video_id}.m4a")
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception as e:
            print(f"Error removing cached file {filepath}: {e}")
    _delete_download_meta(video_id)
    return {"status": "ok", "deleted": video_id}


@app.api_route("/api/open-downloads", methods=["GET", "POST"])
def open_downloads_folder_endpoint():
    """
    Opens the dedicated UpBeat downloads folder in macOS Finder.
    """
    downloads_path = os.path.expanduser("~/Downloads/UpBeat")
    os.makedirs(downloads_path, exist_ok=True)
    if os.name == "posix":
        import subprocess
        subprocess.Popen(["open", downloads_path])
    return {"status": "ok", "path": downloads_path}


frontend_dist = os.path.join(os.path.dirname(__file__), "../frontend/dist")
if os.path.exists(frontend_dist):
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
