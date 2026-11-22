"""Audio streaming/downloading, local offline cache management, and favorites routes."""

import concurrent.futures
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
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
    from routers import require_local_origin, resolve_main_attr
    from youtube_search import VIDEO_ID_REGEX, get_audio_stream_url, invalidate_stream_cache
except ImportError:
    from backend.favorites_store import get_favorites, toggle_favorite
    from backend.routers import require_local_origin, resolve_main_attr
    from backend.youtube_search import VIDEO_ID_REGEX, get_audio_stream_url, invalidate_stream_cache

router = APIRouter()

_BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IS_VERCEL = bool(os.environ.get("VERCEL")) or not os.access(_BACKEND_DIR, os.W_OK)
DOWNLOADS_DIR = "/tmp/upbeat_downloads" if IS_VERCEL else os.path.join(_BACKEND_DIR, "data", "downloads")
DOWNLOADS_META_FILE = "/tmp/upbeat_downloads.json" if IS_VERCEL else os.path.join(_BACKEND_DIR, "data", "downloads.json")
try:
    os.makedirs(DOWNLOADS_DIR, exist_ok=True)
except OSError:
    pass

_META_LOCK = threading.Lock()
_STREAM_HTTP_SESSION = ext_requests.Session()
_STREAM_HTTP_SESSION.mount(
    "https://",
    ext_requests.adapters.HTTPAdapter(pool_connections=16, pool_maxsize=16, max_retries=2),
)
_STREAM_CHUNK_BYTES = 1024 * 1024  # 1 MB bounded ranges for stable streaming


class FavoriteTrackRequest(BaseModel):
    track: Dict[str, Any]


def _load_downloads_meta_unlocked() -> List[Dict[str, Any]]:
    if not os.path.exists(DOWNLOADS_META_FILE):
        return []
    try:
        with open(DOWNLOADS_META_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_downloads_meta_unlocked(items: List[Dict[str, Any]]) -> None:
    target_dir = os.path.dirname(os.path.abspath(DOWNLOADS_META_FILE))
    tmp_path = ""
    try:
        os.makedirs(target_dir, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", dir=target_dir, prefix=".downloads_", suffix=".tmp", delete=False, encoding="utf-8"
        ) as tf:
            tmp_path = tf.name
            json.dump(items, tf, indent=2, ensure_ascii=False)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, DOWNLOADS_META_FILE)
    except Exception as e:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass
        print(f"Error saving download metadata: {e}")


def _load_downloads_meta() -> List[Dict[str, Any]]:
    with _META_LOCK:
        return _load_downloads_meta_unlocked()


def _save_download_meta(track_info: Dict[str, Any]) -> None:
    with _META_LOCK:
        items = _load_downloads_meta_unlocked()
        items = [x for x in items if x.get("video_id") != track_info.get("video_id")]
        items.insert(0, track_info)
        _write_downloads_meta_unlocked(items)


def _delete_download_meta(video_id: str) -> None:
    with _META_LOCK:
        items = _load_downloads_meta_unlocked()
        items = [x for x in items if x.get("video_id") != video_id]
        _write_downloads_meta_unlocked(items)


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
    """Extracts and strictly validates an 11-character YouTube video ID."""
    clean = str(video_id or "").strip()
    if "v=" in clean:
        clean = clean.split("v=")[1].split("&")[0].split("/")[0]
    elif "youtu.be/" in clean:
        clean = clean.split("youtu.be/")[1].split("?")[0].split("/")[0]
    elif "/" in clean:
        clean = clean.split("/")[-1].split("?")[0]
    clean = clean.split("&")[0].split("?")[0].strip()
    if not VIDEO_ID_REGEX.match(clean):
        raise HTTPException(status_code=400, detail="Invalid 11-character YouTube video ID")
    return clean


def _safe_cache_path(video_id: str) -> str:
    """Builds a validated file path inside DOWNLOADS_DIR for a verified 11-char video_id."""
    vid = _sanitize_video_id(video_id)
    base_dir = os.path.realpath(DOWNLOADS_DIR)
    target = os.path.realpath(os.path.join(base_dir, f"{vid}.m4a"))
    if not target.startswith(base_dir + os.sep):
        raise HTTPException(status_code=400, detail="Invalid cache path")
    return target


