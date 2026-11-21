"""YouTube & YouTube Music Innertube HTTP client, search, and playlist browsing."""

from collections import OrderedDict
import concurrent.futures
import copy
import math
import re
import threading
import time
import urllib.parse
from typing import Any, Callable, Dict, List, Optional
import requests
from requests.adapters import HTTPAdapter

from .track_filters import (
    _duration_to_seconds,
    _extract_runs_text,
    _find_nodes,
    _query_tokens,
    _relevance,
    _runs_text,
    format_seconds,
    is_valid_music_track,
    parse_duration_seconds,
)

_CACHE_LOCK = threading.RLock()
_MAX_CACHE_ENTRIES = 256
_SEARCH_CACHE_TTL = 1800.0
_DIRECT_SEARCH_CACHE_TTL = 1200.0
_PLAYLIST_BROWSE_CACHE_TTL = 1800.0
_STREAM_CACHE_FALLBACK_TTL = 1500.0

_SEARCH_CACHE: OrderedDict[str, Dict] = OrderedDict()
_SEARCH_CACHE_TS: Dict[str, float] = {}
_STREAM_CACHE: OrderedDict[str, Dict[str, Any]] = OrderedDict()
_DIRECT_SEARCH_CACHE: OrderedDict[str, Dict[str, Any]] = OrderedDict()
_PLAYLIST_BROWSE_CACHE: OrderedDict[str, Dict[str, Any]] = OrderedDict()

_PREFETCH_HOOK: Optional[Callable[[List[str]], None]] = None


def _extract_stream_expiry(stream_url: str, fallback_ttl: float = _STREAM_CACHE_FALLBACK_TTL, now: Optional[float] = None) -> float:
    """Extracts the googlevideo expire= Unix timestamp (with a 60s safety buffer), bounded by fallback_ttl."""
    cur = time.time() if now is None else now
    default_exp = cur + fallback_ttl
    if not stream_url:
        return default_exp
    try:
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(stream_url).query)
        raw_exp = (qs.get("expire") or [None])[0]
        if raw_exp:
            exp_ts = int(raw_exp)
            if exp_ts > 0:
                return min(default_exp, float(exp_ts) - 60.0)
    except Exception:
        pass
    return default_exp


def _stream_cache_get(video_id: str, expected_duration: int = 0) -> Optional[Dict[str, Any]]:
    """Thread-safe bounded stream cache lookup checking both URL expiry and duration sanity."""
    if not video_id:
        return None
    now = time.time()
    with _CACHE_LOCK:
        cached = _STREAM_CACHE.get(video_id)
        if not cached:
            return None
        expires_at = cached.get("expires_at")
        if expires_at is None:
            expires_at = float(cached.get("ts", 0)) + _STREAM_CACHE_FALLBACK_TTL
        if now >= expires_at:
            _STREAM_CACHE.pop(video_id, None)
            return None
        cached_dur = int(cached.get("duration") or 0)
        if expected_duration > 60 and cached_dur > 0 and cached_dur < min(65, expected_duration * 0.5):
            _STREAM_CACHE.pop(video_id, None)
            return None
        if isinstance(_STREAM_CACHE, OrderedDict):
            _STREAM_CACHE.move_to_end(video_id)
        return copy.deepcopy(cached)


def _stream_cache_set(video_id: str, entry: Dict[str, Any], fallback_ttl: float = _STREAM_CACHE_FALLBACK_TTL) -> None:
    """Thread-safe bounded insertion into _STREAM_CACHE respecting googlevideo expire= timestamps."""
    if not video_id or not isinstance(entry, dict) or not entry.get("url"):
        return
    now = time.time()
    stored = copy.deepcopy(entry)
    stored.setdefault("ts", now)
    expires_at = stored.get("expires_at")
    if expires_at is None:
        expires_at = _extract_stream_expiry(stored["url"], fallback_ttl=fallback_ttl, now=stored["ts"])
    stored["expires_at"] = expires_at
    if expires_at <= now:
        return
    with _CACHE_LOCK:
        _STREAM_CACHE[video_id] = stored
        if isinstance(_STREAM_CACHE, OrderedDict):
            _STREAM_CACHE.move_to_end(video_id)
        while len(_STREAM_CACHE) > _MAX_CACHE_ENTRIES:
            _STREAM_CACHE.popitem(last=False)


def invalidate_stream_cache(video_id: str) -> None:
    """Removes a cached stream entry (e.g. after upstream HTTP 403/410)."""
    if not video_id:
        return
    with _CACHE_LOCK:
        _STREAM_CACHE.pop(video_id, None)


def _bounded_cache_get(cache: Dict[str, Any], key: str, ttl: float, ts_map: Optional[Dict[str, float]] = None) -> Optional[Any]:
    now = time.time()
    with _CACHE_LOCK:
        val = cache.get(key)
        if val is None:
            return None
        ts = ts_map.get(key, 0.0) if ts_map is not None else float(val.get("ts", 0.0))
        if (now - ts) >= ttl:
            cache.pop(key, None)
            if ts_map is not None:
                ts_map.pop(key, None)
            return None
        if isinstance(cache, OrderedDict):
            cache.move_to_end(key)
        return copy.deepcopy(val if ts_map is not None else val.get("data", val.get("tracks")))


def _bounded_cache_set(
    cache: Dict[str, Any],
    key: str,
    payload: Any,
    max_entries: int = _MAX_CACHE_ENTRIES,
    ts_map: Optional[Dict[str, float]] = None,
    wrapper_key: str = "data",
) -> None:
    now = time.time()
    with _CACHE_LOCK:
        if ts_map is not None:
            cache[key] = copy.deepcopy(payload)
            ts_map[key] = now
        else:
            cache[key] = {wrapper_key: copy.deepcopy(payload), "ts": now}
        if isinstance(cache, OrderedDict):
            cache.move_to_end(key)
        while len(cache) > max_entries:
            if isinstance(cache, OrderedDict):
                old_k, _ = cache.popitem(last=False)
            else:
                old_k = next(iter(cache))
                cache.pop(old_k, None)
            if ts_map is not None:
                ts_map.pop(old_k, None)


