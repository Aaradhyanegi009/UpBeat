"""Real-time Jam room relay, social friend mailbox, and profile persistence routes."""

import base64
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

try:
    from routers import require_local_origin, resolve_main_attr
    from routers.offline import DOWNLOADS_DIR
except ImportError:
    from backend.routers import require_local_origin, resolve_main_attr
    from backend.routers.offline import DOWNLOADS_DIR

router = APIRouter()

_SOCIAL_LOCK = threading.Lock()
_PROFILE_LOCK = threading.Lock()
_SOCIAL_MAILBOX: Dict[str, List[Dict[str, Any]]] = {}
_SOCIAL_PRESENCE: Dict[str, Dict[str, Any]] = {}
_JAM_ROOMS: Dict[str, List[Dict[str, Any]]] = {}
_LAST_SERVER_TS = 0

_SOCIAL_TTL_MS = 15 * 60 * 1000
_JAM_TTL_MS = 2 * 3600 * 1000

PROFILE_FILE = os.path.join(DOWNLOADS_DIR, "user_profile.json")


class SocialSendRequest(BaseModel):
    targetFriendCode: str
    packet: Dict[str, Any]


class SocialPollRequest(BaseModel):
    friendCode: str
    summary: Optional[Dict[str, Any]] = None
    friendCodes: List[str] = []
    since: int = 0


class JamRoomSendRequest(BaseModel):
    roomCode: str
    packet: Dict[str, Any]


def _next_push_ts(now_ms: Optional[int] = None) -> int:
    """Monotonic server timestamp for pushed packets so same-ms packets are never skipped by `since`."""
    global _LAST_SERVER_TS
    cur = int(time.time() * 1000) if now_ms is None else now_ms
    ts = max(cur, _LAST_SERVER_TS + 1)
    _LAST_SERVER_TS = ts
    return ts


def _current_server_ts(now_ms: Optional[int] = None) -> int:
    global _LAST_SERVER_TS
    cur = int(time.time() * 1000) if now_ms is None else now_ms
    ts = max(cur, _LAST_SERVER_TS)
    _LAST_SERVER_TS = ts
    return ts


def _normalize_friend_code(code: str, auto_prefix: bool = True) -> str:
    """Normalizes a friend code to canonical UP-XXXXXX format matching Edge & frontend."""
    raw = str(code or "").strip().upper()
    cleaned = re.sub(r"[^A-Z0-9-]", "", raw)
    if not cleaned:
        return ""
    if cleaned.startswith("UP-"):
        body = re.sub(r"[^A-Z0-9]", "", cleaned[3:])
        return f"UP-{body[:6]}" if body else ""
    alnum = re.sub(r"[^A-Z0-9]", "", cleaned)
    body = alnum[2:] if alnum.startswith("UP") and len(alnum) > 6 else alnum
    if not body:
        return ""
    return f"UP-{body[:6]}" if auto_prefix else body[:6]


def _collect_online_presence_unlocked(
    friend_codes: List[str], now_ms: int, include_code: bool = True
) -> List[Dict[str, Any]]:
    presence_list: List[Dict[str, Any]] = []
    for fc in friend_codes:
        clean_fc = _normalize_friend_code(fc)
        if not clean_fc:
            continue
        pres = _SOCIAL_PRESENCE.get(clean_fc)
        if pres and (now_ms - pres.get("lastSeen", 0) < 45000):
            entry = {**pres, "online": True}
            if include_code:
                entry["friendCode"] = clean_fc
            presence_list.append(entry)
    return presence_list


def _append_mailbox_packet_unlocked(target: str, pkt: Dict[str, Any], ttl_ms: int, dedup_id: Optional[str]) -> None:
    box = _SOCIAL_MAILBOX.setdefault(target, [])
    cutoff = pkt["_serverTs"] - ttl_ms
    box[:] = [m for m in box if m.get("_serverTs", 0) > cutoff]

    if not dedup_id or not any((m.get("msgId") or m.get("_packetId")) == dedup_id for m in box):
        box.append(pkt)
        if len(box) > 150:
            del box[:-150]