def _parse_byte_range(range_header: Optional[str], total_size: int) -> Tuple[int, Optional[int], bool]:
    """
    Parses an HTTP Range header into (start, end, is_partial).
    Raises ValueError on malformed or unsatisfiable byte ranges (for HTTP 416).
    """
    start = 0
    end: Optional[int] = (total_size - 1) if total_size > 0 else None
    is_partial = False

    if not range_header:
        return start, end, False

    raw = range_header.strip()
    if not raw.lower().startswith("bytes="):
        raise ValueError("Unsupported Range unit")

    spec = raw[6:].split(",", 1)[0].strip()
    if "-" not in spec:
        raise ValueError("Malformed byte range")

    parts = spec.split("-", 1)
    start_str, end_str = parts[0].strip(), parts[1].strip()
    if not start_str and not end_str:
        raise ValueError("Empty byte range")

    is_partial = True
    if start_str:
        if not start_str.isdigit():
            raise ValueError("Invalid range start")
        start = int(start_str)
        if end_str:
            if not end_str.isdigit():
                raise ValueError("Invalid range end")
            end = int(end_str)
    else:
        # Suffix byte range: bytes=-N
        if not end_str.isdigit():
            raise ValueError("Invalid suffix byte range")
        suffix = int(end_str)
        if suffix <= 0:
            raise ValueError("Non-positive suffix byte range")
        if total_size > 0:
            start = max(0, total_size - suffix)
            end = total_size - 1
        else:
            return 0, None, False

    if total_size > 0:
        if start >= total_size:
            raise ValueError("Range start out of bounds")
        if end is None or end >= total_size:
            end = total_size - 1

    if end is not None and end < start:
        raise ValueError("Range end precedes start")

    return start, end, is_partial


def _strip_control_chars(value: str) -> str:
    return re.sub(r"[\r\n\x00-\x1f\x7f]+", "", str(value or ""))


def _make_content_disposition(filename: str) -> str:
    """
    Constructs an RFC 6266 / RFC 5987 compliant Content-Disposition header
    with an ASCII-safe legacy filename and full UTF-8 filename* (CR/LF stripped).
    """
    safe_name = _strip_control_chars(filename).strip() or "Track.m4a"
    replacements = {
        "\u2018": "'", "\u2019": "'",
        "\u201c": '"', "\u201d": '"',
        "\u2013": "-", "\u2014": "-",
        "\u2026": "...",
    }
    ascii_cand = safe_name
    for orig, rep in replacements.items():
        ascii_cand = ascii_cand.replace(orig, rep)

    ascii_clean = (
        unicodedata.normalize("NFKD", ascii_cand)
        .encode("ascii", "ignore")
        .decode("ascii")
    )
    ascii_clean = re.sub(r'[\\/*?:"<>|;\r\n\x00-\x1f\x7f]', "", ascii_clean).strip() or "Track.m4a"
    if not ascii_clean.endswith(".m4a"):
        ascii_clean += ".m4a"

    encoded_filename = urllib.parse.quote(safe_name, encoding="utf-8")
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


@router.get("/api/audio", operation_id="stream_audio_query_get")
@router.head("/api/audio", operation_id="stream_audio_query_head")
def stream_audio_query_endpoint(
    request: Request,
    id: str = "",
    video_id: str = "",
    title: str = "",
    artist: str = "",
    expected_duration: int = 0,
):
    """Query-parameter alias (/api/audio?id=...) matching Edge audio handler."""
    return stream_audio_endpoint(
        id or video_id,
        request=request,
        title=title,
        artist=artist,
        expected_duration=expected_duration,
    )