def register_prefetch_hook(fn: Callable[[List[str]], None]) -> None:
    """Registers an async stream-warming callback invoked after search responses."""
    global _PREFETCH_HOOK
    _PREFETCH_HOOK = fn


def _make_session() -> requests.Session:
    """Creates a pooled requests.Session configured for Innertube endpoints."""
    s = requests.Session()
    adapter = HTTPAdapter(pool_connections=16, pool_maxsize=16, max_retries=2)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return s


_SESSION = _make_session()

_IOS_CLIENT_CONTEXT = {
    "clientName": "IOS",
    "clientVersion": "20.10.4",
    "deviceMake": "Apple",
    "deviceModel": "iPhone16,2",
    "osName": "iPhone",
    "osVersion": "18.3.2.22D82",
    "hl": "en",
    "gl": "US",
}
_IOS_UA = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; US)"

_ANDROID_CLIENT_CONTEXT = {
    "clientName": "ANDROID",
    "clientVersion": "20.10.38",
    "osName": "Android",
    "osVersion": "14",
    "androidSdkVersion": 34,
    "hl": "en",
    "gl": "US",
}
_ANDROID_UA = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36"
)

_YT_WEB_CONTEXT = {
    "client": {
        "clientName": "WEB",
        "clientVersion": "2.20260918.01.00",
        "hl": "en",
        "gl": "IN",
    }
}
_YTM_SEARCH_CONTEXT = {
    "client": {
        "clientName": "WEB_REMIX",
        "clientVersion": "1.20260918.01.00",
        "hl": "en",
        "gl": "IN",
    }
}
_YTM_SONGS_PARAM = "EgWKAQIIAWoKEAkQBRAKEAMQBA=="

_PLAYLIST_KEYWORDS = (
    "playlist",
    "new ",
    "latest",
    "top ",
    "best ",
    "hits",
    "hitlist",
    "songs",
    "ost",
    "soundtrack",
    "2024",
    "2025",
    "2026",
    "collection",
    "mix",
    "chart",
    "trending",
    "essentials",
)


_VARIANT_RULES = (
    re.compile(r"\b(remix|re-mix|remixed|bootleg|vip\s+mix|club\s+mix|extended\s+mix|dj\s+mix|rework)\b", re.I),
    re.compile(r"\b(slowed|reverb|s\s*\+\s*r|daycore)\b", re.I),
    re.compile(r"\b(sped\s*up|speed\s*up|nightcore)\b", re.I),
    re.compile(r"\b(8d|16d|3d\s+audio|bass\s+boosted|sub\s+boosted)\b", re.I),
    re.compile(r"\b(lo-?fi|chill\s+mix|study\s+beats)\b", re.I),
    re.compile(
        r"\b(cover|covered\s+by|karaoke|instrumental|backing\s+track|tribute|parody|"
        r"piano\s+version|guitar\s+version|acoustic\s+version|orchestral\s+version|"
        r"lullaby|8-?bit|ringtone|ai\s+cover)\b",
        re.I,
    ),
)

_EXPLICIT_PLAYLIST_INTENT_RE = re.compile(
    r"\b(playlist|playlists|chart|charts|billboard|top\s+\d+|hitlist|countdown|best\s+of|essentials|soundtrack|ost)\b",
    re.I,
)


def parse_play_count(text: str = "") -> int:
    m = re.search(r"([\d.,]+)\s*([kKmMbB])?\s*(?:plays?|views?)\b", str(text or ""))
    if not m:
        return 0
    try:
        num = float(m.group(1).replace(",", ""))
    except ValueError:
        return 0
    if num <= 0:
        return 0
    unit = (m.group(2) or "").lower()
    mult = 1_000_000_000 if unit == "b" else 1_000_000 if unit == "m" else 1_000 if unit == "k" else 1
    return int(round(num * mult))


def is_unrequested_variant(track: Optional[Dict[str, Any]], query: str = "") -> bool:
    if not track:
        return False
    q = str(query or "")
    haystack = f"{track.get('title') or ''} {track.get('artist') or ''}"
    return any((not rule.search(q)) and bool(rule.search(haystack)) for rule in _VARIANT_RULES)


def canonical_artist_name(artist: str = "") -> str:
    cleaned = re.sub(r"\s*-\s*Topic\b", "", str(artist or ""), flags=re.I)
    cleaned = re.sub(r"\b(?:VEVO|Official)\b", "", cleaned, flags=re.I)
    first = re.split(r"\s*(?:,|&|\bfeat\.?|\bft\.?|\bx)\s*", cleaned, maxsplit=1, flags=re.I)[0]
    return first.strip().lower()


def canonical_song_title(title: str = "") -> str:
    raw = str(title or "")
    cleaned = re.sub(r"(\([^)]*\)|\[[^\]]*\])", " ", raw)
    cleaned = re.sub(r"\s+(?:feat\.?|ft\.?|featuring|with)\s+.*$", "", cleaned, flags=re.I)
    cleaned = re.sub(
        r"\s*[-–—|:]\s*(?:official|lyric|lyrics|audio|music\s+video|video|visualizer|remaster(?:ed)?|single|live|topic|full\s+song|hd|4k).*$",
        "",
        cleaned,
        flags=re.I,
    )
    cleaned = re.sub(r"[^\w\s]|_", " ", cleaned, flags=re.UNICODE)
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    if not cleaned:
        cleaned = re.sub(r"[^\w\s]|_", " ", raw, flags=re.UNICODE)
        cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return cleaned


