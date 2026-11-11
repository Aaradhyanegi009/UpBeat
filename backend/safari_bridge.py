import json
import subprocess
import time
from typing import Dict, List, Optional, Any

_TABS_CACHE: Dict[str, Any] = {"ts": 0.0, "tabs": [], "now_playing": None}


def run_applescript(script: str, timeout: float = 4.0) -> str:
    """Executes AppleScript and returns stdout or raises exception."""
    res = subprocess.run(
        ["osascript", "-e", script],
        capture_output=True,
        text=True,
        timeout=timeout,
    )
    if res.returncode != 0:
        err = res.stderr.strip()
        if "Allow JavaScript from Apple Events" in err:
            raise PermissionError(
                "Safari requires permission: Develop -> Allow JavaScript from Apple Events."
            )
        raise RuntimeError(f"AppleScript error: {err}")
    return res.stdout.strip()


def run_safari_js_in_tab(window_idx: int, tab_idx: int, js_code: str) -> str:
    """Runs JavaScript in a specific window and tab index in Safari."""
    escaped_js = js_code.replace("\\", "\\\\").replace('"', '\\"')
    script = f'''
    tell application "Safari"
        if (count of windows) < {window_idx} then return "ERROR: Window not found"
        tell window {window_idx}
            if (count of tabs) < {tab_idx} then return "ERROR: Tab not found"
            return do JavaScript "{escaped_js}" in tab {tab_idx}
        end tell
    end tell
    '''
    return run_applescript(script, timeout=5.0)


def list_safari_tabs(use_cache: bool = False) -> List[Dict[str, Any]]:
    """Lists all open tabs in Safari, flagging YouTube and YouTube Music tabs."""
    now = time.time()
    if use_cache and (now - _TABS_CACHE["ts"] < 2.5):
        return _TABS_CACHE["tabs"]

    script = '''
    tell application "Safari"
        if (count of windows) = 0 then return ""
        set outText to ""
        set wIdx to 1
        repeat with w in windows
            set tIdx to 1
            repeat with t in tabs of w
                set u to URL of t as string
                set nm to name of t as string
                set outText to outText & wIdx & "<#TAB#>" & tIdx & "<#TAB#>" & u & "<#TAB#>" & nm & "<#ROW#>"
                set tIdx to tIdx + 1
            end repeat
            set wIdx to wIdx + 1
        end repeat
        return outText
    end tell
    '''
    try:
        raw = run_applescript(script)
        if not raw:
            _TABS_CACHE["ts"] = now
            _TABS_CACHE["tabs"] = []
            return []
        tabs = []
        rows = [r for r in raw.split("<#ROW#>") if r.strip()]
        for row in rows:
            parts = row.split("<#TAB#>")
            if len(parts) >= 4:
                w_idx = int(parts[0])
                t_idx = int(parts[1])
                url = parts[2]
                title = parts[3]
                is_yt = "music.youtube.com" in url
                yt_type = "music" if is_yt else "none"
                tabs.append({
                    "window": w_idx,
                    "tab": t_idx,
                    "url": url,
                    "title": title,
                    "is_yt": is_yt,
                    "yt_type": yt_type,
                })
        _TABS_CACHE["ts"] = now
        _TABS_CACHE["tabs"] = tabs
        return tabs
    except Exception as e:
        print(f"Error listing tabs: {e}")
        return _TABS_CACHE.get("tabs", [])


def open_safari_url(url: str, activate: bool = True) -> Dict[str, Any]:
    """Opens a URL in a new Safari tab and focuses it so DOM renders immediately."""
    act_str = "activate" if activate else ""
    script = f'''
    tell application "Safari"
        {act_str}
        if (count of windows) = 0 then
            open location "{url}"
        else
            tell window 1
                set newTab to make new tab with properties {{URL:"{url}"}}
                set current tab to newTab
            end tell
        end if
    end tell
    return "ok"
    '''
    run_applescript(script)
    _TABS_CACHE["ts"] = 0.0
    return {"status": "ok", "url": url}


