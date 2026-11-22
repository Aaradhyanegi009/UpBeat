"""Real-time Jam room relay, social friend mailbox, and profile persistence routes."""

import base64
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
from typing import Any, Dict, List, Optional, Tuple
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
import requests as ext_requests

try:
    from routers import require_local_origin, resolve_main_attr
    from routers.offline import DOWNLOADS_DIR
except ImportError:
    from backend.routers import require_local_origin, resolve_main_attr
    from backend.routers.offline import DOWNLOADS_DIR

router = APIRouter()

_SOCIAL_LOCK = threading.Lock()
_PROFILE_LOCK = threading.Lock()
_KV_HTTP = ext_requests.Session()
_SOCIAL_MAILBOX: Dict[str, List[Dict[str, Any]]] = {}
_SOCIAL_PRESENCE: Dict[str, Dict[str, Any]] = {}
_JAM_ROOMS: Dict[str, List[Dict[str, Any]]] = {}
_LAST_SERVER_TS = 0

_SOCIAL_TTL_MS = 15 * 60 * 1000
_SOCIAL_TTL_SEC = 15 * 60
_JAM_TTL_MS = 2 * 3600 * 1000
_JAM_TTL_SEC = 2 * 3600
_ONLINE_WINDOW_MS = 45 * 1000
_MAX_MAILBOX_PACKETS = 150
_MAX_ROOM_PACKETS = 200

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


def _get_kv_config() -> Optional[Tuple[str, str]]:
    url = (os.environ.get("KV_REST_API_URL") or os.environ.get("UPSTASH_REDIS_REST_URL") or "").strip().rstrip("/")
    token = (os.environ.get("KV_REST_API_TOKEN") or os.environ.get("UPSTASH_REDIS_REST_TOKEN") or "").strip()
    if url and token:
        return (url, token)
    return None


def _get_social_secret() -> str:
    return (os.environ.get("UPBEAT_SOCIAL_SECRET") or "").strip()


def _b64url_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _b64url_decode(val: str) -> bytes:
    clean = str(val or "").strip()
    pad = "=" * ((4 - (len(clean) % 4)) % 4)
    return base64.urlsafe_b64decode(clean + pad)