def score_direct_search_track(
    track: Optional[Dict[str, Any]],
    query: str = "",
    consensus_artists: Optional[set] = None,
    order_idx: int = 0,
) -> float:
    if not track:
        return -1000.0
    consensus = consensus_artists or set()
    q_norm = canonical_song_title(query)
    q_raw_lower = str(query or "").strip().lower()
    t_title = canonical_song_title(track.get("title") or "")
    t_artist = canonical_artist_name(track.get("artist") or "")
    tokens = _query_tokens(str(query or ""))

    score = 0.0
    if q_norm and t_title == q_norm:
        score += 120.0
    elif q_norm and t_title and (t_title.startswith(q_norm) or q_norm.startswith(t_title)):
        score += 65.0

    if q_norm and t_title and t_artist and t_title in q_raw_lower and t_artist in q_raw_lower:
        score += 140.0
    if t_artist and q_norm and (t_artist == q_norm or q_norm in t_artist or t_artist in q_norm):
        score += 75.0

    score += _relevance(f"{t_title} {t_artist}", tokens) * 50.0
    if track.get("vibe") == "YT Music":
        score += 30.0
    if t_artist and t_artist in consensus:
        score += 35.0
    score += min(35.0, math.log10((track.get("play_count_num") or 0) + 1) * 4.5)
    score += max(0.0, 12.0 - order_idx * 0.6)

    if re.search(r"\b(?:official\s+(?:video|audio|music\s+video)|lyric\s+video)\b", track.get("title") or "", re.I):
        score -= 2.0
    if is_unrequested_variant(track, query):
        score -= 250.0
    return score


def deduplicate_search_songs(
    tracks: List[Dict[str, Any]],
    query: str = "",
    consensus_artists: Optional[set] = None,
) -> List[Dict[str, Any]]:
    scored = sorted(
        (
            (score_direct_search_track(t, query, consensus_artists, idx), idx, t)
            for idx, t in enumerate(tracks)
        ),
        key=lambda row: (-row[0], row[1]),
    )

    result: List[Dict[str, Any]] = []
    by_title_key: Dict[str, Dict[str, Any]] = {}
    seen_ids = set()

    for _, _, track in scored:
        vid = track.get("video_id")
        if not vid or vid in seen_ids:
            continue
        if not is_valid_music_track(track) or is_unrequested_variant(track, query):
            continue

        title_key = canonical_song_title(track.get("title") or "") or vid
        t_artist = canonical_artist_name(track.get("artist") or "")

        if title_key in by_title_key:
            primary = by_title_key[title_key]
            primary_artist = canonical_artist_name(primary.get("artist") or "")
            same_artist = (
                not t_artist
                or not primary_artist
                or t_artist == primary_artist
                or t_artist in primary_artist
                or primary_artist in t_artist
            )
            if same_artist and vid not in primary["fallback_ids"]:
                primary["fallback_ids"].append(vid)
            seen_ids.add(vid)
            continue

        cloned = dict(track)
        cloned["fallback_ids"] = list(track.get("fallback_ids") or [])
        seen_ids.add(vid)
        by_title_key[title_key] = cloned
        result.append(cloned)

    return result


def _fetch_ytm_watch_radio(video_id: str, max_items: int = 20) -> List[Dict[str, Any]]:
    if not video_id or len(video_id) != 11:
        return []
    try:
        resp = _SESSION.post(
            "https://music.youtube.com/youtubei/v1/next?prettyPrint=false",
            json={
                "context": _YTM_SEARCH_CONTEXT,
                "videoId": video_id,
                "playlistId": f"RDAMVM{video_id}",
                "isAudioOnly": True,
            },
            timeout=2.8,
        )
        if resp.status_code != 200:
            return []
        data = resp.json()
        out: List[Dict[str, Any]] = []
        seen = {video_id}
        for item in _find_nodes(data, "playlistPanelVideoRenderer"):
            vid = item.get("videoId", "")
            if not vid or len(vid) != 11 or vid in seen:
                continue
            seen.add(vid)
            title = _runs_text(item.get("title", {}))
            artist = (
                _runs_text(item.get("shortBylineText", {}))
                or _runs_text(item.get("longBylineText", {}))
                or "Unknown Artist"
            )
            dur = _runs_text(item.get("lengthText", {}))
            track_obj = {
                "title": title,
                "artist": artist,
                "video_id": vid,
                "fallback_ids": [],
                "duration_text": dur,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}",
                "embed_url": f"https://www.youtube.com/embed/{vid}?autoplay=1&enablejsapi=1",
                "match_tier": "Similar Vibe",
                "reason": "Similar vibe",
                "why_it_fits": "Similar vibe",
                "vibe": "YT Music",
            }
            if not is_valid_music_track(track_obj) or is_unrequested_variant(track_obj, ""):
                continue
            out.append(track_obj)
            if len(out) >= max_items:
                break
        return out
    except Exception:
        return []


def _build_curated_song_results(
    ranked_songs: List[Dict[str, Any]],
    same_artist_tracks: List[Dict[str, Any]],
    watch_radio_tracks: List[Dict[str, Any]],
    query: str = "",
    max_tracks: int = 25,
) -> List[Dict[str, Any]]:
    if not ranked_songs:
        return []
    top_song = dict(ranked_songs[0])
    top_song["match_tier"] = "Best Match"
    top_song["fallback_ids"] = list(ranked_songs[0].get("fallback_ids") or [])
    top_artist = canonical_artist_name(top_song.get("artist") or "")

    out: List[Dict[str, Any]] = [top_song]
    seen_ids = {top_song["video_id"]}
    by_title_key: Dict[str, Dict[str, Any]] = {
        (canonical_song_title(top_song.get("title") or "") or top_song["video_id"]): top_song
    }

    def try_append(raw_track: Dict[str, Any], reason_label: str) -> bool:
        vid = raw_track.get("video_id")
        if not vid or vid in seen_ids:
            return False
        if not is_valid_music_track(raw_track) or is_unrequested_variant(raw_track, query):
            return False
        t_key = canonical_song_title(raw_track.get("title") or "") or vid
        t_artist = canonical_artist_name(raw_track.get("artist") or "")
        if t_key in by_title_key:
            existing = by_title_key[t_key]
            ex_artist = canonical_artist_name(existing.get("artist") or "")
            if (
                not t_artist
                or not ex_artist
                or t_artist == ex_artist
                or t_artist in ex_artist
                or ex_artist in t_artist
            ) and vid not in existing["fallback_ids"]:
                existing["fallback_ids"].append(vid)
            seen_ids.add(vid)
            return False
        entry = dict(raw_track)
        entry["fallback_ids"] = list(raw_track.get("fallback_ids") or [])
        if not entry.get("reason") or entry["reason"] == "Similar vibe":
            entry["reason"] = reason_label
        entry["why_it_fits"] = reason_label or entry.get("why_it_fits") or entry.get("reason")
        seen_ids.add(vid)
        by_title_key[t_key] = entry
        out.append(entry)
        return True

    clean_artist_pool = [
        t
        for t in same_artist_tracks
        if (
            not top_artist
            or not canonical_artist_name(t.get("artist") or "")
            or top_artist in canonical_artist_name(t.get("artist") or "")
            or canonical_artist_name(t.get("artist") or "") in top_artist
        )
    ]

    max_len = max(len(clean_artist_pool), len(watch_radio_tracks))
    for i in range(max_len):
        if len(out) >= max_tracks:
            break
        if i < len(clean_artist_pool) and len(out) < max_tracks:
            artist_disp = top_song.get("artist") or "Artist"
            try_append(clean_artist_pool[i], f"More by {artist_disp}")
        if i < len(watch_radio_tracks) and len(out) < max_tracks:
            try_append(watch_radio_tracks[i], f"Similar vibe to {top_song.get('title') or ''}")

    for t in ranked_songs[1:]:
        if len(out) >= max_tracks:
            break
        try_append(t, t.get("reason") or "Related match")

    return out[:max_tracks]