def extract_tracks_from_tab(window_idx: int, tab_idx: int) -> Dict[str, Any]:
    """Extracts songs / videos / playlists from the specified Safari tab."""
    extraction_js = """
    (function() {
        const url = window.location.href;
        const isMusic = url.includes('music.youtube.com');
        if (!isMusic) {
            // Strictly reject non-music tabs! Never import general youtube.com or search results!
            return JSON.stringify({
                url: url,
                page_type: 'ignored_non_music',
                count: 0,
                tracks: []
            });
        }
        const seenIds = new Set();
        let results = [];
        let pageType = 'yt_music';

        function extractVid(href) {
            if (!href) return '';
            if (href.includes('watch?v=')) {
                return href.split('watch?v=')[1].split('&')[0];
            }
            return '';
        }

        function addTrack(title, artist, videoId, thumb, href) {
            if (!title) return;
            const cleanTitle = title.replace(/\s+/g, ' ').trim();
            if (!cleanTitle || cleanTitle === 'Play all' || cleanTitle === 'PLAY ALL' || cleanTitle === 'Shuffle' || cleanTitle === 'Liked videos') return;
            if (cleanTitle.includes('Private video') || cleanTitle.includes('Deleted video')) return;
            if (/^\d+:\d+$/.test(cleanTitle)) return;

            // Strict 11-char videoId check
            if (videoId && !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;

            // Reject non-music content and view counts as artist
            let cleanArtist = (artist || '').replace(/\s+/g, ' ').trim();
            if (/^\d+[\d.,]*\s*[kKmMbB]?\s*(?:views?|subscribers?|watching|likes?)?$/i.test(cleanArtist) ||
                /^(?:\d+\s*(?:views?|subscribers?|ago)|streamed|youtube|unknown)$/i.test(cleanArtist)) {
                cleanArtist = '';
            }

            const nonMusicCheck = (cleanTitle + ' ' + cleanArtist).toLowerCase();

            // Block Stand-Up Comedy, Podcasts, Skits & Talks
            if (/\b(stand\s*up|standup|comedy|comedian|samay\s*raina|zakir\s*khan|abhishek\s*upmanyu|bassi|anubhav\s*singh|munawar|harsh\s*gujral|biswa|kanan|kenny\s*sebastian|latent|india's\s*got\s*latent|roast|crowd\s*work|open\s*mic|funny|joke|jokes|laugh|skit|parody|podcast|interview|episode|ep\s*\d+|talk\s*show|storytime|reaction|review|vlogs?|vlog|unboxing)\b/i.test(nonMusicCheck)) {
                return;
            }

            // Block Devotional, Religious & Spiritual Audio
            if (/\b(bhajan|aarti|chalisa|mantra|stotra|stotram|shloka|hanuman|shiv|shiva|krishna|ram\s*bhajan|ganesh|durga|mata|kirtan|satsang|devotional|bhakti|gurbani|shabad|qawwali|naat|tilawat|t-series\s*bhakti|sanskar|aastha|spiritual|meditation\s*chant|om\s*namah)\b/i.test(nonMusicCheck)) {
                return;
            }

            // Block Gaming, Tutorials, Lectures & Shorts
            if (/\b(minecraft|gameplay|walkthrough|let's\s*play|bgmi|pubg|valorant|stream|highlights|tutorial|lecture|course|gate|jee|neet|dsa|leetcode|codeforces|coding|programming|how\s*to|explained|documentary|news|breaking|shorts|#shorts|status|whatsapp\s*status|ringtone|teaser|trailer|making\s*of|behind\s*the\s*scenes|full\s*movie|scene|laplace|calculus)\b/i.test(nonMusicCheck)) {
                return;
            }

            const key = videoId || cleanTitle.toLowerCase();
            if (seenIds.has(key)) return;
            seenIds.add(key);

            const finalThumb = (thumb && thumb.startsWith('http'))
                ? thumb
                : (videoId ? 'https://i.ytimg.com/vi/' + videoId + '/hqdefault.jpg' : '');

            const finalUrl = href
                ? (href.startsWith('http') ? href : 'https://music.youtube.com/' + href.replace(/^\//, ''))
                : (videoId ? 'https://music.youtube.com/watch?v=' + videoId : '');

            results.push({
                title: cleanTitle,
                artist: cleanArtist || 'YouTube Music',
                thumbnail: finalThumb,
                video_id: videoId || '',
                url: finalUrl
            });
        }

        const items = Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer, ytmusic-two-row-item-renderer'));
        items.slice(0, 60).forEach(item => {
            const titleEl = item.querySelector('.title-column yt-formatted-string a, .title-column yt-formatted-string, .title a, .title');
            const bylines = Array.from(item.querySelectorAll('.secondary-flex-columns yt-formatted-string a, .secondary-flex-columns yt-formatted-string, .subtitle yt-formatted-string'));
            const imgEl = item.querySelector('img');
            const href = titleEl?.getAttribute('href') || item.querySelector('a[href*="watch?v="]')?.getAttribute('href') || '';
            const vid = extractVid(href);
            addTrack(
                titleEl ? titleEl.textContent : '',
                bylines.length > 0 ? bylines[0].textContent : '',
                vid,
                imgEl ? imgEl.src : '',
                href
            );
        });

        if (results.length === 0) {
            const playBar = document.querySelector('ytmusic-player-bar');
            if (playBar) {
                const title = playBar.querySelector('.title')?.textContent;
                const artist = playBar.querySelector('.byline a, .byline')?.textContent;
                const img = playBar.querySelector('img.image')?.src;
                const vid = (new URLSearchParams(window.location.search)).get('v') || '';
                addTrack(title, artist, vid, img, window.location.href);
            }
        }

        return JSON.stringify({
            url: url,
            page_type: pageType,
            count: results.length,
            tracks: results
        });
    })();
    """
    raw = run_safari_js_in_tab(window_idx, tab_idx, extraction_js)
    try:
        return json.loads(raw)
    except Exception as e:
        return {"error": str(e), "raw": raw, "tracks": [], "count": 0}


