import json
import os
import re
import threading
import time
from typing import Dict, List, Any, Optional
from dotenv import load_dotenv
import requests

try:
    from favorites_store import get_favorites
    from youtube_search import search_youtube_music_catalog
    from yt.innertube_client import canonical_artist_name, canonical_song_title
except ImportError:
    from backend.favorites_store import get_favorites
    from backend.youtube_search import search_youtube_music_catalog
    from backend.yt.innertube_client import canonical_artist_name, canonical_song_title

_REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(_REPO_ROOT, ".env"))
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
load_dotenv()

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY", "")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")

_HTTP = requests.Session()
_COOLDOWN_LOCK = threading.Lock()
_MODEL_COOLDOWNS: Dict[str, float] = {}
MODEL_429_COOLDOWN_SEC = 60.0

# Model alias mapping for endpoints that require specific backend identifiers
MODEL_ALIASES: Dict[str, str] = {
    "gemini-4-argon": "gemini-robotics-er-2-preview",
    "gemini-er-2-flash": "gemini-robotics-er-2-preview",
}

# Models that require thinkingLevel="LOW" instead of "MINIMAL"
LOW_THINKING_MODELS = {"gemini-3.8-flash", "gemini-3.7-flash"}

# Models that support thinkingBudget=0
ZERO_BUDGET_MODELS = {"gemini-2.5-flash", "gemini-robotics-er-2-preview"}


def _resolve_key(module_val: str, env_name: str) -> str:
    return (os.environ.get(env_name) or module_val or "").strip()


def _is_model_in_cooldown(endpoint: str, now: Optional[float] = None) -> bool:
    cur = time.time() if now is None else now
    with _COOLDOWN_LOCK:
        until = _MODEL_COOLDOWNS.get(endpoint, 0.0)
        if until <= cur:
            _MODEL_COOLDOWNS.pop(endpoint, None)
            return False
        return True


def _mark_model_cooldown(endpoint: str, duration_sec: float = MODEL_429_COOLDOWN_SEC) -> None:
    with _COOLDOWN_LOCK:
        _MODEL_COOLDOWNS[endpoint] = time.time() + duration_sec


def clear_model_cooldowns() -> None:
    with _COOLDOWN_LOCK:
        _MODEL_COOLDOWNS.clear()


def clean_json_response(raw_text: str) -> Any:
    """Strips markdown code fences and extracts JSON even when wrapped in prose."""
    cleaned = str(raw_text or "").strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, flags=re.IGNORECASE)
    if fence:
        cleaned = fence.group(1).strip()
    else:
        if cleaned.startswith("```json"):
            cleaned = cleaned[7:]
        elif cleaned.startswith("```"):
            cleaned = cleaned[3:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3]
        cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        obj_start = cleaned.find("{")
        arr_start = cleaned.find("[")
        candidates = [i for i in (obj_start, arr_start) if i != -1]
        if candidates:
            start = min(candidates)
            end_char = "]" if start == arr_start else "}"
            end = cleaned.rfind(end_char)
            if end > start:
                return json.loads(cleaned[start : end + 1])
        raise


def _human_error_reason(err_str: str, model_id: str) -> str:
    if "GEMINI_API_KEY" in err_str:
        return "GEMINI_API_KEY not configured"
    if "503" in err_str:
        return f"High server demand (HTTP 503) on {model_id}"
    if "429" in err_str:
        return f"Free-tier daily quota reached (HTTP 429) on {model_id}"
    if "404" in err_str:
        return f"Endpoint unavailable (HTTP 404) for {model_id}"
    if "Read timed out" in err_str or "Timeout" in err_str or "timed out" in err_str:
        return f"Response timeout on {model_id}"
    return f"Transient error on {model_id}"


