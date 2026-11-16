"""Audio streaming/downloading, local offline cache management, and favorites routes."""

import concurrent.futures
import json
import os
import re
import time
import unicodedata
import urllib.parse
from typing import Any, Dict, List, Optional, Tuple
import requests as ext_requests
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel

try:
    from favorites_store import get_favorites, toggle_favorite
    from routers import resolve_main_attr
    from youtube_search import get_audio_stream_url
except ImportError:
    from backend.favorites_store import get_favorites, toggle_favorite
    from backend.routers import resolve_main_attr
    from backend.youtube_search import get_audio_stream_url

router = APIRouter()

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IS_VERCEL = bool(os.environ.get("VERCEL")) or not os.access(_BACKEND_DIR, os.W_OK)
DOWNLOADS_DIR = "/tmp/upbeat_downloads" if IS_VERCEL else os.path.join(_BACKEND_DIR, "data", "downloads")
DOWNLOADS_META_FILE = "/tmp/upbeat_downloads.json" if IS_VERCEL else os.path.join(_BACKEND_DIR, "data", "downloads.json")
try:
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
except OSError:
    pass

_STREAM_HTTP_SESSION = ext_requests.Session()
_STREAM_HTTP_SESSION.mount(
    "https://",
    ext_requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16, max_retries=2),
)
_STREAM_CHUNK_BYTES = 1024 * 1024  # 1 MB bounded ranges for stable streaming


class FavoriteTrackRequest(BaseModel):
    track: Dict[str, Any]


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


def _materialize_segments_to_file(segment_urls: List[str], local_path: str, ua: str = "Mozilla/5.0") -> bool:
    """Fetches fMP4 (.m4a) segments concurrently and writes a unified .m4a file to local_path."""
    if not segment_urls:
        return False
    temp_path = f"{local_path}.seg_{int(time.time() * 1000)}"

    def _fetch_seg(u: str) -> bytes:
        r = _STREAM_HTTP_SESSION.get(u, headers={"User-Agent": ua}, timeout=10)
        return r.content if r.status_code in (200, 206) else b""

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
            chunks = list(ex.map(_fetch_seg, segment_urls))
        data = b"".join(chunks)
        if len(data) > 20000:
            with open(temp_path, "wb") as f:
                f.write(data)
            os.replace(temp_path, local_path)
            return True
    except Exception as e:
        print(f"Error materializing fMP4 segments to {local_path}: {e}")
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
    return False


def _sanitize_video_id(video_id: str) -> str:
    """Extracts a clean video ID if a full URL or extra query parameters were supplied."""
    if "v=" in video_id:
        video_id = video_id.split("v=")[1].split("&")[0].split("/")[0]
    elif "youtu.be/" in video_id:
        video_id = video_id.split("youtu.be/")[1].split("?")[0].split("/")[0]
    elif "/" in video_id:
        video_id = video_id.split("/")[-1].split("?")[0]
    return video_id.split("&")[0].split("?")[0].strip()


def _parse_byte_range(range_header: Optional[str], total_size: int) -> Tuple[int, Optional[int], bool]:
    """Parses HTTP Range header into (start, end, is_partial)."""
    start = 0
    end: Optional[int] = (total_size - 1) if total_size > 0 else None
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

    return start, end, is_partial