def extract_all_safari_yt_tracks(window_idx: Optional[int] = None, tab_idx: Optional[int] = None) -> Dict[str, Any]:
    """Extracts tracks from a specific tab or scans all open YouTube tabs in Safari."""
    if window_idx is not None and tab_idx is not None:
        return extract_tracks_from_tab(window_idx, tab_idx)

    tabs = list_safari_tabs(use_cache=False)
    yt_tabs = [t for t in tabs if t.get("is_yt")]
    if not yt_tabs:
        return {"error": "No YouTube tab open in Safari", "tracks": [], "count": 0}

    combined_tracks = []
    seen = set()
    source_urls = []

    for tab in yt_tabs:
        res = extract_tracks_from_tab(tab["window"], tab["tab"])
        if res.get("url"):
            source_urls.append(res["url"])
        for tr in res.get("tracks", []):
            key = tr.get("video_id") or tr.get("title", "").lower()
            if key and key not in seen:
                seen.add(key)
                combined_tracks.append(tr)

    return {
        "url": source_urls[0] if source_urls else "",
        "sources": source_urls,
        "count": len(combined_tracks),
        "tracks": combined_tracks,
    }


def get_safari_now_playing() -> Optional[Dict[str, Any]]:
    """Checks open YouTube tabs in Safari to see if a video/song is active."""
    tabs = list_safari_tabs(use_cache=True)
    yt_tabs = [t for t in tabs if t.get("is_yt")]
    if not yt_tabs:
        return None

    check_js = """
    (function() {
        const video = document.querySelector('video');
        if (!video) return JSON.stringify({ active: false });
        
        const isPlaying = !video.paused && !video.ended && video.readyState > 2;
        const currentTime = video.currentTime || 0;
        const duration = video.duration || 0;
        
        let title = '';
        let artist = '';
        let thumbnail = '';
        const vid = (new URLSearchParams(window.location.search)).get('v') || '';
        
        if (window.location.host.includes('music.youtube.com')) {
            const bar = document.querySelector('ytmusic-player-bar');
            if (bar) {
                title = bar.querySelector('.title')?.textContent?.trim() || '';
                artist = bar.querySelector('.byline a, .byline')?.textContent?.trim() || '';
                thumbnail = bar.querySelector('img.image')?.src || '';
            }
        } else {
            const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string');
            title = titleEl ? titleEl.textContent.trim() : document.title.replace(' - YouTube', '');
            artist = document.querySelector('#owner #channel-name a')?.textContent?.trim() || '';
            if (vid) thumbnail = 'https://i.ytimg.com/vi/' + vid + '/hqdefault.jpg';
        }
        
        if (!title) return JSON.stringify({ active: false });

        return JSON.stringify({
            active: true,
            isPlaying: isPlaying,
            currentTime: currentTime,
            duration: duration,
            title: title,
            artist: artist,
            thumbnail: thumbnail,
            video_id: vid,
            url: window.location.href
        });
    })();
    """
    for tab in yt_tabs:
        try:
            raw = run_safari_js_in_tab(tab["window"], tab["tab"], check_js)
            data = json.loads(raw)
            if data.get("active"):
                data["window"] = tab["window"]
                data["tab"] = tab["tab"]
                return data
        except Exception:
            continue
    return None