def get_video_duration(video_id: str) -> str:
    """Fetches real video duration via fast Innertube player endpoint (0.3s) without heavy scraping."""
    if not video_id or len(video_id) != 11:
        return ""
    cached = _stream_cache_get(video_id)
    if cached and cached.get("duration"):
        return format_seconds(int(cached["duration"]))
    try:
        payload = {
            "context": {"client": _ANDROID_CLIENT_CONTEXT},
            "videoId": video_id,
        }
        resp = _SESSION.post(
            "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
            json=payload,
            timeout=2.5,
        )
        if resp.status_code == 200:
            sec = int(resp.json().get("videoDetails", {}).get("lengthSeconds") or 0)
            if sec > 0:
                return format_seconds(sec)
    except Exception:
        pass
    return ""


def _fast_innertube_audio(video_id: str) -> Optional[Dict[str, Any]]:
    """
    Ultra-fast stream resolution (0.35s) using direct Innertube player API
    (iOS and Android clients). Bypasses slow yt-dlp scraping entirely.
    """
    now = time.time()
    clients = [
        (_IOS_CLIENT_CONTEXT, _IOS_UA),
        (_ANDROID_CLIENT_CONTEXT, _ANDROID_UA),
    ]
    for client_ctx, ua in clients:
        try:
            payload = {
                "context": {"client": client_ctx},
                "videoId": video_id,
                "contentCheckOk": True,
                "racyCheckOk": True,
            }
            resp = _SESSION.post(
                "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
                json=payload,
                headers={"User-Agent": ua, "Content-Type": "application/json"},
                timeout=4.0,
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("playabilityStatus", {}).get("status") == "OK":
                    formats = data.get("streamingData", {}).get("adaptiveFormats", [])
                    audio_formats = [
                        f for f in formats
                        if (f.get("mimeType") or "").startswith("audio/") and f.get("url")
                    ]
                    if audio_formats:
                        # Prioritize AAC LC m4a (itag 140 / mp4a.40.2) and deprioritize HE-AAC (itag 139/599)
                        m4a = [f for f in audio_formats if "audio/mp4" in (f.get("mimeType") or "")]
                        non_he_m4a = [
                            f for f in m4a
                            if f.get("itag") not in (139, 599) and "mp4a.40.5" not in (f.get("mimeType") or "")
                        ]
                        cand = non_he_m4a or m4a or audio_formats
                        cand.sort(key=lambda x: -int(x.get("bitrate") or 0))
                        best = cand[0]
                        vdetails = data.get("videoDetails", {})
                        sec = int(vdetails.get("lengthSeconds") or 0)
                        clen = int(best.get("contentLength") or 0)
                        return {
                            "url": best["url"],
                            "mime": best.get("mimeType", "audio/mp4").split(";")[0],
                            "clen": clen,
                            "ua": ua,
                            "title": vdetails.get("title", ""),
                            "uploader": vdetails.get("author", ""),
                            "duration": sec,
                            "ts": now,
                        }
        except Exception:
            pass
    return None


def search_youtube_music_catalog(query: str, max_items: int = 12) -> List[Dict[str, str]]:
    """
    Queries YouTube Music's live WEB_REMIX API to fetch real, verified songs/videos
    matching the user's query so AI curation is grounded in real tracks.
    """
    q_clean = query.strip()
    if not q_clean:
        return []

    sub_queries = [q_clean, f"{q_clean} songs ost"]
    seen_titles = set()
    catalog: List[Dict[str, str]] = []

    def _fetch_one(q: str) -> List[Dict[str, str]]:
        out: List[Dict[str, str]] = []
        try:
            url = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false"
            payload = {
                "context": {
                    "client": {
                        "clientName": "WEB_REMIX",
                        "clientVersion": "1.20260918.01.00",
                        "hl": "en",
                        "gl": "US",
                    }
                },
                "query": q,
            }
            resp = _SESSION.post(url, json=payload, timeout=4.5)
            if resp.status_code != 200:
                return out
            data = resp.json()
            for item in _find_nodes(data, "musicResponsiveListItemRenderer"):
                vid = item.get("playlistItemData", {}).get("videoId", "")
                if not vid or len(vid) != 11:
                    continue
                cols = []
                for c in item.get("flexColumns", []):
                    runs = (
                        c.get("musicResponsiveListItemFlexColumnRenderer", {})
                        .get("text", {})
                        .get("runs", [])
                    )
                    cols.append("".join(x.get("text", "") for x in runs).strip())
                if len(cols) < 2:
                    continue
                title = cols[0]
                meta = cols[1]
                if "Episode" in meta or "Podcast" in meta:
                    continue
                parts = [p.strip() for p in meta.split("•") if p.strip()]
                artist = parts[1] if len(parts) >= 2 else meta
                dur_match = re.search(r"\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b", meta)
                out.append(
                    {
                        "title": title,
                        "artist": artist,
                        "video_id": vid,
                        "duration_text": dur_match.group(1) if dur_match else "",
                    }
                )
        except Exception:
            pass
        return out

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        for batch in pool.map(_fetch_one, sub_queries):
            for item in batch:
                norm = f"{item['title'].lower()}::{item['artist'].lower()}"
                if norm not in seen_titles:
                    seen_titles.add(norm)
                    catalog.append(item)
                    if len(catalog) >= max_items:
                        return catalog
    return catalog


def _yt_web_search(query: str, pages: int = 2, allow_long_mix: bool = False) -> Dict[str, Any]:
    """Exact same results (and order) as typing the query on youtube.com."""
    url = "https://www.youtube.com/youtubei/v1/search?prettyPrint=false"
    videos: List[Dict[str, Any]] = []
    playlists: List[Dict[str, Any]] = []
    seen_v, seen_p = set(), set()
    payload: Dict[str, Any] = {"context": _YT_WEB_CONTEXT, "query": query}

    for _ in range(max(1, pages)):
        try:
            r = _SESSION.post(url, json=payload, timeout=5.0)
            if r.status_code != 200:
                break
            data = r.json()
        except Exception:
            break

        for v in _find_nodes(data, "videoRenderer"):
            vid = v.get("videoId", "")
            dur = _runs_text(v.get("lengthText", {}))
            # Skip live streams / premieres (no fixed duration, not streamable as a track)
            if not vid or len(vid) != 11 or vid in seen_v or not dur:
                continue
            seen_v.add(vid)
            title = _runs_text(v.get("title", {}))
            channel = _runs_text(v.get("ownerText", {})) or _runs_text(v.get("longBylineText", {}))
            views = _runs_text(v.get("shortViewCountText", {})) or _runs_text(v.get("viewCountText", {}))
            published = _runs_text(v.get("publishedTimeText", {}))
            meta = " • ".join(x for x in (views, published) if x)
            track_obj = {
                "title": title,
                "artist": channel or "YouTube",
                "video_id": vid,
                "fallback_ids": [],
                "duration_text": dur,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}",
                "embed_url": f"https://www.youtube.com/embed/{vid}?autoplay=1&enablejsapi=1",
                "match_tier": "Direct Match",
                "reason": meta or "YouTube search result",
                "why_it_fits": meta or "YouTube search result",
                "vibe": "YouTube",
                "play_count_num": parse_play_count(views),
                "duration_sec": _duration_to_seconds(dur),
            }
            if not is_valid_music_track(track_obj, max_duration=(14400 if allow_long_mix else None)):
                continue
            videos.append(track_obj)

        for lk in _find_nodes(data, "lockupViewModel"):
            if lk.get("contentType") != "LOCKUP_CONTENT_TYPE_PLAYLIST":
                continue
            pid = lk.get("contentId", "")
            # Radio mixes (RD...) are generated per-user and can't be browsed
            if not pid or pid.startswith("RD") or pid in seen_p:
                continue
            seen_p.add(pid)
            md = lk.get("metadata", {}).get("lockupMetadataViewModel", {})
            title = md.get("title", {}).get("content", "")
            owner = ""
            for row in md.get("metadata", {}).get("contentMetadataViewModel", {}).get("metadataRows", []):
                for part in row.get("metadataParts", []):
                    txt = part.get("text", {}).get("content", "")
                    if txt and txt != "Playlist" and not owner:
                        owner = txt
            if title:
                playlists.append(
                    {
                        "browse_id": f"VL{pid}",
                        "title": title,
                        "subtitle": f"YouTube Playlist • {owner}" if owner else "YouTube Playlist",
                        "thumbnail": "",
                        "is_editorial": False,
                        "source": "youtube",
                    }
                )

        tokens = [c.get("token") for c in _find_nodes(data, "continuationCommand") if c.get("token")]
        if not tokens:
            break
        payload = {"context": _YT_WEB_CONTEXT, "continuation": tokens[0]}

    return {"videos": videos, "playlists": playlists}