def _make_content_disposition(filename: str) -> str:
    """
    Constructs an RFC 6266 / RFC 5987 compliant Content-Disposition header
    with an ASCII-safe legacy filename and full UTF-8 filename*.
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


@router.get("/api/favorites")
def list_favorites():
    """Returns persisted favorite tracks."""
    fn = resolve_main_attr("get_favorites", get_favorites)
    return {"favorites": fn()}


@router.post("/api/favorites/toggle")
def toggle_favorite_endpoint(req: FavoriteTrackRequest):
    """Toggles favorite state for a track."""
    fn = resolve_main_attr("toggle_favorite", toggle_favorite)
    return fn(req.track)


@router.api_route("/api/audio/{video_id}", methods=["GET", "HEAD"])
def stream_audio_endpoint(video_id: str, request: Request, title: str = "", artist: str = "", expected_duration: int = 0):
    """
    Streams the exact official audio track (m4a/mp4) from local offline cache
    or bounded 1 MB upstream range chunks.
    """
    stream_lookup = resolve_main_attr("get_audio_stream_url", get_audio_stream_url)
    local_path = os.path.join(DOWNLOADS_DIR, f"{video_id}.m4a")
    if not os.path.exists(local_path):
        info_check = stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
        if info_check and info_check.get("segment_urls"):
            _materialize_segments_to_file(
                info_check["segment_urls"], local_path, info_check.get("ua", "Mozilla/5.0")
            )

    if os.path.exists(local_path):
        file_size = os.path.getsize(local_path)
        if (expected_duration > 60 and file_size < 800000) or file_size < 50000:
            try:
                os.remove(local_path)
            except OSError:
                pass
        else:
            range_header = request.headers.get("range") or request.headers.get("Range")
            start, end, is_partial = _parse_byte_range(range_header, file_size)
            end_pos = (file_size - 1) if end is None else end
            content_len = max(0, end_pos - start + 1)
            status_code = 206 if (is_partial or file_size > 0) else 200

            headers = {
                "Accept-Ranges": "bytes",
                "Content-Length": str(content_len),
                "Content-Type": "audio/mp4",
                "Cache-Control": "public, max-age=86400",
                "X-From-Offline-Cache": "true",
            }
            if status_code == 206:
                headers["Content-Range"] = f"bytes {start}-{end_pos}/{file_size}"

            if request.method == "HEAD":
                return Response(status_code=status_code, headers=headers)

            return StreamingResponse(
                _stream_local_file(local_path, start, end_pos),
                status_code=status_code,
                media_type="audio/mp4",
                headers=headers,
            )

    info = stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
    if not info or not info.get("url"):
        raise HTTPException(status_code=404, detail="Audio stream unavailable")

    stream_url = info["url"]
    ua = info.get(
        "ua",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    )
    total_size = int(info.get("clen") or 0)

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
    start, end, is_partial = _parse_byte_range(range_header, total_size)

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


@router.api_route("/api/download/{video_id}", methods=["GET", "HEAD"])
def download_audio_endpoint(
    video_id: str,
    request: Request,
    title: Optional[str] = None,
    artist: Optional[str] = None,
):
    """
    Downloads high-quality m4a audio directly with Content-Disposition: attachment
    and caches it in data/downloads/ for offline playback.
    """
    stream_lookup = resolve_main_attr("get_audio_stream_url", get_audio_stream_url)
    video_id = _sanitize_video_id(video_id)
    local_path = os.path.join(DOWNLOADS_DIR, f"{video_id}.m4a")

    raw_title = (title or "Track").strip()
    raw_artist = (artist or "").strip()
    clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip() or "Track"
    clean_artist = re.sub(r'[\\/*?:"<>|]', "", raw_artist).strip()
    if clean_artist and clean_artist.lower() not in clean_title.lower():
        filename = f"{clean_artist} - {clean_title}.m4a"
    else:
        filename = f"{clean_title}.m4a"

    if os.path.exists(local_path):
        file_size = os.path.getsize(local_path)
        if file_size < 50000:
            try:
                os.remove(local_path)
            except OSError:
                pass
        else:
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

    info = stream_lookup(video_id, title=title or "", artist=artist or "")
    if not info or not info.get("url"):
        raise HTTPException(status_code=404, detail="Audio stream unavailable for download")

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

    if info.get("segment_urls"):
        if _materialize_segments_to_file(
            info["segment_urls"], local_path, info.get("ua", "Mozilla/5.0")
        ):
            file_size = os.path.getsize(local_path)
            _save_download_meta({
                "video_id": video_id,
                "title": clean_title,
                "artist": clean_artist,
                "filename": filename,
                "size": file_size,
                "duration": info.get("duration") or 0,
                "downloaded_at": int(time.time()),
            })
            resp_headers = {
                "Content-Disposition": _make_content_disposition(filename),
                "Accept-Ranges": "bytes",
                "Cache-Control": "public, max-age=86400",
                "Content-Length": str(file_size),
            }
            if request.method == "HEAD":
                return Response(status_code=200, media_type="audio/mp4", headers=resp_headers)
            return StreamingResponse(
                _stream_local_file(local_path, 0, file_size - 1),
                status_code=200,
                media_type="audio/mp4",
                headers=resp_headers,
            )

    stream_url = info["url"]
    ua = info.get(
        "ua",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
    )
    total_size = int(info.get("clen") or 0)

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


@router.get("/api/offline/tracks")
def get_offline_tracks_endpoint():
    """Returns list of all tracks cached locally on backend disk."""
    meta_list = _load_downloads_meta()
    valid_items = []
    for item in meta_list:
        vid = item.get("video_id")
        filepath = os.path.join(DOWNLOADS_DIR, f"{vid}.m4a")
        if os.path.exists(filepath):
            item["size"] = os.path.getsize(filepath)
            valid_items.append(item)
    return {"tracks": valid_items}


@router.delete("/api/offline/tracks/{video_id}")
def delete_offline_track_endpoint(video_id: str):
    """Deletes an offline cached track from backend disk."""
    filepath = os.path.join(DOWNLOADS_DIR, f"{video_id}.m4a")
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception as e:
            print(f"Error removing cached file {filepath}: {e}")
    _delete_download_meta(video_id)
    return {"status": "ok", "deleted": video_id}


@router.api_route("/api/open-downloads", methods=["GET", "POST"])
def open_downloads_folder_endpoint():
    """Opens the dedicated UpBeat downloads folder in macOS Finder."""
    downloads_path = os.path.expanduser("~/Downloads/UpBeat")
    os.makedirs(downloads_path, exist_ok=True)
    if os.name == "posix":
        import subprocess
        subprocess.Popen(["open", downloads_path])
    return {"status": "ok", "path": downloads_path}