def control_safari(action: str, window_idx: Optional[int] = None, tab_idx: Optional[int] = None) -> Dict[str, Any]:
    """Sends playback control commands (play_pause, next, prev) to Safari."""
    if window_idx is None or tab_idx is None:
        tabs = list_safari_tabs(use_cache=True)
        yt_tabs = [t for t in tabs if t.get("is_yt")]
        if not yt_tabs:
            return {"status": "error", "message": "No YouTube tab open in Safari"}
        window_idx = yt_tabs[0]["window"]
        tab_idx = yt_tabs[0]["tab"]

    control_js = f"""
    (function() {{
        const action = "{action}";
        const isMusic = window.location.host.includes('music.youtube.com');
        const video = document.querySelector('video');
        
        if (action === 'play_pause') {{
            if (isMusic) {{
                const btn = document.querySelector('#play-pause-button, .play-pause-button');
                if (btn) btn.click();
                else if (video) {{ video.paused ? video.play() : video.pause(); }}
            }} else {{
                if (video) {{ video.paused ? video.play() : video.pause(); }}
            }}
            return 'toggled';
        }} else if (action === 'next') {{
            if (isMusic) {{
                const btn = document.querySelector('.next-button, #next-button');
                if (btn) btn.click();
            }} else {{
                const btn = document.querySelector('.ytp-next-button');
                if (btn) btn.click();
            }}
            return 'next';
        }} else if (action === 'prev') {{
            if (isMusic) {{
                const btn = document.querySelector('.previous-button, #previous-button');
                if (btn) btn.click();
            }} else {{
                const btn = document.querySelector('.ytp-prev-button');
                if (btn) btn.click();
                else if (video) {{ video.currentTime = 0; }}
            }}
            return 'prev';
        }}
        return 'unknown';
    }})();
    """
    try:
        res = run_safari_js_in_tab(window_idx, tab_idx, control_js)
        return {"status": "success", "result": res}
    except Exception as e:
        return {"status": "error", "message": str(e)}


def get_safari_youtube_profile() -> Dict[str, Any]:
    """Extracts actual YouTube Music / Google profile picture and name from active Safari session."""
    script = '''
    tell application "Safari"
        repeat with w in windows
            repeat with t in tabs of w
                set u to URL of t
                if u contains "music.youtube.com" or u contains "youtube.com" then
                    try
                        set p to (do JavaScript "
                            (function() {
                                var img = document.querySelector('button.ytmusic-settings-button img') ||
                                          document.querySelector('ytmusic-settings-button img') ||
                                          document.querySelector('button#avatar-btn yt-img-shadow img') ||
                                          document.querySelector('#avatar-btn img');
                                return img && img.src ? img.src : '';
                            })();
                        " in t)
                        if p is not \"\" and p is not \"none\" then return p
                    end try
                end if
            end repeat
        end repeat
        return \"\"
    end tell
    '''
    try:
        pic = run_applescript(script, timeout=4.0)
        return {"picture": pic} if pic else {}
    except Exception:
        return {}