def search_youtube_single(query: str) -> Optional[Dict]:
    """
    Resolves the exact structured song/video result for a query.
    Intelligently balances YouTube Web search (for long compilations, 1-hour mixes, OSTs, and exact title matches)
    and YouTube Music WEB_REMIX (for official album singles).
    """
    cache_key = query.strip().lower()
    cached = _bounded_cache_get(_SEARCH_CACHE, cache_key, _SEARCH_CACHE_TTL, ts_map=_SEARCH_CACHE_TS)
    if cached is not None:
        return cached

    try:
        tokens = _query_tokens(query)
        mix_keywords = (
            "1 hour", "1hour", "1hr", "hour", "hours", "2 hour", "3 hour",
            "mix", "compilation", "ost", "soundtrack", "bgm", "medley",
            "extended", "作業用", "full album", "theme", "epic", "battle",
            "ambient", "lofi", "beats", "non-stop", "nonstop"
        )
        is_mix_query = any(k in query.lower() for k in mix_keywords)

        # 1. Fetch web search results (robust for long mixes, compilations, and accurate titles)
        web_res = _yt_web_search(query, pages=1, allow_long_mix=is_mix_query)
        web_videos = web_res.get("videos", [])
        web_best = None
        if web_videos:
            top_w = web_videos[0]
            w_title_artist = (top_w.get("title") or "") + " " + (top_w.get("artist") or "")
            w_rel = _relevance(w_title_artist, tokens)
            web_best = (top_w, w_rel)

        # 2. Query YouTube Music WEB_REMIX
        ytm_vids: List[str] = []
        ytm_durs: List[str] = []
        ytm_best_rel = 0.0

        if not (web_best and (is_mix_query or web_best[1] >= 0.75)):
            try:
                url = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false"
                payload = {
                    "context": {
                        "client": {
                            "clientName": "WEB_REMIX",
                            "clientVersion": "1.20260918.01.00",
                            "hl": "en",
                            "gl": "US",
                        }
                    },
                    "query": query,
                }
                resp = _SESSION.post(url, json=payload, timeout=6.0)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in _find_nodes(data, "musicResponsiveListItemRenderer"):
                        vid = item.get("playlistItemData", {}).get("videoId", "")
                        if not vid or len(vid) != 11:
                            continue
                        cols = []
                        for c in item.get("flexColumns", []):
                            runs = (
                                c.get("musicResponsiveListItemFlexColumnRenderer", {})
                                .get("text", {})
                                .get("runs", [])
                            )
                            cols.append("".join(x.get("text", "") for x in runs).strip())
                        fixed = []
                        for c in item.get("fixedColumns", []):
                            runs = (
                                c.get("musicResponsiveListItemFixedColumnRenderer", {})
                                .get("text", {})
                                .get("runs", [])
                            )
                            fixed.append("".join(x.get("text", "") for x in runs).strip())

                        meta = cols[1] if len(cols) >= 2 else ""
                        if "Episode" in meta or "Podcast" in meta:
                            continue
                        if "Release - Topic" in meta or "Lights on the Ceiling" in meta:
                            continue
                        if vid not in ytm_vids:
                            ytm_vids.append(vid)
                            dur_val = ""
                            if fixed and re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", fixed[0]):
                                dur_val = fixed[0]
                            else:
                                dur_match = re.search(r"\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b", " ".join(cols + fixed))
                                if dur_match:
                                    dur_val = dur_match.group(1)
                            if dur_val:
                                ytm_durs.append(dur_val)
                            if len(ytm_vids) == 1:
                                ytm_best_rel = _relevance(" ".join(cols), tokens)
            except Exception:
                pass

        # 3. Smart selection between Web and YTM
        if web_best and (not ytm_vids or web_best[1] > ytm_best_rel or (is_mix_query and web_best[1] >= 0.3) or ytm_best_rel < 0.35):
            video_id = web_best[0]["video_id"]
            duration_text = web_best[0].get("duration_text", "")
            fallback_ids = [v["video_id"] for v in web_videos[1:4]]
        elif ytm_vids:
            video_id = ytm_vids[0]
            duration_text = ytm_durs[0] if ytm_durs else ""
            fallback_ids = ytm_vids[1:4]
        elif web_videos:
            video_id = web_videos[0]["video_id"]
            duration_text = web_videos[0].get("duration_text", "")
            fallback_ids = [v["video_id"] for v in web_videos[1:4]]
        else:
            return None

        if not duration_text or duration_text in ("3:42", "3:30", "--:--"):
            duration_text = get_video_duration(video_id)

        # Pre-verify video_id is streamable; if blocked or login required, promote first working fallback
        if video_id:
            exp_dur = parse_duration_seconds(duration_text)
            primary_stream = _fast_innertube_audio(video_id)
            if not primary_stream and fallback_ids:
                for alt_idx, alt_vid in enumerate(list(fallback_ids)):
                    alt_stream = _fast_innertube_audio(alt_vid)
                    if alt_stream and alt_stream.get("url"):
                        alt_dur = int(alt_stream.get("duration") or 0)
                        if exp_dur <= 45 or abs(alt_dur - exp_dur) <= max(55, exp_dur * 0.35):
                            fallback_ids.pop(alt_idx)
                            fallback_ids.insert(0, video_id)
                            video_id = alt_vid
                            duration_text = format_seconds(alt_dur)
                            break

        result = {
            "video_id": video_id,
            "fallback_ids": fallback_ids,
            "duration_text": duration_text,
            "thumbnail": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "embed_url": f"https://www.youtube.com/embed/{video_id}?autoplay=1&enablejsapi=1",
        }
        _bounded_cache_set(_SEARCH_CACHE, cache_key, result, ts_map=_SEARCH_CACHE_TS)
        return copy.deepcopy(result)
    except Exception as e:
        print(f"Search error for '{query}': {e}")
        return None