@router.post("/api/jam/social/send")
def jam_social_send_endpoint(req: SocialSendRequest):
    """Enqueues a social/friend signaling packet into the recipient's mailbox."""
    with _SOCIAL_LOCK:
        now_ms = _next_push_ts()
        target = _normalize_friend_code(req.targetFriendCode)
        if not target:
            return {"ok": False}

        pkt = dict(req.packet or {})
        pkt["_serverTs"] = now_ms
        pkt["targetFriendCode"] = target
        sender = pkt.get("from")
        if isinstance(sender, dict) and sender.get("friendCode"):
            s_code = _normalize_friend_code(sender["friendCode"])
            if s_code:
                _SOCIAL_PRESENCE[s_code] = {**sender, "friendCode": s_code, "lastSeen": now_ms}

        _append_mailbox_packet_unlocked(
            target, pkt, ttl_ms=_SOCIAL_TTL_MS, dedup_id=pkt.get("msgId") or pkt.get("_packetId")
        )

    return {"ok": True, "serverTs": now_ms}


@router.post("/api/jam/social/poll")
def jam_social_poll_endpoint(req: SocialPollRequest):
    """Updates sender presence and returns new mailbox packets plus online friend states."""
    with _SOCIAL_LOCK:
        now_ms = _current_server_ts()
        my_code = _normalize_friend_code(req.friendCode)
        if my_code:
            existing = _SOCIAL_PRESENCE.get(my_code, {"friendCode": my_code})
            if isinstance(req.summary, dict):
                _SOCIAL_PRESENCE[my_code] = {**existing, **req.summary, "friendCode": my_code, "lastSeen": now_ms}
            else:
                _SOCIAL_PRESENCE[my_code] = {**existing, "friendCode": my_code, "lastSeen": now_ms}

        box = _SOCIAL_MAILBOX.get(my_code, [])
        cutoff = now_ms - _SOCIAL_TTL_MS
        box[:] = [m for m in box if m.get("_serverTs", 0) > cutoff]
        since_ts = int(req.since or 0)
        packets = [dict(m) for m in box if m.get("_serverTs", 0) > since_ts]
        presence_list = _collect_online_presence_unlocked(req.friendCodes or [], now_ms)

    return {
        "ok": True,
        "serverTs": now_ms,
        "inbox": packets,
        "packets": packets,
        "friends": presence_list,
        "presence": presence_list,
    }


@router.get("/api/social")
def edge_social_get_endpoint(id: str = "", friendCode: str = "", friends: str = "", since: int = 0):
    """GET edge relay poll compatible with standalone/Vercel Edge Social API."""
    with _SOCIAL_LOCK:
        now_ms = _current_server_ts()
        my_code = _normalize_friend_code(id or friendCode)

        if my_code:
            existing = _SOCIAL_PRESENCE.get(my_code)
            if existing is None:
                _SOCIAL_PRESENCE[my_code] = {"friendCode": my_code, "lastSeen": now_ms}
            else:
                existing["lastSeen"] = now_ms

        box = _SOCIAL_MAILBOX.get(my_code, [])
        cutoff = now_ms - _SOCIAL_TTL_MS
        box[:] = [m for m in box if m.get("_serverTs", 0) > cutoff]
        since_ts = int(since or 0)
        packets = [dict(m) for m in box if m.get("_serverTs", 0) > since_ts]

        friend_codes = [f.strip() for f in (friends or "").split(",") if f.strip()]
        presence_list = _collect_online_presence_unlocked(friend_codes, now_ms)

    return {
        "ok": True,
        "serverTs": now_ms,
        "inbox": packets,
        "packets": packets,
        "friends": presence_list,
        "presence": presence_list,
    }