def _call_openai_compatible(provider_model: str, prompt: str, timeout: float = 18.0) -> Dict[str, Any]:
    """Calls Groq, OpenRouter, or OpenAI endpoints when configured."""
    if provider_model.startswith("groq/"):
        key = _resolve_key(GROQ_API_KEY, "GROQ_API_KEY")
        if not key:
            raise RuntimeError("HTTP 404 (GROQ_API_KEY not set)")
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {key}"}
        actual_model = provider_model.split("/", 1)[1]
    elif provider_model.startswith("openrouter/"):
        key = _resolve_key(OPENROUTER_API_KEY, "OPENROUTER_API_KEY")
        if not key:
            raise RuntimeError("HTTP 404 (OPENROUTER_API_KEY not set)")
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {"Authorization": f"Bearer {key}"}
        actual_model = provider_model.split("/", 1)[1]
    elif provider_model.startswith("openai/"):
        key = _resolve_key(OPENAI_API_KEY, "OPENAI_API_KEY")
        if not key:
            raise RuntimeError("HTTP 404 (OPENAI_API_KEY not set)")
        url = "https://api.openai.com/v1/chat/completions"
        headers = {"Authorization": f"Bearer {key}"}
        actual_model = provider_model.split("/", 1)[1]
    else:
        raise RuntimeError(f"Unknown provider for {provider_model}")

    resp = _HTTP.post(
        url,
        headers=headers,
        json={
            "model": actual_model,
            "messages": [{"role": "user", "content": prompt}],
            "response_format": {"type": "json_object"},
            "temperature": 0.55,
        },
        timeout=timeout,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")

    content = resp.json()["choices"][0]["message"]["content"]
    parsed = clean_json_response(content)
    if isinstance(parsed, list):
        parsed = {"tracks": parsed}
    parsed["used_model"] = provider_model
    return parsed


def _call_gemini_rest(model_id: str, prompt: str, timeout: float = 20.0) -> Dict[str, Any]:
    """Calls Gemini REST endpoint via x-goog-api-key header with model-appropriate thinkingConfig."""
    if "/" in model_id:
        return _call_openai_compatible(model_id, prompt, timeout=timeout)

    api_key = _resolve_key(GEMINI_API_KEY, "GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not configured")

    actual_endpoint = MODEL_ALIASES.get(model_id, model_id)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{actual_endpoint}:generateContent"

    gen_config: Dict[str, Any] = {
        "temperature": 0.55,
    }
    if "gemma" not in actual_endpoint:
        gen_config["responseMimeType"] = "application/json"

    if actual_endpoint in ZERO_BUDGET_MODELS or "2.5-flash" in actual_endpoint:
        gen_config["thinkingConfig"] = {"thinkingBudget": 0}
    elif actual_endpoint in LOW_THINKING_MODELS:
        gen_config["thinkingConfig"] = {"thinkingLevel": "LOW"}
    elif "gemini-3" in actual_endpoint or "flash-lite" in actual_endpoint or "gemma-4" in actual_endpoint:
        gen_config["thinkingConfig"] = {"thinkingLevel": "MINIMAL"}

    payload: Dict[str, Any] = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": gen_config,
    }

    resp = _HTTP.post(
        url,
        headers={
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        },
        json=payload,
        timeout=timeout,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"HTTP {resp.status_code}")

    body = resp.json()
    candidates = body.get("candidates", [])
    if not candidates:
        raise RuntimeError("Empty candidates")

    parts = candidates[0].get("content", {}).get("parts", [])
    text_part = ""
    for p in parts:
        if "text" in p and not p.get("thought"):
            text_part += p["text"]
    if not text_part and parts:
        text_part = parts[-1].get("text", "")

    parsed = clean_json_response(text_part)
    if isinstance(parsed, list):
        parsed = {"tracks": parsed}
    parsed["used_model"] = model_id
    return parsed