def browse_youtube_music_playlist(
    browse_id: str, playlist_title: str = "", playlist_subtitle: str = "", max_tracks: int = 35
) -> List[Dict[str, Any]]:
    """
    Fetches tracks inside a prepared YouTube Music playlist (browseId starting with 'VL')
    with zero LLM token usage.
    """
    if not browse_id:
        return []
    cached = _bounded_cache_get(_PLAYLIST_BROWSE_CACHE, browse_id, _PLAYLIST_BROWSE_CACHE_TTL)
    if cached is not None:
        return cached

    try:
        url = "https://music.youtube.com/youtubei/v1/browse?prettyPrint=false"
        payload = {
            "context": {
                "client": {
                    "clientName": "WEB_REMIX",
                    "clientVersion": "1.20260918.01.00",
                    "hl": "en",
                    "gl": "IN",
                }
            },
            "browseId": browse_id,
        }
        resp = _SESSION.post(url, json=payload, timeout=5.5)
        if resp.status_code != 200:
            return []
        data = resp.json()
        tracks: List[Dict[str, Any]] = []
        seen_vids = set()

        for item in _find_nodes(data, "musicResponsiveListItemRenderer"):
            vid = item.get("playlistItemData", {}).get("videoId", "")
            if not vid or len(vid) != 11 or vid in seen_vids:
                continue

            cols = [_extract_runs_text(c, "musicResponsiveListItemFlexColumnRenderer") for c in item.get("flexColumns", [])]
            fixed = [_extract_runs_text(c, "musicResponsiveListItemFixedColumnRenderer") for c in item.get("fixedColumns", [])]

            title = cols[0] if cols else ""
            artist = cols[1] if len(cols) > 1 else "Unknown Artist"
            extra = cols[2] if len(cols) > 2 else ""
            if not title:
                continue
            if "Episode" in artist or "Podcast" in artist or "Release - Topic" in artist:
                continue

            dur = ""
            if fixed and re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", fixed[0]):
                dur = fixed[0]
            else:
                dur_m = re.search(r"\b((?:\d{1,2}:)?\d{1,2}:\d{2})\b", " ".join(cols + fixed))
                if dur_m:
                    dur = dur_m.group(1)

            seen_vids.add(vid)
            reason_parts = []
            if extra:
                reason_parts.append(extra)
            if playlist_title:
                reason_parts.append(f"Featured in {playlist_title}")
            reason_str = " • ".join(reason_parts) if reason_parts else "Featured track from official playlist"

            track_obj = {
                "title": title,
                "artist": artist,
                "video_id": vid,
                "fallback_ids": [],
                "duration_text": dur,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}",
                "embed_url": f"https://www.youtube.com/embed/{vid}?autoplay=1&enablejsapi=1",
                "match_tier": "Direct Match",
                "reason": reason_str,
                "why_it_fits": reason_str,
                "vibe": "Playlist",
            }
            if not is_valid_music_track(track_obj):
                continue
            tracks.append(track_obj)
            if len(tracks) >= max_tracks:
                break

        _bounded_cache_set(_PLAYLIST_BROWSE_CACHE, browse_id, tracks, wrapper_key="tracks")
        return copy.deepcopy(tracks)
    except Exception as e:
        print(f"Playlist browse error for '{browse_id}': {e}")
        return []


