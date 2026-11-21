import json
import os
import tempfile
import threading
import time
from typing import Dict, List, Any

IS_VERCEL = bool(os.environ.get("VERCEL")) or not os.access(os.path.dirname(__file__), os.W_OK)
DATA_DIR = "/tmp" if IS_VERCEL else os.path.join(os.path.dirname(__file__), "data")
FAVS_FILE = os.path.join(DATA_DIR, "favorites.json")
_FAVS_LOCK = threading.Lock()


def _track_key(track: Dict[str, Any]) -> str:
    vid = (track.get("video_id") or "").strip()
    if vid:
        return f"vid:{vid}"
    title = (track.get("title") or "").strip().lower()
    artist = (track.get("artist") or "").strip().lower()
    return f"meta:{title}::{artist}"


def _read_favorites_unlocked() -> List[Dict[str, Any]]:
    if not os.path.exists(FAVS_FILE):
        return []
    try:
        with open(FAVS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def _write_favorites_unlocked(favs: List[Dict[str, Any]]) -> None:
    target_dir = os.path.dirname(os.path.abspath(FAVS_FILE))
    tmp_path = ""
    try:
        os.makedirs(target_dir, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            "w", dir=target_dir, prefix=".favs_", suffix=".tmp", delete=False, encoding="utf-8"
        ) as tf:
            tmp_path = tf.name
            json.dump(favs, tf, indent=2, ensure_ascii=False)
            tf.flush()
            os.fsync(tf.fileno())
        os.replace(tmp_path, FAVS_FILE)
    except OSError:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                pass


def get_favorites() -> List[Dict[str, Any]]:
    """Loads saved favorite tracks from disk."""
    with _FAVS_LOCK:
        return _read_favorites_unlocked()


def save_favorites(favs: List[Dict[str, Any]]) -> None:
    """Atomically persists favorite tracks to disk under a lock."""
    with _FAVS_LOCK:
        _write_favorites_unlocked(favs)


def toggle_favorite(track: Dict[str, Any]) -> Dict[str, Any]:
    """Toggles a track in persistent favorites and returns updated list."""
    with _FAVS_LOCK:
        favs = _read_favorites_unlocked()
        target_key = _track_key(track)
        title_artist_key = (
            f"meta:{(track.get('title') or '').strip().lower()}::"
            f"{(track.get('artist') or '').strip().lower()}"
        )

        existing_idx = -1
        for idx, item in enumerate(favs):
            k = _track_key(item)
            item_ta = (
                f"meta:{(item.get('title') or '').strip().lower()}::"
                f"{(item.get('artist') or '').strip().lower()}"
            )
            if k == target_key or item_ta == title_artist_key:
                existing_idx = idx
                break

        if existing_idx >= 0:
            favs.pop(existing_idx)
            _write_favorites_unlocked(favs)
            return {"is_favorite": False, "favorites": favs}

        entry = {
            "title": (track.get("title") or "").strip(),
            "artist": (track.get("artist") or "").strip(),
            "video_id": track.get("video_id") or "",
            "fallback_ids": track.get("fallback_ids") or [],
            "thumbnail": track.get("thumbnail")
            or (f"https://i.ytimg.com/vi/{track.get('video_id')}/hqdefault.jpg" if track.get("video_id") else ""),
            "duration_text": track.get("duration_text") or "3:45",
            "vibe": track.get("vibe") or "Favorite",
            "reason": track.get("reason") or "Saved to your Favorites memory.",
            "url": track.get("url")
            or (f"https://www.youtube.com/watch?v={track.get('video_id')}" if track.get("video_id") else ""),
            "liked_at": int(time.time()),
        }
        favs.insert(0, entry)
        _write_favorites_unlocked(favs)
        return {"is_favorite": True, "favorites": favs}
