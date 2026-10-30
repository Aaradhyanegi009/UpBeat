import concurrent.futures
import os
import re
import time
import urllib.parse
from typing import Dict, List, Optional, Any
import requests
from requests.adapters import HTTPAdapter
import yt_dlp

_SEARCH_CACHE: Dict[str, Dict] = {}
_STREAM_CACHE: Dict[str, Dict[str, Any]] = {}


def _make_session() -> requests.Session:
    s = requests.Session()
    adapter = HTTPAdapter(pool_connections=16, pool_maxsize=16, max_retries=2)
    s.mount("https://", adapter)
    s.mount("http://", adapter)
    s.headers.update(
        {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return s


_SESSION = _make_session()


def _find_nodes(obj: Any, target_key: str):
    if isinstance(obj, dict):
        if target_key in obj:
            yield obj[target_key]
        for v in obj.values():
            yield from _find_nodes(v, target_key)
    elif isinstance(obj, list):
        for item in obj:
            yield from _find_nodes(item, target_key)


import threading

_YDL_LOCAL = threading.local()


def _get_ydl() -> yt_dlp.YoutubeDL:
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


def format_seconds(sec: int) -> str:
    if not sec or sec <= 0:
        return ""
    h = sec // 3600
    m = (sec % 3600) // 60
    s = sec % 60
    if h > 0:
        return f"{h}:{m:02d}:{s:02d}"
    return f"{m}:{s:02d}"


def parse_duration_seconds(text: str) -> int:
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


def get_video_duration(video_id: str) -> str:
    """Fetches real video duration via fast Innertube player endpoint (0.3s) without heavy scraping."""
    if not video_id or len(video_id) != 11:
        return ""
    if video_id in _STREAM_CACHE and _STREAM_CACHE[video_id].get("duration"):
        return format_seconds(int(_STREAM_CACHE[video_id]["duration"]))
    try:
        payload = {
            "context": {
                "client": {
                    "clientName": "ANDROID",
                    "clientVersion": "20.10.38",
                    "osName": "Android",
                    "osVersion": "14",
                    "androidSdkVersion": 34,
                    "hl": "en",
                    "gl": "US",
                }
            },
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
        (
            {
                "clientName": "IOS",
                "clientVersion": "20.10.4",
                "deviceMake": "Apple",
                "deviceModel": "iPhone16,2",
                "osName": "iPhone",
                "osVersion": "18.3.2.22D82",
                "hl": "en",
                "gl": "US",
            },
            "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; US)",
        ),
        (
            {
                "clientName": "ANDROID",
                "clientVersion": "20.10.38",
                "osName": "Android",
                "osVersion": "14",
                "androidSdkVersion": 34,
                "hl": "en",
                "gl": "US",
            },
            "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36",
        ),
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


_SC_CLIENT_ID = "xk6BGxLCsQJ5Ss0bH6sRdsZhts3gTNaU"


def _get_sc_client_id(force_refresh: bool = False) -> str:
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
    1. Resolves canonical title, artist, and duration via YouTube Innertube / oEmbed.
    2. Checks JioSaavn 320kbps AAC (.m4a) with strict title & duration validation.
    3. Checks SoundCloud API v2 full-length AAC (.m4a) with strict title-word matching and duration check.
    4. Falls back to finding an unblocked official alternative video on YouTube.
    """
    now = time.time()
    clean_title = (title or "").strip()
    clean_artist = (artist or "").strip()

    # Query YouTube Innertube player endpoint to retrieve official lengthSeconds & title even if login required
    if video_id and (not clean_title or expected_duration <= 0):
        try:
            pl_resp = _SESSION.post(
                "https://www.youtube.com/youtubei/v1/player?prettyPrint=false",
                json={
                    "context": {"client": {"clientName": "IOS", "clientVersion": "20.10.4", "deviceMake": "Apple", "deviceModel": "iPhone16,2", "osName": "iPhone", "osVersion": "18.3.2.22D82", "hl": "en", "gl": "US"}},
                    "videoId": video_id,
                    "contentCheckOk": True,
                    "racyCheckOk": True,
                },
                headers={"User-Agent": "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X; US)", "Content-Type": "application/json"},
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

    # Strip noisy suffixes like (Official Video), (Lyrics), [HD], etc. for cleaner search
    search_title = re.sub(
        r"(\(|\[)\s*(official\s*(music\s*)?video|official\s*audio|lyric(s)?(\s*video)?|audio|hd|4k|hq|visualizer|full\s*video|full\s*song)\s*(\)|\])",
        "",
        clean_title,
        flags=re.I,
    ).strip()
    search_artist = re.sub(r"\s*-\s*Topic$|VEVO$", "", clean_artist, flags=re.I).strip()
    if search_artist.lower() in ("jusa music", "unknown artist", "unknown"):
        search_artist = ""

    # Don't repeat artist if title already contains artist
    if search_artist and search_artist.lower() in search_title.lower():
        query = search_title
    else:
        query = f"{search_title} {search_artist}".strip()

    q_lower = query.lower()
    avoid_words = ["karaoke", "instrumental", "tribute", "8-bit", "lullaby", "ringtone", "nightcore", "slowed", "reverb", "sped up"]
    active_avoid = [w for w in avoid_words if w not in q_lower]

    title_words = [w for w in re.findall(r"[a-z0-9]+", search_title.lower()) if len(w) > 2 and w not in ("official", "audio", "video", "lyrics", "lyric", "full")]
    artist_words = [w for w in re.findall(r"[a-z0-9]+", search_artist.lower()) if len(w) > 2]

    # Tier A: JioSaavn 320kbps direct .m4a stream (only when artist & title both match closely)
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
                # Reject snippets or mismatched durations
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

                    # Reject snippets, samples, teasers, and previews
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

                    # Strict title matching: must contain significant title words
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

    # Tier C: Unblocked YouTube alternative resolution
    # If the original video is age-restricted / login-blocked on YouTube, search YouTube Music
    # for an official unblocked video of the same song and resolve its direct audio stream.
    try:
        catalog_candidates = search_youtube_music_catalog(f"{search_title} {search_artist}".strip())
        for c in catalog_candidates[:4]:
            alt_vid = c.get("video_id")
            if alt_vid and alt_vid != video_id:
                alt_stream = _fast_innertube_audio(alt_vid)
                if alt_stream and alt_stream.get("url"):
                    alt_dur = int(alt_stream.get("duration") or 0)
                    if expected_duration > 45 and abs(alt_dur - expected_duration) > max(55, expected_duration * 0.35):
                        continue
                    return alt_stream
    except Exception:
        pass

    return None


def get_audio_stream_url(video_id: str, title: str = "", artist: str = "", expected_duration: int = 0) -> Optional[Dict[str, Any]]:
    """
    Resolves the direct high-quality m4a audio stream URL for any YouTube video_id
    using ultra-fast Innertube player endpoint (0.35s) with yt-dlp and cloud-safe fallbacks.
    Caches stream URLs for 25 minutes.
    """
    if not video_id:
        return None

    # Sanitize video_id if it was passed with URL prefixes or extra parameters
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
        # Discard corrupted/snippet cache entry if duration is invalid
        if expected_duration > 60 and cached_dur > 0 and cached_dur < min(65, expected_duration * 0.5):
            _STREAM_CACHE.pop(video_id, None)
        else:
            return cached

    # On Vercel serverless, prioritize fast Innertube (0.3s) and cloud-safe fallback
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

        cloud_info = _resolve_cloud_fallback_audio(video_id, title=title, artist=artist, expected_duration=expected_duration)
        if cloud_info and cloud_info.get("url"):
            _STREAM_CACHE[video_id] = cloud_info
            return cloud_info

    # Robust resolution via persistent thread-local yt-dlp with full JS signature solving
    try:
        ydl = _get_ydl()
        info = ydl.extract_info(f"https://www.youtube.com/watch?v={video_id}", download=False)
        stream_url = info.get("url")

        # If direct url not at root level, scan formats
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
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
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

    # Fallback to direct Innertube player endpoint only if yt-dlp completely fails
    try:
        fast_info = _fast_innertube_audio(video_id)
        if fast_info and fast_info.get("url"):
            _STREAM_CACHE[video_id] = fast_info
            return fast_info
    except Exception as e:
        print(f"Innertube fallback audio error for {video_id}: {e}")

    try:
        cloud_info = _resolve_cloud_fallback_audio(video_id, title=title, artist=artist, expected_duration=expected_duration)
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
_STOPWORDS = {"songs", "song", "music", "the", "a", "an", "of", "and", "best", "top", "new", "latest", "playlist", "mix", "for", "to", "in"}


def _runs_text(obj: Any) -> str:
    if not isinstance(obj, dict):
        return ""
    if "simpleText" in obj:
        return obj.get("simpleText", "")
    return "".join(r.get("text", "") for r in obj.get("runs", []))


def _query_tokens(q: str) -> List[str]:
    toks = re.findall(r"[a-z0-9]+", q.lower())
    core = [t for t in toks if t not in _STOPWORDS]
    return core or toks


def _relevance(text: str, tokens: List[str]) -> float:
    if not tokens:
        return 0.0
    t = text.lower()
    return sum(1 for tok in tokens if tok in t) / len(tokens)


def _duration_to_seconds(d: str) -> int:
    try:
        parts = [int(p) for p in d.split(":")]
    except ValueError:
        return 0
    secs = 0
    for p in parts:
        secs = secs * 60 + p
    return secs


def _yt_web_search(query: str, pages: int = 2) -> Dict[str, Any]:
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
            videos.append(
                {
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
                    "duration_sec": _duration_to_seconds(dur),
                }
            )

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
    if cache_key in _SEARCH_CACHE:
        return dict(_SEARCH_CACHE[cache_key])

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
        web_res = _yt_web_search(query, pages=1)
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
            info = get_audio_stream_url(video_id, title=query, expected_duration=exp_dur)
            info_dur = int(info.get("duration") or 0) if info else 0
            is_bad_info = (not info) or (exp_dur > 60 and info_dur > 0 and info_dur < min(65, exp_dur * 0.5))
            if is_bad_info and fallback_ids:
                for alt_idx, alt_vid in enumerate(list(fallback_ids)):
                    alt_info = get_audio_stream_url(alt_vid, title=query, expected_duration=exp_dur)
                    alt_dur = int(alt_info.get("duration") or 0) if alt_info else 0
                    if alt_info and (exp_dur <= 60 or alt_dur >= min(65, exp_dur * 0.5)):
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
        _SEARCH_CACHE[cache_key] = result
        return dict(result)
    except Exception as e:
        print(f"Search error for '{query}': {e}")
        return None


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

    # Pre-warm audio stream URLs for the first 3 tracks so playback starts immediately
    top_vids = [tr.get("video_id", "") for tr in resolved if tr.get("video_id")]
    if top_vids:
        prefetch_streams_async(top_vids)

    return resolved


_DIRECT_SEARCH_CACHE: Dict[str, Dict[str, Any]] = {}
_PLAYLIST_BROWSE_CACHE: Dict[str, Dict[str, Any]] = {}

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


def _extract_runs_text(col_obj: Dict[str, Any], renderer_key: str) -> str:
    runs = col_obj.get(renderer_key, {}).get("text", {}).get("runs", [])
    return "".join(r.get("text", "") for r in runs).strip()


def browse_youtube_music_playlist(
    browse_id: str, playlist_title: str = "", playlist_subtitle: str = "", max_tracks: int = 35
) -> List[Dict[str, Any]]:
    """
    Fetches tracks inside a prepared YouTube Music playlist (browseId starting with 'VL')
    with zero LLM token usage.
    """
    if not browse_id:
        return []
    now = time.time()
    cached = _PLAYLIST_BROWSE_CACHE.get(browse_id)
    if cached and (now - cached.get("ts", 0)) < 1800:
        return list(cached["tracks"])

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

            tracks.append(
                {
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
            )
            if len(tracks) >= max_tracks:
                break

        _PLAYLIST_BROWSE_CACHE[browse_id] = {"tracks": tracks, "ts": now}
        return tracks
    except Exception as e:
        print(f"Playlist browse error for '{browse_id}': {e}")
        return []


def _ytm_search(query: str, songs_only: bool) -> Dict[str, Any]:
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
        album = parts[1] if len(parts) > 1 else ""
        bits = []
        if album and album.lower() != cols[0].lower():
            bits.append(f"Album: {album}")
        if plays:
            bits.append(plays)
        reason = " • ".join(bits) if bits else "YouTube Music song"
        seen.add(vid)
        out.append(
            {
                "title": cols[0],
                "artist": artist,
                "video_id": vid,
                "fallback_ids": [],
                "duration_text": dur,
                "thumbnail": f"https://i.ytimg.com/vi/{vid}/hqdefault.jpg",
                "url": f"https://www.youtube.com/watch?v={vid}",
                "embed_url": f"https://www.youtube.com/embed/{vid}?autoplay=1&enablejsapi=1",
                "match_tier": "Direct Match",
                "reason": reason,
                "why_it_fits": reason,
                "vibe": "YT Music",
            }
        )
        if len(out) >= 25:
            break
    return out


def _parse_ytm_playlists(data: Dict[str, Any]) -> List[Dict[str, Any]]:
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
    Zero-token direct search that mirrors youtube.com.
    - Primary results = YouTube search results in YouTube's exact relevance order.
    - Secondary: YouTube Music "Songs" results + matching playlists (only those actually
      relevant to the query), selectable with one tap.
    - A playlist is auto-loaded ONLY when the user explicitly asks for one
      (query contains "playlist") or mode == "playlists".
    """
    q_clean = query.strip()
    if not q_clean:
        return {"playlist_title": "Direct Search", "tracks": [], "matched_playlists": [], "song_results": []}

    cache_key = f"{q_clean.lower()}::{mode}"
    now = time.time()
    cached = _DIRECT_SEARCH_CACHE.get(cache_key)
    if cached and (now - cached.get("ts", 0)) < 1200:
        return dict(cached["data"])

    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        f_yt = pool.submit(_yt_web_search, q_clean, 2)
        f_ytm_songs = pool.submit(_ytm_search, q_clean, True)
        f_ytm_all = pool.submit(_ytm_search, q_clean, False)
        yt = f_yt.result()
        ytm_songs = _parse_ytm_songs(f_ytm_songs.result())
        ytm_playlists = _parse_ytm_playlists(f_ytm_all.result())

    youtube_results = yt["videos"][:40]
    tokens = _query_tokens(q_clean)

    # Playlists: keep YouTube's order, then YT Music ones, but only if their title actually
    # matches the query (no more "Jazzhop Studies" for "lofi rap songs").
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
    # Stable sort: higher relevance first, original (YouTube) order preserved within ties
    matched_playlists.sort(key=lambda p: -p["relevance"])
    matched_playlists = matched_playlists[:6]

    q_lower = q_clean.lower()
    wants_playlist = mode == "playlists" or (mode == "auto" and "playlist" in q_lower)
    wants_ytm = mode == "songs"

    active_source = "youtube"
    active_browse_id = ""
    tracks = youtube_results
    playlist_title = f'"{q_clean}"'
    vibe = f"YouTube results : {len(youtube_results)} videos"

    if wants_ytm and ytm_songs:
        active_source = "songs"
        tracks = ytm_songs
        vibe = f"YouTube results : {len(ytm_songs)} videos"
    elif wants_playlist and matched_playlists:
        top = matched_playlists[0]
        pl_tracks = browse_youtube_music_playlist(top["browse_id"], top["title"], top["subtitle"])
        if pl_tracks:
            tracks = pl_tracks
            active_source = "playlist"
            active_browse_id = top["browse_id"]
            playlist_title = top["title"]
            vibe = f"YouTube results : {len(pl_tracks)} videos"

    if not tracks:
        # Fall back gracefully if YouTube web search was blocked
        tracks = ytm_songs
        active_source = "songs"

    if tracks:
        prefetch_streams_async([t["video_id"] for t in tracks[:3] if t.get("video_id")])

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
        "youtube_results": youtube_results,
        "song_results": ytm_songs,
        "tracks": tracks,
    }
    _DIRECT_SEARCH_CACHE[cache_key] = {"data": result_payload, "ts": now}
    return dict(result_payload)