def create_social_session_token(payload: Optional[Dict[str, Any]] = None, secret: str = "") -> str:
    """Signs a compact HMAC-SHA256 social/jam session token (<payload_b64>.<sig_b64>)."""
    effective_secret = (secret or _get_social_secret()).strip()
    if not effective_secret:
        raise ValueError("UPBEAT_SOCIAL_SECRET is required to sign session tokens")
    claims = payload if isinstance(payload, dict) else {}
    payload_bytes = json.dumps(claims, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    payload_b64 = _b64url_encode(payload_bytes)
    sig_bytes = hmac.new(
        effective_secret.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return f"{payload_b64}.{_b64url_encode(sig_bytes)}"


def verify_social_session_token(
    token: str, secret: str = "", now_ms: Optional[int] = None
) -> Optional[Dict[str, Any]]:
    """Verifies an HMAC-SHA256 social/jam session token and optional expiration."""
    effective_secret = (secret or _get_social_secret()).strip()
    if not effective_secret or not token or not isinstance(token, str):
        return None
    parts = token.strip().split(".")
    if len(parts) != 2 or not parts[0] or not parts[1]:
        return None
    payload_b64, sig_b64 = parts
    try:
        actual_sig = _b64url_decode(sig_b64)
        expected_sig = hmac.new(
            effective_secret.encode("utf-8"),
            payload_b64.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(actual_sig, expected_sig):
            return None
        claims = json.loads(_b64url_decode(payload_b64).decode("utf-8"))
        if not isinstance(claims, dict):
            return None
        if claims.get("exp") is not None:
            raw_exp = claims.get("exp")
            if isinstance(raw_exp, bool):
                return None
            num_exp = float(raw_exp)
            exp_ms = num_exp * 1000.0 if num_exp < 1e12 else num_exp
            cur_ms = float(int(time.time() * 1000) if now_ms is None else now_ms)
            if exp_ms <= cur_ms:
                return None
        return claims
    except Exception:
        return None


def _next_push_ts(now_ms: Optional[int] = None, min_ts: int = 0) -> int:
    """Monotonic server timestamp for pushed packets so same-ms packets are never skipped by `since`."""
    global _LAST_SERVER_TS
    cur = int(time.time() * 1000) if now_ms is None else now_ms
    ts = max(cur, _LAST_SERVER_TS + 1, min_ts)
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


def _normalize_room_code(code: str) -> str:
    """Normalizes Jam room codes cleanly matching Edge social.js."""
    raw = str(code or "").strip().upper()
    return re.sub(r"[^A-Z0-9_-]", "", raw)[:32]


def _require_social_session(
    request: Optional[Request], friend_code: str = "", room_code: str = ""
) -> Optional[Dict[str, Any]]:
    secret = _get_social_secret()
    if not secret:
        return None
    token = (request.headers.get("x-upbeat-session") if request else None) or ""
    claims = verify_social_session_token(token, secret)
    if not claims:
        raise HTTPException(status_code=401, detail="Unauthorized: invalid or missing session token")

    raw_sub = claims.get("sub") or claims.get("friendCode") or claims.get("id") or ""
    if raw_sub and str(raw_sub).strip() != "*":
        bound_fc = _normalize_friend_code(str(raw_sub))
        req_fc = _normalize_friend_code(friend_code) if friend_code else ""
        if bound_fc and req_fc and bound_fc != req_fc:
            raise HTTPException(status_code=403, detail="Forbidden: session token friendCode mismatch")

    raw_room = claims.get("roomCode") or ""
    if raw_room and str(raw_room).strip() != "*":
        bound_room = _normalize_room_code(str(raw_room))
        req_room = _normalize_room_code(room_code) if room_code else ""
        if bound_room and req_room and bound_room != req_room:
            raise HTTPException(status_code=403, detail="Forbidden: session token roomCode mismatch")

    return claims


def _box_key(friend_code: str) -> str:
    return f"upbeat:social:box:{friend_code}"


def _pres_key(friend_code: str) -> str:
    return f"upbeat:social:pres:{friend_code}"


def _room_key(room_code: str) -> str:
    return f"upbeat:jam:room:{room_code}"


def _parse_kv_json(raw: Any, fallback: Any) -> Any:
    if raw is None or raw == "":
        return fallback
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return fallback if parsed is None else parsed
        except Exception:
            return fallback
    return raw


def _kv_command(cfg: Tuple[str, str], cmd: List[Any]) -> Any:
    url, token = cfg
    resp = _KV_HTTP.post(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        json=cmd,
        timeout=3.0,
    )
    if resp.status_code != 200:
        raise RuntimeError(f"KV HTTP {resp.status_code}")
    body = resp.json()
    if isinstance(body, dict):
        if body.get("error"):
            raise RuntimeError(str(body["error"]))
        if "result" in body:
            return body["result"]
    return body


def _kv_mget_map(cfg: Tuple[str, str], keys: List[str]) -> Dict[str, Any]:
    if not keys:
        return {}
    result = _kv_command(cfg, ["MGET", *keys])
    values = result if isinstance(result, list) else []
    return {k: (values[i] if i < len(values) else None) for i, k in enumerate(keys)}


def _collect_online_presence_unlocked(
    friend_codes: List[str], now_ms: int, include_code: bool = True
) -> List[Dict[str, Any]]:
    presence_list: List[Dict[str, Any]] = []
    for fc in friend_codes:
        clean_fc = _normalize_friend_code(fc)
        if not clean_fc:
            continue
        pres = _SOCIAL_PRESENCE.get(clean_fc)
        if pres and (now_ms - pres.get("lastSeen", 0) < _ONLINE_WINDOW_MS):
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
        if len(box) > _MAX_MAILBOX_PACKETS:
            del box[:-_MAX_MAILBOX_PACKETS]


def _perform_social_push(
    target: str,
    raw_packet: Optional[Dict[str, Any]],
    sender_code: str = "",
    sender_profile: Optional[Dict[str, Any]] = None,
) -> int:
    kv_cfg = _get_kv_config()
    pkt = dict(raw_packet or {}) if isinstance(raw_packet, dict) else None

    if kv_cfg:
        try:
            read_keys: List[str] = []
            if sender_code and isinstance(sender_profile, dict):
                read_keys.append(_pres_key(sender_code))
            if target and pkt is not None:
                read_keys.append(_box_key(target))
            fetched = _kv_mget_map(kv_cfg, read_keys) if read_keys else {}
            base_now = int(time.time() * 1000)

            valid_box: List[Dict[str, Any]] = []
            max_existing_ts = 0
            if target and pkt is not None:
                raw_box = _parse_kv_json(fetched.get(_box_key(target)), [])
                cutoff = base_now - _SOCIAL_TTL_MS
                if isinstance(raw_box, list):
                    valid_box = [m for m in raw_box if isinstance(m, dict) and m.get("_serverTs", 0) > cutoff]
                max_existing_ts = max((int(m.get("_serverTs", 0)) for m in valid_box), default=0)

            now_ms = _next_push_ts(base_now, min_ts=(max_existing_ts + 1 if max_existing_ts else 0))

            if sender_code and isinstance(sender_profile, dict):
                cur_pres = _parse_kv_json(fetched.get(_pres_key(sender_code)), {})
                merged_pres = {
                    **(cur_pres if isinstance(cur_pres, dict) else {}),
                    **sender_profile,
                    "friendCode": sender_code,
                    "lastSeen": now_ms,
                }
                _kv_command(
                    kv_cfg,
                    ["SET", _pres_key(sender_code), json.dumps(merged_pres, ensure_ascii=False), "EX", _SOCIAL_TTL_SEC],
                )

            if target and pkt is not None:
                pkt["_serverTs"] = now_ms
                pkt["targetFriendCode"] = target
                dedup_id = pkt.get("msgId") or pkt.get("_packetId")
                if not dedup_id or not any((m.get("msgId") or m.get("_packetId")) == dedup_id for m in valid_box):
                    valid_box.append(pkt)
                    if len(valid_box) > _MAX_MAILBOX_PACKETS:
                        del valid_box[:-_MAX_MAILBOX_PACKETS]
                _kv_command(
                    kv_cfg,
                    ["SET", _box_key(target), json.dumps(valid_box, ensure_ascii=False), "EX", _SOCIAL_TTL_SEC],
                )
            return now_ms
        except Exception as e:
            print(f"Social KV push fallback to memory: {e}")

    with _SOCIAL_LOCK:
        now_ms = _next_push_ts()
        if sender_code and isinstance(sender_profile, dict):
            existing = _SOCIAL_PRESENCE.get(sender_code, {"friendCode": sender_code})
            _SOCIAL_PRESENCE[sender_code] = {
                **existing,
                **sender_profile,
                "friendCode": sender_code,
                "lastSeen": now_ms,
            }
        if target and pkt is not None:
            pkt["_serverTs"] = now_ms
            pkt["targetFriendCode"] = target
            _append_mailbox_packet_unlocked(
                target,
                pkt,
                ttl_ms=_SOCIAL_TTL_MS,
                dedup_id=pkt.get("msgId") or pkt.get("_packetId"),
            )
    return now_ms


def _perform_social_poll(
    my_code: str,
    friend_codes: List[str],
    since_ts: int,
    summary: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    kv_cfg = _get_kv_config()

    if kv_cfg:
        try:
            now_ms = _current_server_ts()
            keys: List[str] = []
            if my_code:
                keys.extend([_box_key(my_code), _pres_key(my_code)])
            clean_friends: List[str] = []
            for fc in friend_codes:
                clean_fc = _normalize_friend_code(fc)
                if clean_fc:
                    clean_friends.append(clean_fc)
                    pk = _pres_key(clean_fc)
                    if pk not in keys:
                        keys.append(pk)

            fetched = _kv_mget_map(kv_cfg, keys) if keys else {}
            packets: List[Dict[str, Any]] = []
            own_pres: Optional[Dict[str, Any]] = None

            if my_code:
                raw_box = _parse_kv_json(fetched.get(_box_key(my_code)), [])
                cutoff = now_ms - _SOCIAL_TTL_MS
                valid_box = [
                    m for m in (raw_box if isinstance(raw_box, list) else [])
                    if isinstance(m, dict) and m.get("_serverTs", 0) > cutoff
                ]
                packets = [dict(m) for m in valid_box if m.get("_serverTs", 0) > since_ts]

                cur_pres = _parse_kv_json(fetched.get(_pres_key(my_code)), {"friendCode": my_code})
                base_pres = cur_pres if isinstance(cur_pres, dict) else {"friendCode": my_code}
                if isinstance(summary, dict):
                    own_pres = {**base_pres, **summary, "friendCode": my_code, "lastSeen": now_ms}
                else:
                    own_pres = {**base_pres, "friendCode": my_code, "lastSeen": now_ms}
                _kv_command(
                    kv_cfg,
                    ["SET", _pres_key(my_code), json.dumps(own_pres, ensure_ascii=False), "EX", _SOCIAL_TTL_SEC],
                )

            presence_list: List[Dict[str, Any]] = []
            for clean_fc in clean_friends:
                pres = (
                    own_pres
                    if (clean_fc == my_code and own_pres is not None)
                    else _parse_kv_json(fetched.get(_pres_key(clean_fc)), None)
                )
                if isinstance(pres, dict) and (now_ms - pres.get("lastSeen", 0) < _ONLINE_WINDOW_MS):
                    presence_list.append({**pres, "friendCode": clean_fc, "online": True})

            max_pkt_ts = max((int(m.get("_serverTs", 0)) for m in packets), default=0)
            effective_ts = _current_server_ts(max(now_ms, max_pkt_ts))
            return {
                "ok": True,
                "serverTs": effective_ts,
                "inbox": packets,
                "packets": packets,
                "friends": presence_list,
                "presence": presence_list,
            }
        except Exception as e:
            print(f"Social KV poll fallback to memory: {e}")

    with _SOCIAL_LOCK:
        now_ms = _current_server_ts()
        if my_code:
            existing = _SOCIAL_PRESENCE.get(my_code, {"friendCode": my_code})
            if isinstance(summary, dict):
                _SOCIAL_PRESENCE[my_code] = {**existing, **summary, "friendCode": my_code, "lastSeen": now_ms}
            else:
                _SOCIAL_PRESENCE[my_code] = {**existing, "friendCode": my_code, "lastSeen": now_ms}

        box = _SOCIAL_MAILBOX.get(my_code, [])
        cutoff = now_ms - _SOCIAL_TTL_MS
        box[:] = [m for m in box if m.get("_serverTs", 0) > cutoff]
        packets = [dict(m) for m in box if m.get("_serverTs", 0) > since_ts]
        presence_list = _collect_online_presence_unlocked(friend_codes, now_ms)

    return {
        "ok": True,
        "serverTs": now_ms,
        "inbox": packets,
        "packets": packets,
        "friends": presence_list,
        "presence": presence_list,
    }


def _perform_room_send(room: str, raw_packet: Optional[Dict[str, Any]]) -> int:
    kv_cfg = _get_kv_config()
    pkt = dict(raw_packet or {}) if isinstance(raw_packet, dict) else {}

    if kv_cfg:
        try:
            raw_events = _parse_kv_json(_kv_command(kv_cfg, ["GET", _room_key(room)]), [])
            base_now = int(time.time() * 1000)
            cutoff = base_now - _JAM_TTL_MS
            events = [
                e for e in (raw_events if isinstance(raw_events, list) else [])
                if isinstance(e, dict) and e.get("_serverTs", 0) > cutoff
            ]
            max_existing_ts = max((int(e.get("_serverTs", 0)) for e in events), default=0)
            now_ms = _next_push_ts(base_now, min_ts=(max_existing_ts + 1 if max_existing_ts else 0))

            pkt["_serverTs"] = now_ms
            pkt_id = pkt.get("_packetId") or pkt.get("msgId")
            if not pkt_id or not any((e.get("_packetId") or e.get("msgId")) == pkt_id for e in events):
                events.append(pkt)
                if len(events) > _MAX_ROOM_PACKETS:
                    del events[:-_MAX_ROOM_PACKETS]
            _kv_command(
                kv_cfg,
                ["SET", _room_key(room), json.dumps(events, ensure_ascii=False), "EX", _JAM_TTL_SEC],
            )
            return now_ms
        except Exception as e:
            print(f"Jam Room KV send fallback to memory: {e}")

    with _SOCIAL_LOCK:
        now_ms = _next_push_ts()
        pkt["_serverTs"] = now_ms
        events = _JAM_ROOMS.setdefault(room, [])
        cutoff = now_ms - _JAM_TTL_MS
        events[:] = [e for e in events if e.get("_serverTs", 0) > cutoff]

        pkt_id = pkt.get("_packetId") or pkt.get("msgId")
        if not pkt_id or not any((e.get("_packetId") or e.get("msgId")) == pkt_id for e in events):
            events.append(pkt)
            if len(events) > _MAX_ROOM_PACKETS:
                del events[:-_MAX_ROOM_PACKETS]
    return now_ms


def _perform_room_poll(room: str, since: int) -> Tuple[int, List[Dict[str, Any]]]:
    kv_cfg = _get_kv_config()
    now_ms = _current_server_ts()

    if kv_cfg:
        try:
            raw_events = _parse_kv_json(_kv_command(kv_cfg, ["GET", _room_key(room)]), [])
            cutoff = now_ms - _JAM_TTL_MS
            events = [
                e for e in (raw_events if isinstance(raw_events, list) else [])
                if isinstance(e, dict) and e.get("_serverTs", 0) > cutoff
            ]
            packets = [dict(e) for e in events if e.get("_serverTs", 0) > since]
            max_pkt_ts = max((int(e.get("_serverTs", 0)) for e in packets), default=0)
            effective_ts = _current_server_ts(max(now_ms, max_pkt_ts))
            return effective_ts, packets
        except Exception as e:
            print(f"Jam Room KV poll fallback to memory: {e}")

    with _SOCIAL_LOCK:
        events = _JAM_ROOMS.get(room, [])
        cutoff = now_ms - _JAM_TTL_MS
        events[:] = [e for e in events if e.get("_serverTs", 0) > cutoff]
        packets = [dict(e) for e in events if e.get("_serverTs", 0) > since]
    return now_ms, packets


@router.post("/api/jam/social/send")
def jam_social_send_endpoint(req: SocialSendRequest, request: Request):
    """Enqueues a social/friend signaling packet into the recipient's mailbox."""
    pkt = dict(req.packet or {})
    sender = pkt.get("from")
    s_code = _normalize_friend_code(sender["friendCode"]) if isinstance(sender, dict) and sender.get("friendCode") else ""
    _require_social_session(request, friend_code=s_code)

    target = _normalize_friend_code(req.targetFriendCode)
    if not target:
        return {"ok": False}

    now_ms = _perform_social_push(
        target=target,
        raw_packet=pkt,
        sender_code=s_code,
        sender_profile=sender if isinstance(sender, dict) else None,
    )
    return {"ok": True, "serverTs": now_ms}


@router.post("/api/jam/social/poll")
def jam_social_poll_endpoint(req: SocialPollRequest, request: Request):
    """Updates sender presence and returns new mailbox packets plus online friend states."""
    my_code = _normalize_friend_code(req.friendCode)
    _require_social_session(request, friend_code=my_code)
    return _perform_social_poll(
        my_code=my_code,
        friend_codes=req.friendCodes or [],
        since_ts=int(req.since or 0),
        summary=req.summary if isinstance(req.summary, dict) else None,
    )


@router.get("/api/social")
def edge_social_get_endpoint(
    request: Request,
    id: str = "",
    friendCode: str = "",
    friends: str = "",
    since: int = 0,
    roomCode: str = "",
    action: str = "",
):
    """GET edge relay poll compatible with standalone/Vercel Edge Social API & Jam room poll."""
    if roomCode or action == "room_poll":
        clean_room = _normalize_room_code(roomCode)
        _require_social_session(request, room_code=clean_room)
        if not clean_room:
            raise HTTPException(status_code=400, detail="roomCode is required")
        now_ms, packets = _perform_room_poll(clean_room, int(since or 0))
        return {
            "ok": True,
            "serverTs": now_ms,
            "roomCode": clean_room,
            "events": packets,
            "packets": packets,
        }

    my_code = _normalize_friend_code(id or friendCode)
    _require_social_session(request, friend_code=my_code)
    friend_codes = [f.strip() for f in (friends or "").split(",") if f.strip()]
    return _perform_social_poll(
        my_code=my_code,
        friend_codes=friend_codes,
        since_ts=int(since or 0),
        summary=None,
    )


@router.post("/api/social")
def edge_social_post_endpoint(body: Dict[str, Any], request: Request):
    """POST edge relay push/poll/room_send/room_poll compatible with Vercel Edge Social API."""
    action = body.get("action") or (
        ("room_send" if body.get("packet") else "room_poll")
        if body.get("roomCode")
        else ("push" if (body.get("toId") or body.get("targetFriendCode")) else "poll")
    )

    if action == "room_send":
        clean_room = _normalize_room_code(str(body.get("roomCode") or ""))
        _require_social_session(request, room_code=clean_room)
        if not clean_room:
            raise HTTPException(status_code=400, detail="roomCode is required")
        pkt = body.get("packet") if isinstance(body.get("packet"), dict) else {}
        now_ms = _perform_room_send(clean_room, pkt)
        return {"ok": True, "serverTs": now_ms, "roomCode": clean_room}

    if action == "room_poll":
        clean_room = _normalize_room_code(str(body.get("roomCode") or ""))
        _require_social_session(request, room_code=clean_room)
        if not clean_room:
            raise HTTPException(status_code=400, detail="roomCode is required")
        now_ms, packets = _perform_room_poll(clean_room, int(body.get("since") or 0))
        return {
            "ok": True,
            "serverTs": now_ms,
            "roomCode": clean_room,
            "events": packets,
            "packets": packets,
        }

    if action == "push":
        target = _normalize_friend_code(
            str(body.get("toId") or body.get("targetFriendCode") or (body.get("packet") or {}).get("targetFriendCode") or "")
        )
        pkt = dict(body.get("packet") or {}) if isinstance(body.get("packet"), dict) else None
        sender = (pkt.get("from") if pkt else None) or body.get("summary") or body.get("profile")
        s_raw = (sender.get("friendCode") if isinstance(sender, dict) else None) or (pkt.get("_fromFriendCode") if pkt else None) or body.get("fromId")
        s_code = _normalize_friend_code(str(s_raw or ""))
        _require_social_session(request, friend_code=s_code)

        now_ms = _perform_social_push(
            target=target,
            raw_packet=pkt,
            sender_code=s_code,
            sender_profile=sender if isinstance(sender, dict) else None,
        )
        return {"ok": True, "serverTs": now_ms}

    my_code = _normalize_friend_code(str(body.get("id") or body.get("friendCode") or ""))
    _require_social_session(request, friend_code=my_code)
    summary = body.get("summary") or body.get("profile")
    raw_friends = body.get("friends") or body.get("friendCodes") or []
    if not isinstance(raw_friends, list):
        raw_friends = []
    return _perform_social_poll(
        my_code=my_code,
        friend_codes=raw_friends,
        since_ts=int(body.get("since") or 0),
        summary=summary if isinstance(summary, dict) else None,
    )


@router.post("/api/jam/room/send")
def jam_room_send_endpoint(req: JamRoomSendRequest, request: Request):
    """Appends a Jam room playback/chat event packet for polling clients."""
    room = _normalize_room_code(req.roomCode)
    _require_social_session(request, room_code=room)
    if not room:
        return {"ok": False}

    now_ms = _perform_room_send(room, req.packet)
    return {"ok": True, "serverTs": now_ms}


@router.get("/api/jam/room/poll")
def jam_room_poll_endpoint(request: Request, roomCode: str = "", since: int = 0):
    """Returns Jam room events newer than since timestamp."""
    room = _normalize_room_code(roomCode)
    _require_social_session(request, room_code=room)
    now_ms, packets = _perform_room_poll(room, int(since or 0))
    return {
        "ok": True,
        "serverTs": now_ms,
        "events": packets,
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