@router.get("/api/audio/{video_id}", operation_id="stream_audio_get")
@router.head("/api/audio/{video_id}", operation_id="stream_audio_head")
def stream_audio_endpoint(video_id: str, request: Request, title: str = "", artist: str = "", expected_duration: int = 0):
    """
    Streams the exact official audio track (m4a/mp4) from local offline cache
    or bounded 1 MB upstream range chunks.
    """
    video_id = _sanitize_video_id(video_id)
    local_path = _safe_cache_path(video_id)
    stream_lookup = resolve_main_attr("get_audio_stream_url", get_audio_stream_url)
    invalidate_fn = resolve_main_attr("invalidate_stream_cache", invalidate_stream_cache)

    prefetched_info: Optional[Dict[str, Any]] = None
    if not os.path.exists(local_path):
        prefetched_info = stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
        if prefetched_info and prefetched_info.get("segment_urls"):
            _materialize_segments_to_file(
                prefetched_info["segment_urls"], local_path, prefetched_info.get("ua", "Mozilla/5.0")
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
            try:
                start, end, is_partial = _parse_byte_range(range_header, file_size)
            except ValueError:
                raise HTTPException(
                    status_code=416,
                    detail="Range Not Satisfiable",
                    headers={"Content-Range": f"bytes */{file_size}"},
                )

            end_pos = (file_size - 1) if end is None else end
            content_len = max(0, end_pos - start + 1)
            status_code = 206 if is_partial else 200

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

    info = (
        prefetched_info
        if prefetched_info is not None
        else stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
    )
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
        probe_status = probe.status_code
        cr = probe.headers.get("Content-Range", "")
        probe.close()
        if probe_status in (403, 410):
            invalidate_fn(video_id)
            fresh = stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
            if not fresh or not fresh.get("url"):
                raise HTTPException(status_code=502, detail="Upstream audio stream expired")
            info = fresh
            stream_url = info["url"]
            ua = info.get("ua", ua)
            total_size = int(info.get("clen") or 0)
            if total_size <= 0:
                probe2 = _STREAM_HTTP_SESSION.get(
                    stream_url,
                    headers={"User-Agent": ua, "Range": "bytes=0-1"},
                    stream=True,
                    timeout=10,
                )
                cr = probe2.headers.get("Content-Range", "")
                probe2.close()
        if "/" in cr:
            try:
                total_size = int(cr.split("/")[-1])
                info["clen"] = total_size
            except ValueError:
                total_size = 0

    range_header = request.headers.get("range") or request.headers.get("Range")
    try:
        start, end, is_partial = _parse_byte_range(range_header, total_size)
    except ValueError:
        err_headers = {"Content-Range": f"bytes */{total_size}"} if total_size > 0 else None
        raise HTTPException(status_code=416, detail="Range Not Satisfiable", headers=err_headers)

    resp_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
    }
    if info.get("duration"):
        resp_headers["X-Track-Duration"] = str(info["duration"])
    status_code = 206 if is_partial else 200
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
        active_url = stream_url
        active_ua = ua
        stream_refresh_attempts = 0
        while target_end is None or pos <= target_end:
            chunk_end = (
                min(pos + _STREAM_CHUNK_BYTES - 1, target_end)
                if target_end is not None
                else (pos + _STREAM_CHUNK_BYTES - 1)
            )
            r = _STREAM_HTTP_SESSION.get(
                active_url,
                headers={"User-Agent": active_ua, "Range": f"bytes={pos}-{chunk_end}"},
                stream=True,
                timeout=15,
            )
            try:
                if r.status_code in (403, 410):
                    invalidate_fn(video_id)
                    if stream_refresh_attempts < 2:
                        stream_refresh_attempts += 1
                        fresh = stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
                        if fresh and fresh.get("url"):
                            active_url = fresh["url"]
                            active_ua = fresh.get("ua", active_ua)
                            continue
                    break
                if r.status_code not in (200, 206):
                    break
                received = 0
                for piece in r.iter_content(chunk_size=65536):
                    if piece:
                        received += len(piece)
                        yield piece
                if received == 0:
                    if target_end is not None and pos <= target_end and stream_refresh_attempts < 2:
                        stream_refresh_attempts += 1
                        invalidate_fn(video_id)
                        fresh = stream_lookup(video_id, title=title, artist=artist, expected_duration=expected_duration)
                        if fresh and fresh.get("url"):
                            active_url = fresh["url"]
                            active_ua = fresh.get("ua", active_ua)
                            continue
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


