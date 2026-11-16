"""Audio stream resolution (Innertube, yt-dlp, JioSaavn, SoundCloud) and batch warming."""

import concurrent.futures
import os
import re
import threading
import time
import urllib.parse
from typing import Any, Dict, List, Optional
import yt_dlp

from .innertube_client import (
    _IOS_CLIENT_CONTEXT,
    _IOS_UA,
    _SESSION,
    _STREAM_CACHE,
    _fast_innertube_audio,
    get_video_duration,
    register_prefetch_hook,
    search_youtube_music_catalog,
    search_youtube_single,
)
from .track_filters import _duration_to_seconds

_YDL_LOCAL = threading.local()
_SC_CLIENT_ID = "xk6BGxLCsQJ5Ss0bH6sRdsZhts3gTNaU"


def _get_ydl() -> yt_dlp.YoutubeDL:
    """Returns a thread-local yt_dlp.YoutubeDL configured for high-quality m4a audio."""
    ydl = getattr(_YDL_LOCAL, "ydl", None)
    if ydl is None:
        ydl = yt_dlp.YoutubeDL(
            {
                "format": "bestaudio[ext=m4a][format_id!=139][format_id!=599]/bestaudio[ext=m4a]/bestaudio/best",
                "quiet": True,
                "no_warnings": True,
                "noplaylist": True,
                "skip_download": True,
                "cachedir": False,
                "socket_timeout": 15,
                "retries": 3,
                "extractor_args": {
                    "youtube": {
                        "player_client": ["android", "ios", "web"],
                    }
                },
            }
        )
        _YDL_LOCAL.ydl = ydl
    return ydl


def _get_sc_client_id(force_refresh: bool = False) -> str:
    """Retrieves or refreshes an anonymous SoundCloud API v2 client_id."""
    global _SC_CLIENT_ID
    if _SC_CLIENT_ID and not force_refresh:
        return _SC_CLIENT_ID
    try:
        html = _SESSION.get("https://soundcloud.com", timeout=4).text
        scripts = re.findall(r'src="(https://a-v2\.sndcdn\.com/assets/[^"]+\.js)"', html)
        for s in reversed(scripts[-4:]):
            js = _SESSION.get(s, timeout=4).text
            m = re.search(r'client_id:"([a-zA-Z0-9]{32})"', js)
            if m:
                _SC_CLIENT_ID = m.group(1)
                return _SC_CLIENT_ID
    except Exception:
        pass
    return _SC_CLIENT_ID


