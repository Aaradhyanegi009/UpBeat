"""Real-time Jam room relay, social friend mailbox, and profile persistence routes."""

import base64
import json
import os
import subprocess
import tempfile
import time
from typing import Any, Dict, List, Optional
from fastapi import APIRouter, Request
from pydantic import BaseModel

try:
    from routers import resolve_main_attr
    from routers.offline import DOWNLOADS_DIR
except ImportError:
    from backend.routers import resolve_main_attr
    from backend.routers.offline import DOWNLOADS_DIR

router = APIRouter()

_SOCIAL_MAILBOX: Dict[str, List[Dict[str, Any]]] = {}
_SOCIAL_PRESENCE: Dict[str, Dict[str, Any]] = {}
_JAM_ROOMS: Dict[str, List[Dict[str, Any]]] = {}

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


def _normalize_friend_code(code: str, auto_prefix: bool = False) -> str:
    clean = str(code or "").strip().upper()
    if auto_prefix and clean and not clean.startswith("UP-") and len(clean) == 6:
        return f"UP-{clean}"
    return clean


def _collect_online_presence(
    friend_codes: List[str], now_ms: int, auto_prefix: bool = False, include_code: bool = False
) -> List[Dict[str, Any]]:
    presence_list: List[Dict[str, Any]] = []
    for fc in friend_codes:
        clean_fc = _normalize_friend_code(fc, auto_prefix=auto_prefix)
        if not clean_fc:
            continue
        pres = _SOCIAL_PRESENCE.get(clean_fc)
        if pres and (now_ms - pres.get("lastSeen", 0) < 45000):
            entry = {**pres, "online": True}
            if include_code:
                entry["friendCode"] = clean_fc
            presence_list.append(entry)
    return presence_list


def _append_mailbox_packet(target: str, pkt: Dict[str, Any], ttl_ms: int, dedup_id: Optional[str]) -> None:
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
    now_ms = int(time.time() * 1000)
    target = _normalize_friend_code(req.targetFriendCode)
    if not target:
        return {"ok": False}

    pkt = dict(req.packet or {})
    pkt["_serverTs"] = now_ms
    sender = pkt.get("from")
    if isinstance(sender, dict) and sender.get("friendCode"):
        s_code = _normalize_friend_code(sender["friendCode"])
        _SOCIAL_PRESENCE[s_code] = {**sender, "lastSeen": now_ms}

    _append_mailbox_packet(target, pkt, ttl_ms=12 * 3600 * 1000, dedup_id=pkt.get("_packetId"))

    return {"ok": True, "serverTs": now_ms}


@router.post("/api/jam/social/poll")
def jam_social_poll_endpoint(req: SocialPollRequest):
    """Updates sender presence and returns new mailbox packets plus online friend states."""
    now_ms = int(time.time() * 1000)
    my_code = _normalize_friend_code(req.friendCode)
    if my_code and isinstance(req.summary, dict):
        _SOCIAL_PRESENCE[my_code] = {**req.summary, "friendCode": my_code, "lastSeen": now_ms}

    box = _SOCIAL_MAILBOX.get(my_code, [])
    since_ts = int(req.since or 0)
    packets = [m for m in box if m.get("_serverTs", 0) > since_ts]
    presence_list = _collect_online_presence(req.friendCodes or [], now_ms)

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
    now_ms = int(time.time() * 1000)
    my_code = _normalize_friend_code(id or friendCode, auto_prefix=True)

    if my_code and my_code in _SOCIAL_PRESENCE:
        _SOCIAL_PRESENCE[my_code]["lastSeen"] = now_ms

    box = _SOCIAL_MAILBOX.get(my_code, [])
    cutoff = now_ms - (15 * 60 * 1000)
    box[:] = [m for m in box if m.get("_serverTs", 0) > cutoff]
    packets = [m for m in box if m.get("_serverTs", 0) > int(since or 0)]

    friend_codes = [f.strip().upper() for f in (friends or "").split(",") if f.strip()]
    presence_list = _collect_online_presence(friend_codes, now_ms, auto_prefix=True, include_code=True)

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
    now_ms = int(time.time() * 1000)
    action = body.get("action") or ("push" if (body.get("toId") or body.get("targetFriendCode")) else "poll")

    if action == "push":
        target = _normalize_friend_code(
            str(body.get("toId") or body.get("targetFriendCode") or ""), auto_prefix=True
        )
        pkt = dict(body.get("packet") or {})
        pkt["_serverTs"] = now_ms
        sender = pkt.get("from") or body.get("summary") or body.get("profile")
        if isinstance(sender, dict) and sender.get("friendCode"):
            s_code = _normalize_friend_code(sender["friendCode"])
            _SOCIAL_PRESENCE[s_code] = {**sender, "friendCode": s_code, "lastSeen": now_ms}

        if target and pkt:
            _append_mailbox_packet(
                target,
                pkt,
                ttl_ms=15 * 60 * 1000,
                dedup_id=pkt.get("msgId") or pkt.get("_packetId"),
            )
        return {"ok": True, "serverTs": now_ms}

    my_code = _normalize_friend_code(str(body.get("id") or body.get("friendCode") or ""))
    summary = body.get("summary") or body.get("profile")
    if my_code and isinstance(summary, dict):
        _SOCIAL_PRESENCE[my_code] = {**summary, "friendCode": my_code, "lastSeen": now_ms}

    box = _SOCIAL_MAILBOX.get(my_code, [])
    since_ts = int(body.get("since") or 0)
    packets = [m for m in box if m.get("_serverTs", 0) > since_ts]

    raw_friends = body.get("friends") or body.get("friendCodes") or []
    presence_list = _collect_online_presence(raw_friends, now_ms, auto_prefix=False, include_code=True)

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
    now_ms = int(time.time() * 1000)
    room = (req.roomCode or "").strip().upper()
    if not room:
        return {"ok": False}

    pkt = dict(req.packet or {})
    pkt["_serverTs"] = now_ms

    events = _JAM_ROOMS.setdefault(room, [])
    cutoff = now_ms - (2 * 3600 * 1000)
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
    now_ms = int(time.time() * 1000)
    room = (roomCode or "").strip().upper()
    events = _JAM_ROOMS.get(room, [])
    packets = [e for e in events if e.get("_serverTs", 0) > since]
    return {
        "ok": True,
        "serverTs": now_ms,
        "packets": packets,
    }


@router.get("/api/profile")
def get_user_profile_endpoint():
    """Returns persisted user profile JSON if present."""
    profile_path = resolve_main_attr("PROFILE_FILE", PROFILE_FILE)
    if os.path.exists(profile_path):
        try:
            with open(profile_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


@router.post("/api/profile")
async def save_user_profile_endpoint(request: Request):
    """Persists updated user profile JSON to disk."""
    profile_path = resolve_main_attr("PROFILE_FILE", PROFILE_FILE)
    try:
        payload = await request.json()
        if isinstance(payload, dict):
            with open(profile_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            return {"ok": True, "profile": payload}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": False}


@router.post("/api/profile/pick-photo")
def pick_profile_photo_native_endpoint():
    """
    Opens a native macOS file chooser dialog via osascript and returns a
    downscaled 320x320 JPEG base64 data URL (supporting PNG, JPG, HEIC, WEBP, etc.).
    """
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
