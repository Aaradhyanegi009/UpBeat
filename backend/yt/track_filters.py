"""Shared music validation filters, duration helpers, and JSON parsing utilities."""

import json
import os
import re
from typing import Any, Dict, List

_FILTERS_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "music_filters.json",
)
with open(_FILTERS_PATH, "r", encoding="utf-8") as _f:
    MUSIC_FILTER_RULES: Dict[str, Any] = json.load(_f)

MIN_DURATION_SEC = int(MUSIC_FILTER_RULES["min_duration_sec"])
MAX_DURATION_SEC = int(MUSIC_FILTER_RULES["max_duration_sec"])
VIDEO_ID_REGEX = re.compile(MUSIC_FILTER_RULES["video_id_pattern"])
INVALID_ARTIST_NUMERIC_REGEX = re.compile(
    MUSIC_FILTER_RULES["invalid_artist_numeric_pattern"], re.IGNORECASE
)
INVALID_ARTIST_GENERIC_REGEX = re.compile(
    MUSIC_FILTER_RULES["invalid_artist_generic_pattern"], re.IGNORECASE
)

COMEDY_PODCAST_REGEX = re.compile(
    MUSIC_FILTER_RULES["patterns"]["comedy_podcast"], re.IGNORECASE | re.ASCII
)
DEVOTIONAL_RELIGIOUS_REGEX = re.compile(
    MUSIC_FILTER_RULES["patterns"]["devotional_religious"], re.IGNORECASE | re.ASCII
)
NON_MUSIC_GENERAL_REGEX = re.compile(
    MUSIC_FILTER_RULES["patterns"]["non_music_general"], re.IGNORECASE | re.ASCII
)
NON_MUSIC_REGEX = re.compile(
    MUSIC_FILTER_RULES["patterns"]["non_music_academic_and_creator"],
    re.IGNORECASE | re.ASCII,
)

_STOPWORDS = {
    "songs", "song", "music", "the", "a", "an", "of", "and",
    "best", "top", "new", "latest", "playlist", "mix", "for", "to", "in",
}


def format_seconds(sec: int) -> str:
    """Formats whole seconds into m:ss or h:mm:ss; returns '' when <= 0."""
    if not sec or sec <= 0:
        return ""
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def parse_duration_seconds(text: str) -> int:
    """Parses raw seconds or clock strings (mm:ss / hh:mm:ss) into integer seconds."""
    if not text:
        return 0
    clean = str(text).strip()
    if clean.isdigit():
        return int(clean)
    parts = clean.split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
    except ValueError:
        pass
    return 0


def _duration_to_seconds(d: str) -> int:
    """Converts colon-delimited duration text into total seconds (0 on parse failure)."""
    try:
        parts = [int(p) for p in d.split(":")]
    except ValueError:
        return 0
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def _find_nodes(obj: Any, target_key: str):
    """Recursively yields every sub-dict keyed by target_key inside nested JSON."""
    if isinstance(obj, dict):
        if target_key in obj:
            yield obj[target_key]
        for v in obj.values():
            yield from _find_nodes(v, target_key)
    elif isinstance(obj, list):
        for item in obj:
            yield from _find_nodes(item, target_key)


def _runs_text(obj: Any) -> str:
    """Extracts plain text from YouTube Innertube simpleText or runs arrays."""
    if not isinstance(obj, dict):
        return ""
    if "simpleText" in obj:
        return obj.get("simpleText", "")
    return "".join(r.get("text", "") for r in obj.get("runs", []))


def _extract_runs_text(col_obj: Dict[str, Any], renderer_key: str) -> str:
    """Extracts joined run text from an Innertube flex/fixed column renderer."""
    runs = col_obj.get(renderer_key, {}).get("text", {}).get("runs", [])
    return "".join(r.get("text", "") for r in runs).strip()


def _query_tokens(q: str) -> List[str]:
    """Tokenizes a search query into alphanumeric core keywords."""
    toks = re.findall(r"[a-z0-9]+", q.lower())
    core = [t for t in toks if t not in _STOPWORDS]
    return core or toks


def _relevance(text: str, tokens: List[str]) -> float:
    """Computes fraction of query tokens present in target text."""
    if not tokens:
        return 0.0
    t = text.lower()
    return sum(1 for tok in tokens if tok in t) / len(tokens)


def is_strict_music_track(track: Dict[str, Any]) -> bool:
    """Validates that a candidate track dict represents a real music track (no comedy/podcasts/devotional/shorts)."""
    if not isinstance(track, dict):
        return False
    title = (track.get("title") or "").strip()
    artist = (track.get("artist") or "").strip()
    if not title or not artist:
        return False

    vid = (track.get("video_id") or track.get("videoId") or "").strip()
    if vid and not VIDEO_ID_REGEX.match(vid):
        return False

    # Reject view counts, subscriber counts, or relative dates captured as artist
    if INVALID_ARTIST_NUMERIC_REGEX.match(artist):
        return False
    if INVALID_ARTIST_GENERIC_REGEX.match(artist):
        return False

    text = f"{title} {artist}"
    if COMEDY_PODCAST_REGEX.search(text):
        return False
    if DEVOTIONAL_RELIGIOUS_REGEX.search(text):
        return False
    if NON_MUSIC_GENERAL_REGEX.search(text):
        return False
    if NON_MUSIC_REGEX.search(text):
        return False

    sec = 0
    dur = track.get("duration_sec") or track.get("duration") or track.get("duration_seconds")
    if isinstance(dur, (int, float)) and dur > 0:
        sec = int(dur)
    elif track.get("duration_text"):
        sec = _duration_to_seconds(str(track["duration_text"]))

    # Duration strictly between 75s (1:15) and 420s (7:00) when duration is known
    if sec > 0 and (sec < MIN_DURATION_SEC or sec > MAX_DURATION_SEC):
        return False

    return True


is_valid_music_track = is_strict_music_track