@router.post("/api/social")
def edge_social_post_endpoint(body: Dict[str, Any]):
    """POST edge relay push/poll compatible with standalone/Vercel Edge Social API."""
    action = body.get("action") or ("push" if (body.get("toId") or body.get("targetFriendCode")) else "poll")

    if action == "push":
        with _SOCIAL_LOCK:
            now_ms = _next_push_ts()
            target = _normalize_friend_code(
                str(body.get("toId") or body.get("targetFriendCode") or (body.get("packet") or {}).get("targetFriendCode") or "")
            )
            pkt = dict(body.get("packet") or {}) if isinstance(body.get("packet"), dict) else {}
            pkt["_serverTs"] = now_ms
            if target:
                pkt["targetFriendCode"] = target

            sender = pkt.get("from") or body.get("summary") or body.get("profile")
            s_raw = (sender.get("friendCode") if isinstance(sender, dict) else None) or pkt.get("_fromFriendCode") or body.get("fromId")
            s_code = _normalize_friend_code(str(s_raw or ""))
            if s_code and isinstance(sender, dict):
                existing = _SOCIAL_PRESENCE.get(s_code, {"friendCode": s_code})
                _SOCIAL_PRESENCE[s_code] = {**existing, **sender, "friendCode": s_code, "lastSeen": now_ms}

            if target and pkt:
                _append_mailbox_packet_unlocked(
                    target,
                    pkt,
                    ttl_ms=_SOCIAL_TTL_MS,
                    dedup_id=pkt.get("msgId") or pkt.get("_packetId"),
                )
        return {"ok": True, "serverTs": now_ms}

    with _SOCIAL_LOCK:
        now_ms = _current_server_ts()
        my_code = _normalize_friend_code(str(body.get("id") or body.get("friendCode") or ""))
        summary = body.get("summary") or body.get("profile")
        if my_code:
            existing = _SOCIAL_PRESENCE.get(my_code, {"friendCode": my_code})
            if isinstance(summary, dict):
                _SOCIAL_PRESENCE[my_code] = {**existing, **summary, "friendCode": my_code, "lastSeen": now_ms}
            else:
                _SOCIAL_PRESENCE[my_code] = {**existing, "friendCode": my_code, "lastSeen": now_ms}

        box = _SOCIAL_MAILBOX.get(my_code, [])
        cutoff = now_ms - _SOCIAL_TTL_MS
        box[:] = [m for m in box if m.get("_serverTs", 0) > cutoff]
        since_ts = int(body.get("since") or 0)
        packets = [dict(m) for m in box if m.get("_serverTs", 0) > since_ts]

        raw_friends = body.get("friends") or body.get("friendCodes") or []
        if not isinstance(raw_friends, list):
            raw_friends = []
        presence_list = _collect_online_presence_unlocked(raw_friends, now_ms)

    return {
        "ok": True,
        "serverTs": now_ms,
        "inbox": packets,
        "packets": packets,
        "friends": presence_list,
        "presence": presence_list,
    }


@router.post("/api/jam/room/send")
def jam_room_send_endpoint(req: JamRoomSendRequest):
    """Appends a Jam room playback/chat event packet for polling clients."""
    with _SOCIAL_LOCK:
        now_ms = _next_push_ts()
        room = (req.roomCode or "").strip().upper()
        if not room:
            return {"ok": False}

        pkt = dict(req.packet or {})
        pkt["_serverTs"] = now_ms

        events = _JAM_ROOMS.setdefault(room, [])
        cutoff = now_ms - _JAM_TTL_MS
        events[:] = [e for e in events if e.get("_serverTs", 0) > cutoff]

        pkt_id = pkt.get("_packetId")
        if not pkt_id or not any(e.get("_packetId") == pkt_id for e in events):
            events.append(pkt)
            if len(events) > 200:
                del events[:-200]

    return {"ok": True, "serverTs": now_ms}


@router.get("/api/jam/room/poll")
def jam_room_poll_endpoint(roomCode: str = "", since: int = 0):
    """Returns Jam room events newer than since timestamp."""
    with _SOCIAL_LOCK:
        now_ms = _current_server_ts()
        room = (roomCode or "").strip().upper()
        events = _JAM_ROOMS.get(room, [])
        cutoff = now_ms - _JAM_TTL_MS
        events[:] = [e for e in events if e.get("_serverTs", 0) > cutoff]
        packets = [dict(e) for e in events if e.get("_serverTs", 0) > since]
    return {
        "ok": True,
        "serverTs": now_ms,
        "packets": packets,
    }