def generate_fast_with_fallback(prompt: str, preferred_model: str = "gemini-4-argon") -> Dict[str, Any]:
    """
    Calls preferred_model first; skips models in 60s 429 cooldown and falls back
    through active Gemini / OpenAI-compatible endpoints.
    """
    fallback_pool = [
        "gemini-4-argon",
        "gemini-3.1-flash-lite",
        "gemini-3.5-flash-lite",
        "gemini-flash-lite-latest",
        "gemini-3-flash-preview",
        "gemini-2.5-flash",
        "gemma-4-26b-a4b-it",
    ]
    if _resolve_key(GROQ_API_KEY, "GROQ_API_KEY"):
        fallback_pool.insert(0, "groq/llama-3.3-70b-versatile")
    if _resolve_key(OPENROUTER_API_KEY, "OPENROUTER_API_KEY"):
        fallback_pool.insert(0, "openrouter/google/gemini-2.5-flash")

    ordered_candidates = [preferred_model]
    seen_endpoints = {MODEL_ALIASES.get(preferred_model, preferred_model)}
    for m in fallback_pool:
        ep = MODEL_ALIASES.get(m, m)
        if ep not in seen_endpoints:
            seen_endpoints.add(ep)
            ordered_candidates.append(m)

    healthy_candidates = [
        m for m in ordered_candidates if not _is_model_in_cooldown(MODEL_ALIASES.get(m, m))
    ]
    candidates = healthy_candidates or ordered_candidates

    attempts: List[Dict[str, Any]] = []
    primary_failure_reason = ""
    gemini_key_missing = False

    for idx, model_id in enumerate(candidates):
        if gemini_key_missing and "/" not in model_id:
            continue
        endpoint = MODEL_ALIASES.get(model_id, model_id)
        max_tries = 2 if idx == 0 else 1
        for attempt_num in range(max_tries):
            t0 = time.time()
            try:
                res = _call_gemini_rest(model_id, prompt, timeout=14.0)
                latency_ms = int((time.time() - t0) * 1000)
                attempts.append({
                    "model": model_id,
                    "status": "ok",
                    "latency_ms": latency_ms,
                })
                res["requested_model"] = preferred_model
                res["used_model"] = model_id
                res["is_fallback"] = (model_id != preferred_model)
                res["latency_ms"] = latency_ms
                res["model_attempts"] = attempts
                if model_id != preferred_model:
                    res["fallback_reason"] = primary_failure_reason or f"{preferred_model} unavailable"
                    res["fallback_note"] = f"{res['fallback_reason']} -> generated by {model_id}"
                else:
                    res["fallback_reason"] = ""
                    res["fallback_note"] = ""
                return res
            except Exception as e:
                latency_ms = int((time.time() - t0) * 1000)
                err_str = str(e)
                human_reason = _human_error_reason(err_str, model_id)
                attempts.append({
                    "model": model_id,
                    "status": "error",
                    "reason": human_reason,
                    "latency_ms": latency_ms,
                })
                if "GEMINI_API_KEY not configured" in err_str:
                    gemini_key_missing = True
                if "429" in err_str:
                    _mark_model_cooldown(endpoint)
                if idx == 0 and not primary_failure_reason:
                    primary_failure_reason = human_reason
                if idx == 0 and "503" in err_str and attempt_num == 0:
                    time.sleep(0.4)
                    continue
                break

    raise RuntimeError(f"All model endpoints failed ({primary_failure_reason})")


_SPECIFIC_ENTITY_RE = re.compile(
    r"\b(?:"
    r"monogatari|bakemonogatari|nisemonogatari|kizumonogatari|owarimonogatari|"
    r"attack\s+on\s+titan|aot|shingeki|sawano|ramayan|adipurush|mahabharat|"
    r"bleach|naruto|one\s+piece|evangelion|chainsaw\s+man|jujutsu\s+kaisen|"
    r"cyberpunk|interstellar|hans\s+zimmer|ghibli|joe\s+hisaishi|steins\s*;?\s*gate|"
    r"death\s+note|code\s+geass|bocchi|frieren|nier|persona"
    r")\b",
    re.IGNORECASE,
)

_GENERIC_MOOD_WORDS_RE = re.compile(
    r"\b(?:"
    r"focused\s+late[- ]night|late[- ]night|dark\s+synthwave|ambient\s+downtempo|"
    r"deep\s+problem\s+solving|curate\s+a\s+fresh\s+playlist|coding\s+session|"
    r"study|workout|gym|chill|relax|sleep|focus|focusing|drive|driving|rainy|"
    r"morning|evening|night|party|energetic|upbeat|sad|happy|melancholy|"
    r"ambient|lofi|lo-?fi|synthwave|downtempo|electronic|acoustic|indie|"
    r"jazz|pop|rock|hip[- ]hop|r&b|metal|classical|bollywood|hindi|punjabi|"
    r"vibe|vibes|mood|playlist|mix|beats|session|energy|songs|music|tracks"
    r")\b",
    re.IGNORECASE,
)


def _is_specific_entity_query(mood_prompt: str) -> bool:
    """
    Detects whether the prompt asks for a specific anime, movie, game, franchise,
    or artist (where 100% of tracks MUST belong to that entity and Safari history
    must NOT pollute the results with unrelated shows).
    """
    p = mood_prompt.strip().lower()
    if not p:
        return False
    if _SPECIFIC_ENTITY_RE.search(p):
        return True
    if _GENERIC_MOOD_WORDS_RE.search(p):
        return False
    return len(p.split()) <= 4