def _ytm_search(query: str, songs_only: bool) -> Dict[str, Any]:
    """Queries YouTube Music WEB_REMIX search endpoint optionally filtered to Songs."""
    url = "https://music.youtube.com/youtubei/v1/search?prettyPrint=false"
    body: Dict[str, Any] = {"context": _YTM_SEARCH_CONTEXT, "query": query}
    if songs_only:
        body["params"] = _YTM_SONGS_PARAM
    try:
        r = _SESSION.post(url, json=body, timeout=5.0)
        return r.json() if r.status_code == 200 else {}
    except Exception:
        return {}


def _parse_ytm_songs(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extracts validated song track objects and cross-populated fallbacks from WEB_REMIX JSON."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in _find_nodes(data, "musicResponsiveListItemRenderer"):
        vid = item.get("playlistItemData", {}).get("videoId", "")
        if not vid or len(vid) != 11 or vid in seen:
            continue
        cols = [_extract_runs_text(c, "musicResponsiveListItemFlexColumnRenderer") for c in item.get("flexColumns", [])]
        fixed = [_extract_runs_text(c, "musicResponsiveListItemFixedColumnRenderer") for c in item.get("fixedColumns", [])]
        if not cols or not cols[0]:
            continue
        meta = cols[1] if len(cols) > 1 else ""
        plays = cols[2] if len(cols) > 2 else ""
        if any(b in meta for b in ("Episode", "Podcast", "Release - Topic")):
            continue
        parts = [p.strip() for p in meta.split("•") if p.strip()]
        if parts and parts[0] in ("Song", "Video"):
            parts = parts[1:]
        dur = ""
        if fixed and re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", fixed[0]):
            dur = fixed[0]
        elif parts and re.match(r"^\d{1,2}:\d{2}(:\d{2})?$", parts[-1]):
            dur = parts.pop()
        else:
            m = re.search(r"\b(\d{1,2}:\d{2}(?::\d{2})?)\b", " ".join(cols + fixed))
            if m:
                dur = m.group(1)
        artist = parts[0] if parts else "Unknown Artist"
        album = parts[1] if len(parts) > 1 and not re.search(r"\b(?:plays?|views?)\b", parts[1], re.I) else ""
        bits = []
        if album and album.lower() != cols[0].lower():
            bits.append(f"Album: {album}")
        if plays:
            bits.append(plays)
        reason = " • ".join(bits) if bits else "YouTube Music song"
        track_obj = {
            "title": cols[0],
            "artist": artist,
            "video_id": vid,
            "fallback_ids": [],
            "duration_text": dur,
            "play_count_num": parse_play_count(f"{meta} {plays}"),
            "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
            "url": f"https://www.youtube.com/watch?v={vid}",
            "embed_url": f"https://www.youtube.com/embed/{vid}?autoplay=1&enablejsapi=1",
            "match_tier": "Direct Match",
            "reason": reason,
            "why_it_fits": reason,
            "vibe": "YT Music",
        }
        if not is_valid_music_track(track_obj):
            continue
        seen.add(vid)
        out.append(track_obj)
        if len(out) >= 25:
            break

    # Cross-populate fallback_ids among songs with matching titles
    for i in range(len(out)):
        t_a = out[i]
        clean_a = re.sub(r"[^a-z0-9]", "", (t_a.get("title") or "").lower())
        fallbacks = []
        for j in range(len(out)):
            if i == j:
                continue
            t_b = out[j]
            clean_b = re.sub(r"[^a-z0-9]", "", (t_b.get("title") or "").lower())
            if clean_a and clean_b and (clean_a in clean_b or clean_b in clean_a):
                b_vid = t_b.get("video_id")
                if b_vid and b_vid not in fallbacks:
                    fallbacks.append(b_vid)
        t_a["fallback_ids"] = fallbacks

    return out


def _parse_ytm_playlists(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Extracts browseable VL* playlist descriptors from WEB_REMIX JSON."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in _find_nodes(data, "musicResponsiveListItemRenderer"):
        bid = item.get("navigationEndpoint", {}).get("browseEndpoint", {}).get("browseId", "")
        if not bid.startswith("VL") or bid in seen:
            continue
        cols = [_extract_runs_text(c, "musicResponsiveListItemFlexColumnRenderer") for c in item.get("flexColumns", [])]
        if not cols or not cols[0]:
            continue
        meta = cols[1] if len(cols) > 1 else "Playlist"
        seen.add(bid)
        out.append(
            {
                "browse_id": bid,
                "title": cols[0],
                "subtitle": meta,
                "thumbnail": "",
                "is_editorial": "YouTube Music" in meta or bid.startswith("VLRDCLAK"),
                "source": "ytmusic",
            }
        )
    return out


def direct_search_youtube_music(query: str, mode: str = "auto") -> Dict[str, Any]:
    """
    Zero-token direct search combining YouTube Music songs, web music tracks, and playlists.
    """
    q_clean = query.strip()
    if not q_clean:
        return {"playlist_title": "Direct Search", "tracks": [], "matched_playlists": [], "song_results": []}

    cache_key = f"{q_clean.lower()}::{mode}"
    cached = _bounded_cache_get(_DIRECT_SEARCH_CACHE, cache_key, _DIRECT_SEARCH_CACHE_TTL)
    if cached is not None:
        return cached

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_yt = pool.submit(_yt_web_search, q_clean, 2)
        f_ytm_songs = pool.submit(_ytm_search, q_clean, True)
        f_ytm_all = pool.submit(_ytm_search, q_clean, False)
        yt = f_yt.result()
        ytm_songs = _parse_ytm_songs(f_ytm_songs.result())
        ytm_playlists = _parse_ytm_playlists(f_ytm_all.result())

    youtube_results = yt["videos"][:40]
    tokens = _query_tokens(q_clean)

    candidate_pls = yt["playlists"] + ytm_playlists
    matched_playlists: List[Dict[str, Any]] = []
    seen_titles = set()
    for pl in candidate_pls:
        key = pl["title"].strip().lower()
        if key in seen_titles:
            continue
        score = _relevance(pl["title"], tokens)
        if score < 0.5:
            continue
        seen_titles.add(key)
        pl["relevance"] = round(score, 2)
        matched_playlists.append(pl)
    matched_playlists.sort(key=lambda p: -p["relevance"])
    matched_playlists = matched_playlists[:6]

    valid_ytm = [t for t in ytm_songs if is_valid_music_track(t)]
    valid_yt = [t for t in youtube_results if is_valid_music_track(t)]

    has_explicit_playlist_words = bool(_EXPLICIT_PLAYLIST_INTENT_RE.search(q_clean))
    wants_playlist = mode == "playlists" or (mode == "auto" and has_explicit_playlist_words)
    wants_ytm = mode == "songs"

    ytm_top_artists = {canonical_artist_name(t.get("artist") or "") for t in valid_ytm[:3] if t.get("artist")}
    yt_top_artists = {canonical_artist_name(t.get("artist") or "") for t in valid_yt[:3] if t.get("artist")}
    consensus_artists = {a for a in (ytm_top_artists & yt_top_artists) if a}
    q_norm_title = canonical_song_title(q_clean)
    if valid_ytm and canonical_song_title(valid_ytm[0].get("title") or "") == q_norm_title:
        a0 = canonical_artist_name(valid_ytm[0].get("artist") or "")
        if a0:
            consensus_artists.add(a0)

    clean_yt_videos = deduplicate_search_songs(valid_yt, q_clean, consensus_artists)
    ranked_songs = deduplicate_search_songs(valid_ytm + valid_yt, q_clean, consensus_artists)

    final_songs = ranked_songs
    if not wants_playlist and not has_explicit_playlist_words and ranked_songs and ranked_songs[0].get("video_id"):
        top_song = ranked_songs[0]
        top_artist_raw = re.split(r",|&|\bfeat\.?|\bft\.?", str(top_song.get("artist") or ""), maxsplit=1, flags=re.I)[0].strip()
        top_artist_norm = canonical_artist_name(top_artist_raw)
        should_fetch_artist = bool(
            top_artist_norm
            and top_artist_norm not in ("unknown artist", "youtube")
            and top_artist_norm != q_norm_title
        )
        watch_radio_tracks: List[Dict[str, Any]] = []
        same_artist_tracks: List[Dict[str, Any]] = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            f_radio = pool.submit(_fetch_ytm_watch_radio, top_song["video_id"], 20)
            f_artist = pool.submit(lambda: _parse_ytm_songs(_ytm_search(f"{top_artist_raw} top songs", True))) if should_fetch_artist else None
            try:
                watch_radio_tracks = f_radio.result(timeout=3.2)
            except Exception:
                watch_radio_tracks = []
            if f_artist is not None:
                try:
                    same_artist_tracks = f_artist.result(timeout=3.2)
                except Exception:
                    same_artist_tracks = []
        final_songs = _build_curated_song_results(ranked_songs, same_artist_tracks, watch_radio_tracks, q_clean, 25)

    active_source = "songs" if final_songs else ("youtube" if clean_yt_videos else "songs")
    active_browse_id = ""
    tracks = final_songs if final_songs else clean_yt_videos
    playlist_title = f'"{q_clean}"'
    vibe = f"Music tracks : {len(tracks)} songs"

    if wants_ytm and final_songs:
        active_source = "songs"
        tracks = final_songs
        vibe = f"Music tracks : {len(final_songs)} songs"
    elif wants_playlist and matched_playlists:
        top = matched_playlists[0]
        pl_tracks = browse_youtube_music_playlist(top["browse_id"], top["title"], top["subtitle"])
        clean_pl_tracks = [t for t in pl_tracks if is_valid_music_track(t)]
        if clean_pl_tracks:
            tracks = clean_pl_tracks
            active_source = "playlist"
            active_browse_id = top["browse_id"]
            playlist_title = top["title"]
            vibe = f"Curated playlist : {len(clean_pl_tracks)} tracks"

    if not tracks:
        tracks = final_songs if final_songs else clean_yt_videos
        active_source = "songs" if final_songs else "youtube"

    if tracks and _PREFETCH_HOOK:
        _PREFETCH_HOOK([t["video_id"] for t in tracks[:3] if t.get("video_id")])

    result_payload = {
        "playlist_title": playlist_title,
        "subtitle": vibe,
        "vibe_description": vibe,
        "curator_note": vibe,
        "used_model": "direct-search (0 tokens)",
        "requested_model": "direct-search",
        "is_fallback": False,
        "is_direct_search": True,
        "search_query": q_clean,
        "active_source": active_source,
        "active_browse_id": active_browse_id,
        "matched_playlists": matched_playlists,
        "youtube_results": clean_yt_videos,
        "song_results": final_songs,
        "tracks": tracks,
    }
    _bounded_cache_set(_DIRECT_SEARCH_CACHE, cache_key, result_payload, wrapper_key="data")
    return copy.deepcopy(result_payload)