def _resolve_cloud_fallback_audio(
    video_id: str, title: str = "", artist: str = "", expected_duration: int = 0
) -> Optional[Dict[str, Any]]:
    """
    Cloud-safe audio resolver when YouTube blocks direct IP stream requests.
    Checks alternative YouTube Music uploads, JioSaavn 320kbps AAC, and SoundCloud API v2.
    """
    now = time.time()
    clean_title = (title or "").strip()
    clean_artist = (artist or "").strip()

    if video_id and (not clean_title or expected_duration <= 0):
        try:
            pl_resp = _SESSION.post(
                "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
                json={
                    "context": {"client": _IOS_CLIENT_CONTEXT},
                    "videoId": video_id,
                    "contentCheckOk": True,
                    "racyCheckOk": True,
                },
                headers={"User-Agent": _IOS_UA, "Content-Type": "application/json"},
                timeout=3.0,
            )
            if pl_resp.status_code == 200:
                pld = pl_resp.json()
                vd = pld.get("videoDetails", {})
                if not clean_title and vd.get("title"):
                    clean_title = vd.get("title")
                if not clean_artist and vd.get("author"):
                    clean_artist = vd.get("author")
                if expected_duration <= 0 and vd.get("lengthSeconds"):
                    expected_duration = int(vd.get("lengthSeconds") or 0)
        except Exception:
            pass

    if not clean_title and video_id:
        try:
            oe = _SESSION.get(
                "https://www.youtube.com/oembed",
                params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
                timeout=3.5,
            )
            if oe.status_code == 200:
                oed = oe.json()
                clean_title = (oed.get("title") or "").strip()
                if not clean_artist:
                    clean_artist = re.sub(r"\s*-\s*Topic$", "", (oed.get("author_name") or "").strip(), flags=re.I)
        except Exception:
            pass

    if not clean_title:
        return None

    search_title = re.sub(
        r"(\(|\[)\s*(official\s*(music\s*)?video|official\s*audio|lyric(s)?(\s*video)?|audio|hd|4k|hq|visualizer|full\s*video|full\s*song)\s*(\)|\])",
        "",
        clean_title,
        flags=re.I,
    ).strip()
    search_artist = re.sub(r"\s*-\s*Topic$|VEVO$", "", clean_artist, flags=re.I).strip()
    if search_artist.lower() in ("jusa music", "unknown artist", "unknown"):
        search_artist = ""

    if search_artist and search_artist.lower() in search_title.lower():
        query = search_title
    else:
        query = f"{search_title} {search_artist}".strip()

    q_lower = query.lower()
    avoid_words = ["karaoke", "instrumental", "tribute", "8-bit", "lullaby", "ringtone", "nightcore", "slowed", "reverb", "sped up"]
    active_avoid = [w for w in avoid_words if w not in q_lower]

    title_words = [
        w for w in re.findall(r"[a-z0-9]+", search_title.lower())
        if len(w) > 2 and w not in ("official", "audio", "video", "lyrics", "lyric", "full")
    ]
    artist_words = [w for w in re.findall(r"[a-z0-9]+", search_artist.lower()) if len(w) > 2]

    # Tier 1: Unblocked YouTube alternative resolution
    try:
        catalog_candidates = search_youtube_music_catalog(f"{search_title} {search_artist}".strip())
        for c in catalog_candidates[:5]:
            alt_vid = c.get("video_id")
            if alt_vid and alt_vid != video_id:
                alt_stream = _fast_innertube_audio(alt_vid)
                if alt_stream and alt_stream.get("url"):
                    alt_dur = int(alt_stream.get("duration") or 0)
                    if expected_duration > 45 and abs(alt_dur - expected_duration) > max(55, expected_duration * 0.35):
                        continue
                    alt_stream["video_id"] = alt_vid
                    return alt_stream
    except Exception:
        pass

    # Tier A: JioSaavn 320kbps direct .m4a stream
    try:
        sr = _SESSION.get(
            "https://saavn.sumit.co/api/search/songs",
            params={"query": query, "limit": 5},
            timeout=4.0,
        )
        if sr.status_code == 200:
            results = sr.json().get("data", {}).get("results") or []
            for s in results:
                s_name = (s.get("name") or "").lower()
                s_label = (s.get("label") or "").lower()
                s_artists = " ".join(
                    a.get("name", "") for a in (s.get("artists", {}).get("primary") or [])
                ).lower()
                combined = f"{s_name} {s_label} {s_artists}"
                if any(w in combined for w in active_avoid):
                    continue
                if title_words and not all(w in combined for w in title_words[:2]):
                    continue
                if artist_words and not any(w in combined for w in artist_words):
                    continue
                s_dur = int(s.get("duration") or 0)
                if s_dur < 65 and expected_duration > 75:
                    continue
                if expected_duration > 45 and abs(s_dur - expected_duration) > max(45, expected_duration * 0.35):
                    continue
                dl_urls = s.get("downloadUrl") or []
                best_dl = dl_urls[-1].get("url") if dl_urls else None
                if best_dl:
                    return {
                        "url": best_dl,
                        "mime": "audio/mp4",
                        "clen": 0,
                        "ua": "Mozilla/5.0",
                        "title": clean_title,
                        "uploader": clean_artist or s_artists,
                        "duration": s_dur,
                        "ts": now,
                    }
    except Exception:
        pass

    # Tier B: SoundCloud API v2 full-length AAC (.m4a fMP4) stream
    for attempt in range(2):
        cid = _get_sc_client_id(force_refresh=(attempt == 1))
        try:
            sc_res = _SESSION.get(
                "https://api-v2.soundcloud.com/search/tracks",
                params={"q": query, "client_id": cid, "limit": 10},
                timeout=4.5,
            )
            if sc_res.status_code in (401, 403) and attempt == 0:
                continue
            if sc_res.status_code == 200:
                collection = sc_res.json().get("collection") or []
                candidates = []
                for t in collection:
                    dur_ms = int(t.get("duration") or 0)
                    dur_sec = dur_ms // 1000
                    full_dur_ms = int(t.get("full_duration") or dur_ms)

                    if t.get("policy") == "SNIP":
                        continue
                    if full_dur_ms > 0 and dur_ms < full_dur_ms * 0.7:
                        continue
                    if dur_ms < 65000 and not any(k in q_lower for k in ("intro", "outro", "interlude", "skit", "short")):
                        continue
                    if expected_duration > 45 and abs(dur_sec - expected_duration) > max(45, expected_duration * 0.35):
                        continue

                    t_title = (t.get("title") or "").lower()
                    t_user = (t.get("user", {}).get("username") or "").lower()
                    combined = f"{t_title} {t_user}"

                    if title_words:
                        matched_words = sum(1 for w in title_words if w in t_title)
                        if matched_words < min(len(title_words), 2):
                            continue

                    penalty = sum(1 for w in active_avoid if w in combined) * 10
                    if "cover" in combined and "cover" not in q_lower:
                        penalty += 5
                    if dur_ms > 480000 and "mix" not in q_lower and "hour" not in q_lower:
                        penalty += 8
                    candidates.append((penalty, t))

                candidates.sort(key=lambda x: x[0])
                for _, best_t in candidates:
                    trans = best_t.get("media", {}).get("transcodings") or []
                    chosen_tr = (
                        next((tr for tr in trans if not tr.get("snipped") and tr.get("preset") == "aac_160k"), None)
                        or next((tr for tr in trans if not tr.get("snipped") and "aac" in (tr.get("preset") or "")), None)
                        or next((tr for tr in trans if not tr.get("snipped") and (tr.get("format", {}).get("protocol") == "progressive")), None)
                    )
                    if not chosen_tr:
                        continue
                    tr_res = _SESSION.get(chosen_tr["url"], params={"client_id": cid}, timeout=4.0)
                    if tr_res.status_code != 200:
                        continue
                    stream_target = tr_res.json().get("url")
                    if not stream_target:
                        continue

                    cand_dur = int((best_t.get("duration") or 0) // 1000)
                    if chosen_tr.get("format", {}).get("protocol") == "progressive":
                        return {
                            "url": stream_target,
                            "mime": "audio/mpeg",
                            "clen": 0,
                            "ua": "Mozilla/5.0",
                            "title": clean_title,
                            "uploader": clean_artist,
                            "duration": cand_dur,
                            "ts": now,
                        }

                    m3u8_text = _SESSION.get(stream_target, timeout=4.0).text
                    map_m = re.search(r'#EXT-X-MAP:URI="([^"]+)"', m3u8_text)
                    seg_urls = [line.strip() for line in m3u8_text.splitlines() if line.strip().startswith("http")]
                    if map_m:
                        seg_urls.insert(0, map_m.group(1))
                    if seg_urls:
                        return {
                            "url": seg_urls[0],
                            "segment_urls": seg_urls,
                            "mime": "audio/mp4",
                            "clen": 0,
                            "ua": "Mozilla/5.0",
                            "title": clean_title,
                            "uploader": clean_artist,
                            "duration": cand_dur,
                            "ts": now,
                        }
            break
        except Exception:
            pass

    return None


def get_audio_stream_url(
    video_id: str, title: str = "", artist: str = "", expected_duration: int = 0
) -> Optional[Dict[str, Any]]:
    """
    Resolves the direct high-quality m4a audio stream URL for any YouTube video_id
    using ultra-fast Innertube player endpoint (0.35s) with yt-dlp and cloud-safe fallbacks.
    Caches stream URLs for 25 minutes.
    """
    if not video_id:
        return None

    if "v=" in video_id:
        video_id = video_id.split("v=")[1].split("&")[0].split("/")[0]
    elif "youtu.be/" in video_id:
        video_id = video_id.split("youtu.be/")[1].split("?")[0].split("/")[0]
    elif "/" in video_id:
        video_id = video_id.split("/")[-1].split("?")[0]
    video_id = video_id.split("&")[0].split("?")[0].strip()

    now = time.time()
    cached = _STREAM_CACHE.get(video_id)
    if cached and (now - cached.get("ts", 0)) < 1500:
        cached_dur = int(cached.get("duration") or 0)
        if expected_duration > 60 and cached_dur > 0 and cached_dur < min(65, expected_duration * 0.5):
            _STREAM_CACHE.pop(video_id, None)
        else:
            return cached

    if os.environ.get("VERCEL"):
        try:
            fast_info = _fast_innertube_audio(video_id)
            if fast_info and fast_info.get("url"):
                probe = _SESSION.get(
                    fast_info["url"],
                    headers={"User-Agent": fast_info.get("ua", "Mozilla/5.0"), "Range": "bytes=0-1"},
                    stream=True,
                    timeout=3.0,
                )
                probe.close()
                if probe.status_code in (200, 206):
                    _STREAM_CACHE[video_id] = fast_info
                    return fast_info
        except Exception as e:
            print(f"Innertube audio error for {video_id}: {e}")

        cloud_info = _resolve_cloud_fallback_audio(
            video_id, title=title, artist=artist, expected_duration=expected_duration
        )
        if cloud_info and cloud_info.get("url"):
            _STREAM_CACHE[video_id] = cloud_info
            return cloud_info

    try:
        ydl = _get_ydl()
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        stream_url = info.get("url")

        if not stream_url and info.get("formats"):
            audio_formats = [
                f for f in info["formats"]
                if f.get("url") and (f.get("acodec") != "none" or "audio" in (f.get("mimeType") or ""))
            ]
            if audio_formats:
                m4a_fmts = [f for f in audio_formats if f.get("ext") == "m4a"]
                best_fmt = (m4a_fmts or audio_formats)[-1]
                stream_url = best_fmt.get("url")

        if stream_url:
            ext = info.get("ext", "m4a")
            mime = "audio/mp4" if ext == "m4a" else f"audio/{ext}"
            clen = int(info.get("filesize") or info.get("filesize_approx") or 0)
            if not clen:
                qs = urllib.parse.parse_qs(urllib.parse.urlparse(stream_url).query)
                if "clen" in qs:
                    clen = int(qs["clen"][0])
            ua = (info.get("http_headers") or {}).get(
                "User-Agent",
                (
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
                ),
            )
            entry = {
                "url": stream_url,
                "mime": mime,
                "clen": clen,
                "ua": ua,
                "title": info.get("title", ""),
                "uploader": info.get("uploader", ""),
                "duration": info.get("duration", 0),
                "ts": now,
            }
            _STREAM_CACHE[video_id] = entry
            return entry
    except Exception as e:
        print(f"yt-dlp stream extraction error for {video_id}: {e}")

    try:
        fast_info = _fast_innertube_audio(video_id)
        if fast_info and fast_info.get("url"):
            _STREAM_CACHE[video_id] = fast_info
            return fast_info
    except Exception as e:
        print(f"Innertube fallback audio error for {video_id}: {e}")

    try:
        cloud_info = _resolve_cloud_fallback_audio(
            video_id, title=title, artist=artist, expected_duration=expected_duration
        )
        if cloud_info and cloud_info.get("url"):
            _STREAM_CACHE[video_id] = cloud_info
            return cloud_info
    except Exception as e:
        print(f"Cloud fallback audio error for {video_id}: {e}")

    return None


def prefetch_streams_async(video_ids: List[str]) -> None:
    """Warm up the stream cache in the background for the top tracks in a playlist."""
    def _warm(vid: str):
        if vid and vid not in _STREAM_CACHE:
            get_audio_stream_url(vid)

    pool = concurrent.futures.ThreadPoolExecutor(max_workers=3)
    for v in video_ids[:3]:
        pool.submit(_warm, v)
    pool.shutdown(wait=False)


register_prefetch_hook(prefetch_streams_async)


def resolve_tracks_batch(tracks: List[Dict]) -> List[Dict]:
    """Resolves video IDs, fallback IDs, real durations, and thumbnails in parallel."""

    def _resolve_one(track: Dict) -> Dict:
        vid = track.get("video_id", "")
        dur_text = track.get("duration_text", "")
        title_lower = (track.get("title") or "").lower()
        is_hour_title = any(h in title_lower for h in ("1 hour", "1hour", "1hr", "2 hour", "3 hour"))
        dur_sec = _duration_to_seconds(dur_text) if dur_text else 0
        is_dur_mismatch = is_hour_title and 0 < dur_sec < 1200

        has_valid_dur = bool(dur_text) and dur_text not in ("--:--", "3:30", "3:42", "3:00", "8:29", "8:08") and not is_dur_mismatch

        if vid and len(vid) == 11 and not is_dur_mismatch:
            if not has_valid_dur:
                real_d = get_video_duration(vid)
                if real_d:
                    track["duration_text"] = real_d
                    dur_sec = _duration_to_seconds(real_d)
                    is_dur_mismatch = is_hour_title and 0 < dur_sec < 1200
            if not is_dur_mismatch:
                if not track.get("thumbnail"):
                    track["thumbnail"] = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg"
                track["url"] = f"https://www.youtube.com/watch?v={vid}"
                track["embed_url"] = f"https://www.youtube.com/embed/{vid}?autoplay=1&enablejsapi=1"
                if "fallback_ids" not in track:
                    track["fallback_ids"] = []
                return track

        search_q = track.get("search_query") or f"{track.get('title', '')} {track.get('artist', '')}"
        matched = search_youtube_single(search_q)
        if matched:
            track["video_id"] = matched["video_id"]
            track["fallback_ids"] = list(matched.get("fallback_ids", []))
            track["thumbnail"] = matched["thumbnail"]
            track["duration_text"] = matched.get("duration_text", "")
            track["url"] = matched["url"]
            track["embed_url"] = matched["embed_url"]
        else:
            q_enc = urllib.parse.quote(f"{track.get('title', '')} {track.get('artist', '')}")
            track["video_id"] = vid or ""
            track["fallback_ids"] = []
            track["thumbnail"] = f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg" if vid else ""
            track["duration_text"] = ""
            track["url"] = f"https://www.youtube.com/results?search_query={q_enc}"
            track["embed_url"] = ""

        if (not track.get("duration_text") or track.get("duration_text") in ("--:--", "3:30", "3:42", "3:00", "8:29", "8:08")) and track.get("video_id"):
            track["duration_text"] = get_video_duration(track["video_id"])
        return track

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        resolved = list(executor.map(_resolve_one, tracks))

    used_vids = set()
    for tr in resolved:
        vid = tr.get("video_id", "")
        if vid and vid in used_vids:
            for alt_id in tr.get("fallback_ids", []):
                if alt_id and alt_id not in used_vids:
                    tr["video_id"] = alt_id
                    tr["thumbnail"] = f"https://i.ytimg.com/vi/{alt_id}/hqdefault.jpg"
                    tr["url"] = f"https://www.youtube.com/watch?v={alt_id}"
                    tr["embed_url"] = f"https://www.youtube.com/embed/{alt_id}?autoplay=1&enablejsapi=1"
                    vid = alt_id
                    break
        if vid:
            used_vids.add(vid)

    top_vids = [tr.get("video_id", "") for tr in resolved if tr.get("video_id")]
    if top_vids:
        prefetch_streams_async(top_vids)

    return resolved