def analyze_taste_dna(tracks: List[Dict[str, Any]], model_name: str = "gemini-4-argon") -> Dict[str, Any]:
    """Analyzes user's listening history and hearted favorites to build their Taste Profile."""
    favs = get_favorites()
    if not tracks and not favs:
        return {
            "archetype": "Uncharted Listener",
            "primary_genres": ["Electronic", "Soundtrack", "Indie", "Alternative"],
            "sonic_attributes": {
                "tempo": "115-128 BPM",
                "electronic_balance": 70,
                "mood": "Focused",
                "energy": 65,
            },
            "top_artists": [],
            "summary": "Sync a YouTube tab from Safari or heart tracks to build your profile.",
        }

    fav_lines = [f"- [FAVORITE] {t.get('title', '')} ({t.get('artist', '')})" for t in favs[:15]]
    track_samples = [f"- {t.get('title', '')} ({t.get('artist', 'Unknown')})" for t in tracks[:30]]
    combined = "\n".join(fav_lines + track_samples)

    prompt = f"""Analyze this listener's hearted favorites and YouTube history (ignore non-music videos like coding tutorials or movie breakdowns; focus strictly on music, OSTs, openings, artists, and sonic aesthetics):

{combined}

Return ONLY a JSON object with this exact schema:
{{
  "archetype": "string (concise 2-3 word profile title)",
  "primary_genres": ["genre1", "genre2", "genre3", "genre4"],
  "sonic_attributes": {{
    "tempo": "string (e.g. '120-140 BPM')",
    "electronic_balance": 75,
    "mood": "string (1-2 words)",
    "energy": 72
  }},
  "top_artists": ["artist1", "artist2", "artist3", "artist4"],
  "summary": "string (concise, objective 2-sentence musical analysis)"
}}"""
    try:
        return generate_fast_with_fallback(prompt, preferred_model=model_name)
    except Exception as e:
        return {
            "archetype": "Custom Profile",
            "primary_genres": ["Electronic", "Indie", "Pop", "Alternative"],
            "sonic_attributes": {
                "tempo": "120-136 BPM",
                "electronic_balance": 70,
                "mood": "Dynamic",
                "energy": 72,
            },
            "top_artists": list({t.get("artist", "") for t in (favs + tracks)[:6] if t.get("artist")})[:4],
            "summary": "Profile synthesized from your saved favorites and listening session.",
            "error": str(e),
        }


def _hydrate_tracks_from_catalog(raw_tracks: List[Dict[str, Any]], yt_catalog: List[Dict[str, str]]) -> None:
    """Preserves video_id and duration_text from yt_catalog matches to skip redundant searches."""
    if not raw_tracks or not yt_catalog:
        return

    by_title_artist: Dict[tuple, Dict[str, str]] = {}
    by_title: Dict[str, List[Dict[str, str]]] = {}

    for item in yt_catalog:
        vid = (item.get("video_id") or "").strip()
        if len(vid) != 11:
            continue
        t_key = canonical_song_title(item.get("title") or "")
        a_key = canonical_artist_name(item.get("artist") or "")
        if not t_key:
            continue
        by_title_artist[(t_key, a_key)] = item
        by_title.setdefault(t_key, []).append(item)

    for tr in raw_tracks:
        if tr.get("video_id") and len(str(tr["video_id"])) == 11:
            continue
        t_key = canonical_song_title(tr.get("title") or "")
        a_key = canonical_artist_name(tr.get("artist") or "")
        if not t_key:
            continue

        matched = by_title_artist.get((t_key, a_key))
        if not matched:
            candidates = by_title.get(t_key, [])
            for cand in candidates:
                c_artist = canonical_artist_name(cand.get("artist") or "")
                if not a_key or not c_artist or a_key in c_artist or c_artist in a_key:
                    matched = cand
                    break
            if not matched and len(candidates) == 1:
                matched = candidates[0]

        if matched:
            tr["video_id"] = matched["video_id"]
            if matched.get("duration_text") and not tr.get("duration_text"):
                tr["duration_text"] = matched["duration_text"]