@router.get("/api/download/{video_id}", operation_id="download_audio_get")
@router.head("/api/download/{video_id}", operation_id="download_audio_head")
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
    video_id = _sanitize_video_id(video_id)
    local_path = _safe_cache_path(video_id)
    stream_lookup = resolve_main_attr("get_audio_stream_url", get_audio_stream_url)
    invalidate_fn = resolve_main_attr("invalidate_stream_cache", invalidate_stream_cache)

    raw_title = _strip_control_chars(title or "Track").strip()
    raw_artist = _strip_control_chars(artist or "").strip()
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
        raw_title = _strip_control_chars(info.get("title") or "Track").strip()
        clean_title = re.sub(r'[\\/*?:"<>|]', "", raw_title).strip() or "Track"
    if not artist:
        raw_artist = _strip_control_chars(info.get("uploader") or "").strip()
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

    temp_path = f"{local_path}.part_{int(time.time() * 1000)}_{threading.get_ident()}"

    def _iter_download_and_cache():
        pos = 0
        expected_len = total_size
        target_end = (expected_len - 1) if expected_len > 0 else None
        bytes_written = 0
        download_complete = False
        stream_failed = False
        file_writer = None
        try:
            os.makedirs(os.path.dirname(temp_path), exist_ok=True)
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
                        if pos > 0:
                            stream_failed = True
                            break
                        upstream_len_raw = r.headers.get("Content-Length") or ""
                        if upstream_len_raw.isdigit() and expected_len <= 0:
                            expected_len = int(upstream_len_raw)
                        for piece in r.iter_content(chunk_size=65536):
                            if piece:
                                bytes_written += len(piece)
                                if file_writer:
                                    file_writer.write(piece)
                                yield piece
                        if bytes_written == 0 or (expected_len > 0 and bytes_written < expected_len):
                            stream_failed = True
                        else:
                            download_complete = True
                        break
                    elif r.status_code == 206:
                        cr = r.headers.get("Content-Range", "")
                        if expected_len <= 0 and "/" in cr:
                            total_part = cr.split("/")[-1].strip()
                            if total_part.isdigit():
                                expected_len = int(total_part)
                                target_end = expected_len - 1
                        received = 0
                        for piece in r.iter_content(chunk_size=65536):
                            if piece:
                                received += len(piece)
                                bytes_written += len(piece)
                                if file_writer:
                                    file_writer.write(piece)
                                yield piece
                        if received == 0:
                            stream_failed = True
                            break
                        pos += received
                        if target_end is not None and pos > target_end:
                            download_complete = True
                            break
                        if target_end is None and received < _STREAM_CHUNK_BYTES:
                            download_complete = True
                            break
                    else:
                        if r.status_code in (403, 410):
                            invalidate_fn(video_id)
                        stream_failed = True
                        break
                finally:
                    r.close()

            if (
                file_writer
                and download_complete
                and not stream_failed
                and bytes_written > 0
                and (expected_len <= 0 or bytes_written >= expected_len)
            ):
                file_writer.flush()
                file_writer.close()
                file_writer = None
                if os.path.exists(temp_path) and os.path.getsize(temp_path) == bytes_written:
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
        vid = str(item.get("video_id") or "").strip()
        if not VIDEO_ID_REGEX.match(vid):
            continue
        filepath = _safe_cache_path(vid)
        if os.path.exists(filepath):
            item["size"] = os.path.getsize(filepath)
            valid_items.append(item)
    return {"tracks": valid_items}


@router.delete("/api/offline/tracks/{video_id}")
def delete_offline_track_endpoint(video_id: str):
    """Deletes an offline cached track from backend disk."""
    video_id = _sanitize_video_id(video_id)
    filepath = _safe_cache_path(video_id)
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
        except Exception as e:
            print(f"Error removing cached file {filepath}: {e}")
    _delete_download_meta(video_id)
    return {"status": "ok", "deleted": video_id}


@router.get("/api/open-downloads", operation_id="open_downloads_get")
@router.post("/api/open-downloads", operation_id="open_downloads_post")
def open_downloads_folder_endpoint(request: Request):
    """Opens the dedicated UpBeat downloads folder in macOS Finder."""
    require_local_origin(request, require_loopback=True)
    downloads_path = os.path.expanduser("~/Downloads/UpBeat")
    os.makedirs(downloads_path, exist_ok=True)
    if sys.platform != "darwin" or os.environ.get("VERCEL"):
        return {"status": "unsupported", "path": downloads_path, "detail": "Finder reveal is only supported on macOS"}
    subprocess.Popen(["open", downloads_path])
    return {"status": "ok", "path": downloads_path}