@router.get("/api/profile")
def get_user_profile_endpoint():
    """Returns persisted user profile JSON if present."""
    profile_path = resolve_main_attr("PROFILE_FILE", PROFILE_FILE)
    with _PROFILE_LOCK:
        if os.path.exists(profile_path):
            try:
                with open(profile_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    return data if isinstance(data, dict) else {}
            except Exception:
                pass
    return {}


@router.post("/api/profile")
async def save_user_profile_endpoint(request: Request):
    """Atomically persists updated user profile JSON to disk."""
    profile_path = resolve_main_attr("PROFILE_FILE", PROFILE_FILE)
    try:
        raw_body = await request.body()
        if len(raw_body) > 2 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Profile payload too large")
        payload = json.loads(raw_body.decode("utf-8"))
        if isinstance(payload, dict):
            target_dir = os.path.dirname(os.path.abspath(profile_path))
            tmp_path = ""
            with _PROFILE_LOCK:
                os.makedirs(target_dir, exist_ok=True)
                try:
                    with tempfile.NamedTemporaryFile(
                        "w", dir=target_dir, prefix=".profile_", suffix=".tmp", delete=False, encoding="utf-8"
                    ) as tf:
                        tmp_path = tf.name
                        json.dump(payload, tf, ensure_ascii=False)
                        tf.flush()
                        os.fsync(tf.fileno())
                    os.replace(tmp_path, profile_path)
                except Exception:
                    if tmp_path and os.path.exists(tmp_path):
                        try:
                            os.remove(tmp_path)
                        except OSError:
                            pass
                    raise
            return {"ok": True, "profile": payload}
    except HTTPException:
        raise
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": False}


@router.post("/api/profile/pick-photo")
def pick_profile_photo_native_endpoint(request: Request):
    """
    Opens a native macOS file chooser dialog via osascript and returns a
    downscaled 320x320 JPEG base64 data URL (supporting PNG, JPG, HEIC, WEBP, etc.).
    """
    require_local_origin(request, require_loopback=True)
    if sys.platform != "darwin" or os.environ.get("VERCEL"):
        return {"ok": False, "error": "Native photo picker is only supported on macOS"}

    script = (
        'tell application "System Events"\n'
        '  activate\n'
        '  set f to choose file of type {"public.image"} with prompt "Select a profile photo for UpBeat:"\n'
        '  return POSIX path of f\n'
        'end tell'
    )
    try:
        proc = subprocess.run(
            ["osascript", "-e", script],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if proc.returncode != 0:
            return {"ok": False, "cancelled": True}
        chosen_path = (proc.stdout or "").strip()
        if not chosen_path or not os.path.exists(chosen_path):
            return {"ok": False, "cancelled": True}

        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
            tmp_jpg = tmp.name

        try:
            sips_proc = subprocess.run(
                [
                    "sips", "-s", "format", "jpeg", "-s", "formatOptions", "85",
                    "-Z", "320", chosen_path, "--out", tmp_jpg,
                ],
                capture_output=True,
                timeout=15,
            )
            target_file = (
                tmp_jpg
                if (sips_proc.returncode == 0 and os.path.exists(tmp_jpg) and os.path.getsize(tmp_jpg) > 0)
                else chosen_path
            )
            with open(target_file, "rb") as img_f:
                raw_bytes = img_f.read()
            b64 = base64.b64encode(raw_bytes).decode("ascii")
            mime = "image/jpeg" if target_file == tmp_jpg else "image/png"
            return {"ok": True, "dataUrl": f"data:{mime};base64,{b64}"}
        finally:
            if os.path.exists(tmp_jpg):
                try:
                    os.remove(tmp_jpg)
                except Exception:
                    pass
    except Exception as e:
        return {"ok": False, "error": str(e)}