def curate_playlist(
    seed_tracks: List[Dict[str, Any]],
    mood_prompt: str = "Focused late night session",
    energy_level: int = 78,
    count: int = 8,
    model_name: str = "gemini-4-argon",
) -> Dict[str, Any]:
    """
    Generates a semantically coherent playlist grounded in live YouTube Music search results.
    When the user searches for a specific anime/movie/franchise/artist, 100% of tracks are
    locked to that entity without Safari history cross-contamination.
    """
    is_specific = _is_specific_entity_query(mood_prompt)

    # Fetch live YouTube Music catalog matches for ground-truth accuracy
    yt_catalog = search_youtube_music_catalog(mood_prompt, max_items=12)
    yt_catalog_block = ""
    if yt_catalog:
        yt_catalog_block = (
            "Verified YouTube Music Tracks Matching Query (Use as ground-truth reference where appropriate):\n"
            + "\n".join([f"- \"{c['title']}\" by {c['artist']}" for c in yt_catalog])
            + "\n\n"
        )

    # Only include Safari history / unrelated favorites when the prompt is a general mood/activity query
    context_block = ""
    if not is_specific:
        favs = get_favorites()
        if favs:
            context_block += "User's Hearted Favorites:\n" + "\n".join(
                [f"- {t.get('title', '')[:65]} by {t.get('artist', '')[:35]}" for t in favs[:10]]
            ) + "\n\n"
        if seed_tracks:
            context_block += "User's Recent YouTube History:\n" + "\n".join(
                [f"- {t.get('title', '')[:65]} by {t.get('artist', 'Unknown')[:35]}" for t in seed_tracks[:12]]
            ) + "\n\n"

    if is_specific:
        relevance_instructions = f"""1. STRICT ENTITY LOCK (CRITICAL — NO OFF-TOPIC TRACKS ALLOWED):
   - The user is searching specifically for: "{mood_prompt}".
   - ALL {count} tracks (100% of the playlist) MUST belong directly to the exact series, franchise, anime, movie, game, or artist requested in "{mood_prompt}".
   - NEVER include songs from other anime, other movies, or unrelated franchises.
   - Do NOT invent or hallucinate fake song titles. Use real, canonical track titles.
   - Set "match_tier" within that exact universe:
     * "Direct Match": Flagship iconic vocal openings, endings, or main songs from "{mood_prompt}" (at least {max(count - 2, 5)} tracks).
     * "Close Fit": Official OST instrumentals, character songs, or B-sides from the EXACT SAME franchise/artist.
     * "Exploratory": Deep cuts or alternate versions still strictly within "{mood_prompt}"."""
    else:
        relevance_instructions = """1. COHERENT MOOD CURATION:
   - Prioritize tracks that genuinely match the requested sonic atmosphere and intensity.
   - Set "match_tier" to "Direct Match" for core genre/mood tracks, "Close Fit" for stylistic siblings, and "Exploratory" for 1-2 tasteful discoveries."""

    prompt = f"""You are an expert musicologist and playlist curator.

{yt_catalog_block}{context_block}User Request:
- Prompt: "{mood_prompt}"
- Target Intensity: {energy_level}/100
- Track Count: {count}

{relevance_instructions}

2. MUSICAL RATIONALE (NO AI META-TALK):
   - NEVER write meta-phrases like "appealing to the user's interest in...", "matches the user's history", "aligns with your taste", or "fits the prompt".
   - Explain the MUSICAL connection directly in 8 to 13 words: describe the instrumentation, vocals, orchestration, rhythm, or atmosphere.

3. YOUTUBE SEARCH QUERY ACCURACY:
   - Include a "search_query" field for every track containing "<exact song title> <artist> <franchise/series name>" so YouTube Music resolves the exact official audio.

Return ONLY a valid JSON object matching this exact schema:
{{
  "playlist_title": "string (clean, evocative title)",
  "subtitle": "string (short 1-line musical summary)",
  "vibe_description": "string (1 sentence overview)",
  "tracks": [
    {{
      "title": "string (exact real song title)",
      "artist": "string (exact artist, vocalist, or composer name)",
      "search_query": "string (exact title + artist + series/album name for YouTube search)",
      "match_tier": "Direct Match | Close Fit | Exploratory",
      "reason": "string (8-13 word direct musical description; NO 'user' or 'history' meta-talk)",
      "detail": "string (1 sentence deeper note on arrangement, arc/film, or composer)",
      "vibe": "string (1-2 word genre/style tag)",
      "energy": 75
    }}
  ]
}}"""

    res = generate_fast_with_fallback(prompt, preferred_model=model_name)

    tier_order = {"Direct Match": 0, "Close Fit": 1, "Exploratory": 2}
    raw_tracks = res.get("tracks", [])
    if isinstance(raw_tracks, list):
        _hydrate_tracks_from_catalog(raw_tracks, yt_catalog)
        for t in raw_tracks:
            if t.get("match_tier") not in tier_order:
                t["match_tier"] = "Direct Match"
        raw_tracks.sort(key=lambda x: tier_order.get(x.get("match_tier", "Direct Match"), 0))
        res["tracks"] = raw_tracks

    return res
