import json
import os
import time
from typing import Dict, List, Any

IS_VERCEL = bool(os.environ.get("VERCEL")) or not os.access(os.path.dirname(__file__), os.W_OK)
DATA_DIR = "/tmp" if IS_VERCEL else os.path.join(os.path.dirname(__file__), "data")
FAVS_FILE = os.path.join(DATA_DIR, "favorites.json")


def _track_key(track: Dict[str, Any]) -> str:
    vid = (track.get("video_id") or "").strip()
    if vid:
        return f"vid:{vid}"
    title = (track.get("title") or "").strip().lower()
    artist = (track.get("artist") or "").strip().lower()
    return f"meta:{title}::{artist}"


def get_favorites() -> List[Dict[str, Any]]:
    """Loads saved favorite tracks from disk."""
    if not os.path.exists(FAVS_FILE):
        return []
    try:
        with open(FAVS_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data if isinstance(data, list) else []
    except Exception:
        return []


def save_favorites(favs: List[Dict[str, Any]]) -> None:
    """Persists favorite tracks to disk."""
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        with open(FAVS_FILE, "w", encoding="utf-8") as f:
            json.dump(favs, f, indent=2, ensure_ascii=False)
    except OSError:
        pass


def toggle_favorite(track: Dict[str, Any]) -> Dict[str, Any]:
    """Toggles a track in persistent favorites and returns updated list."""
    favs = get_favorites()
    target_key = _track_key(track)
    title_artist_key = f"meta:{(track.get('title') or '').strip().lower()}::{(track.get('artist') or '').strip().lower()}"

    existing_idx = -1
    for idx, item in enumerate(favs):
        k = _track_key(item)
        item_ta = f"meta:{(item.get('title') or '').strip().lower()}::{(item.get('artist') or '').strip().lower()}"
        if k == target_key or item_ta == title_artist_key:
            existing_idx = idx
            break

    if existing_idx >= 0:
        favs.pop(existing_idx)
        save_favorites(favs)
        return {"is_favorite": False, "favorites": favs}
    else:
        entry = {
            "title": (track.get("title") or "").strip(),
            "artist": (track.get("artist") or "").strip(),
            "video_id": track.get("video_id") or "",
            "fallback_ids": track.get("fallback_ids") or [],
            "thumbnail": track.get("thumbnail") or (f"https://i.ytimg.com/vi/{track.get('video_id')}/hqdefault.jpg" if track.get("video_id") else ""),
            "duration_text": track.get("duration_text") or "3:45",
            "vibe": track.get("vibe") or "Favorite",
            "reason": track.get("reason") or "Saved to your Favorites memory.",
            "url": track.get("url") or (f"https://www.youtube.com/watch?v={track.get('video_id')}" if track.get("video_id") else ""),
            "liked_at": int(time.time()),
        }
        favs.insert(0, entry)
        save_favorites(favs)
        return {"is_favorite": True, "favorites": favs}
