import json
import os
import time
import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import backend.main as main_mod
import backend.routers.music as music_mod
import backend.routers.social as social_mod


class _FakeKvStore:
    """In-memory mock of Upstash / Vercel KV REST endpoint supporting GET, MGET, SET with EX."""

    def __init__(self, expected_token: str = "kv-token"):
        self.expected_token = expected_token
        self.data = {}
        self.ttls = {}
        self.calls = []

    def handle_post(self, url, headers=None, json=None, timeout=None):
        resp = MagicMock()
        auth = (headers or {}).get("Authorization", "")
        if auth != f"Bearer {self.expected_token}":
            resp.status_code = 401
            resp.json.return_value = {"error": "Unauthorized"}
            return resp

        cmd = list(json or [])
        op = str(cmd[0]).upper() if cmd else ""
        self.calls.append((url, cmd))

        if op == "GET":
            key = cmd[1]
            resp.status_code = 200
            resp.json.return_value = {"result": self.data.get(key)}
            return resp

        if op == "MGET":
            keys = cmd[1:]
            resp.status_code = 200
            resp.json.return_value = {"result": [self.data.get(k) for k in keys]}
            return resp

        if op == "SET":
            key = cmd[1]
            val = cmd[2]
            self.data[key] = val
            if len(cmd) >= 5 and str(cmd[3]).upper() == "EX":
                self.ttls[key] = int(cmd[4])
            resp.status_code = 200
            resp.json.return_value = {"result": "OK"}
            return resp

        resp.status_code = 400
        resp.json.return_value = {"error": f"Unsupported op: {op}"}
        return resp


class TestLyricsAndSocialFeatures(unittest.TestCase):
    def setUp(self):
        music_mod.clear_lyrics_cache()
        social_mod._SOCIAL_MAILBOX.clear()
        social_mod._SOCIAL_PRESENCE.clear()
        social_mod._JAM_ROOMS.clear()
        self.client = TestClient(main_mod.app)

    def tearDown(self):
        music_mod.clear_lyrics_cache()
        social_mod._SOCIAL_MAILBOX.clear()
        social_mod._SOCIAL_PRESENCE.clear()
        social_mod._JAM_ROOMS.clear()

    def test_lyrics_api_get_duration_matched_lookup_and_search_fallback(self):
        get_resp = MagicMock()
        get_resp.status_code = 200
        get_resp.json.return_value = {
            "id": 42,
            "trackName": "Starboy",
            "artistName": "The Weeknd",
            "duration": 230,
            "syncedLyrics": "[00:01.00] I'm tryna put you in the worst mood",
        }

        with patch("backend.routers.music.ext_requests.get", return_value=get_resp) as mock_get:
            res = self.client.get(
                "/api/lyrics?track_name=Starboy&artist_name=The+Weeknd&duration=230"
            )
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertIsInstance(body, list)
            self.assertEqual(len(body), 1)
            self.assertEqual(body[0]["id"], 42)
            self.assertEqual(mock_get.call_count, 1)
            self.assertEqual(mock_get.call_args[0][0], "https://lrclib.net/api/get")
            self.assertEqual(
                mock_get.call_args[1]["params"],
                {"track_name": "Starboy", "artist_name": "The Weeknd", "duration": 230},
            )

        # Duration <= 15 should omit duration param on /api/get
        music_mod.clear_lyrics_cache()
        with patch("backend.routers.music.ext_requests.get", return_value=get_resp) as mock_get:
            res_short = self.client.get(
                "/api/lyrics?track_name=Starboy&artist_name=The+Weeknd&duration=10"
            )
            self.assertEqual(res_short.status_code, 200)
            self.assertEqual(
                mock_get.call_args[1]["params"],
                {"track_name": "Starboy", "artist_name": "The Weeknd"},
            )

        # When /api/get returns 404 (or lacks lyrics), fall back cleanly to /api/search
        music_mod.clear_lyrics_cache()
        miss_get = MagicMock()
        miss_get.status_code = 404
        search_hit = MagicMock()
        search_hit.status_code = 200
        search_hit.json.return_value = [{"id": 99, "trackName": "Starboy", "plainLyrics": "Ah"}]

        with patch(
            "backend.routers.music.ext_requests.get", side_effect=[miss_get, search_hit]
        ) as mock_get:
            res_fb = self.client.get(
                "/api/lyrics?track_name=Starboy&artist_name=The+Weeknd&duration=230&q=Starboy"
            )
            self.assertEqual(res_fb.status_code, 200)
            self.assertEqual(len(res_fb.json()), 1)
            self.assertEqual(res_fb.json()[0]["id"], 99)
            self.assertEqual(
                [c[0][0] for c in mock_get.call_args_list],
                ["https://lrclib.net/api/get", "https://lrclib.net/api/search"],
            )

    def test_lyrics_ttl_cache_hits_negative_misses_and_lru_bounds(self):
        # 1. Hit TTL cache (6h = 21600s)
        hit_resp = MagicMock()
        hit_resp.status_code = 200
        hit_resp.json.return_value = {
            "id": 7,
            "trackName": "Blinding Lights",
            "artistName": "The Weeknd",
            "plainLyrics": "I've been tryna call",
        }
        now = 1_700_000_000.0
        with patch("backend.routers.music.time.time", side_effect=lambda: now), patch(
            "backend.routers.music.ext_requests.get", return_value=hit_resp
        ) as mock_get:
            r1 = self.client.get("/api/lyrics?track_name=Blinding+Lights&artist_name=The+Weeknd&duration=200")
            r2 = self.client.get("/api/lyrics?track_name=blinding+lights&artist_name=the+weeknd&duration=200")
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(r1.json(), r2.json())
            self.assertEqual(mock_get.call_count, 1)

            # Advance past 6h TTL -> cache expires and refetches
            now += music_mod.LYRICS_CACHE_HIT_TTL_SEC + 1
            r3 = self.client.get("/api/lyrics?track_name=Blinding+Lights&artist_name=The+Weeknd&duration=200")
            self.assertEqual(r3.status_code, 200)
            self.assertEqual(mock_get.call_count, 2)

        # 2. Negative / empty miss TTL cache (5m = 300s)
        music_mod.clear_lyrics_cache()
        empty_resp = MagicMock()
        empty_resp.status_code = 200
        empty_resp.json.return_value = []
        now = 1_700_050_000.0
        with patch("backend.routers.music.time.time", side_effect=lambda: now), patch(
            "backend.routers.music.ext_requests.get", return_value=empty_resp
        ) as mock_get:
            m1 = self.client.get("/api/lyrics?q=Unlisted+Track+XYZ")
            m2 = self.client.get("/api/lyrics?q=unlisted+track+xyz")
            self.assertEqual(m1.json(), [])
            self.assertEqual(m2.json(), [])
            self.assertEqual(mock_get.call_count, 1)

            # Still cached at 4 minutes
            now += 240
            m3 = self.client.get("/api/lyrics?q=Unlisted+Track+XYZ")
            self.assertEqual(m3.json(), [])
            self.assertEqual(mock_get.call_count, 1)

            # Expired after 5m negative TTL
            now += 61
            m4 = self.client.get("/api/lyrics?q=Unlisted+Track+XYZ")
            self.assertEqual(m4.json(), [])
            self.assertEqual(mock_get.call_count, 2)

        # 3. Bounded LRU capacity (max 500 entries)
        music_mod.clear_lyrics_cache()
        for idx in range(510):
            music_mod._set_cached_lyrics((f"q-{idx}", "", "", 0), [{"id": idx}], 600)
        self.assertEqual(len(music_mod._LYRICS_CACHE), music_mod.LYRICS_CACHE_MAX_ENTRIES)
        self.assertIsNone(music_mod._get_cached_lyrics(("q-0", "", "", 0)))
        self.assertIsNotNone(music_mod._get_cached_lyrics(("q-509", "", "", 0)))

    def test_social_kv_rest_backing_and_jam_room_relay(self):
        fake_kv = _FakeKvStore(expected_token="kv-secret-tok")
        env = {
            "UPSTASH_REDIS_REST_URL": "https://redis.upstash.test",
            "UPSTASH_REDIS_REST_TOKEN": "kv-secret-tok",
        }
        with patch.dict(os.environ, env, clear=False), patch.object(
            social_mod._KV_HTTP, "post", side_effect=fake_kv.handle_post
        ):
            push_res = self.client.post(
                "/api/social",
                json={
                    "action": "push",
                    "toId": "ABC123",
                    "packet": {
                        "msgId": "kv-m1",
                        "type": "PING",
                        "from": {"friendCode": "UP-XYZ999", "name": "Alice"},
                    },
                },
            )
            self.assertEqual(push_res.status_code, 200)
            self.assertTrue(push_res.json()["ok"])
            # In-memory dicts must remain untouched when KV succeeded
            self.assertEqual(social_mod._SOCIAL_MAILBOX, {})
            self.assertEqual(social_mod._SOCIAL_PRESENCE, {})
            self.assertIn("upbeat:social:box:UP-ABC123", fake_kv.data)
            self.assertIn("upbeat:social:pres:UP-XYZ999", fake_kv.data)
            self.assertEqual(fake_kv.ttls["upbeat:social:box:UP-ABC123"], 900)

            poll_res = self.client.get("/api/social?id=UP-ABC123&friends=UP-XYZ999&since=0")
            self.assertEqual(poll_res.status_code, 200)
            poll_json = poll_res.json()
            self.assertEqual([m["msgId"] for m in poll_json["inbox"]], ["kv-m1"])
            self.assertEqual(poll_json["friends"][0]["friendCode"], "UP-XYZ999")
            self.assertTrue(poll_json["friends"][0]["online"])

            # Jam room relay via /api/social room_send + room_poll & ?roomCode=
            room_send = self.client.post(
                "/api/social",
                json={
                    "action": "room_send",
                    "roomCode": "jam-7788",
                    "packet": {"_packetId": "rp1", "type": "SEEK", "position": 42},
                },
            )
            self.assertEqual(room_send.status_code, 200)
            self.assertTrue(room_send.json()["ok"])
            self.assertEqual(social_mod._JAM_ROOMS, {})
            self.assertEqual(fake_kv.ttls["upbeat:jam:room:JAM-7788"], 7200)

            room_poll_get = self.client.get("/api/social?roomCode=JAM-7788&since=0")
            self.assertEqual(room_poll_get.status_code, 200)
            self.assertEqual(len(room_poll_get.json()["events"]), 1)
            self.assertEqual(room_poll_get.json()["packets"][0]["_packetId"], "rp1")

            room_poll_post = self.client.post(
                "/api/social",
                json={"action": "room_poll", "roomCode": "JAM-7788", "since": room_poll_get.json()["serverTs"]},
            )
            self.assertEqual(room_poll_post.status_code, 200)
            self.assertEqual(room_poll_post.json()["events"], [])

    def test_social_hmac_session_token_guard(self):
        secret = "super-secret-social-hmac"
        now_ms = int(time.time() * 1000)
        alice_token = social_mod.create_social_session_token(
            {"sub": "UP-ALICE1", "exp": now_ms + 60_000},
            secret=secret,
        )
        expired_token = social_mod.create_social_session_token(
            {"sub": "UP-ALICE1", "exp": now_ms - 1_000},
            secret=secret,
        )
        room_token = social_mod.create_social_session_token(
            {"sub": "*", "roomCode": "JAM-1122", "exp": now_ms + 60_000},
            secret=secret,
        )

        with patch.dict(os.environ, {"UPBEAT_SOCIAL_SECRET": secret}, clear=False):
            # Missing or bad/expired token -> 401
            self.assertEqual(self.client.get("/api/social?id=UP-ALICE1").status_code, 401)
            self.assertEqual(
                self.client.get(
                    "/api/social?id=UP-ALICE1", headers={"X-UpBeat-Session": "bad.token"}
                ).status_code,
                401,
            )
            self.assertEqual(
                self.client.get(
                    "/api/social?id=UP-ALICE1", headers={"X-UpBeat-Session": expired_token}
                ).status_code,
                401,
            )
            self.assertEqual(
                self.client.post("/api/jam/room/send", json={"roomCode": "JAM-1122", "packet": {}}).status_code,
                401,
            )

            # Subject mismatch -> 403 (Alice cannot poll Bob's inbox or spoof Bob as sender)
            self.assertEqual(
                self.client.get(
                    "/api/social?id=UP-BOB222", headers={"X-UpBeat-Session": alice_token}
                ).status_code,
                403,
            )
            self.assertEqual(
                self.client.post(
                    "/api/social",
                    headers={"X-UpBeat-Session": alice_token},
                    json={
                        "action": "push",
                        "toId": "UP-CHARL1",
                        "packet": {"msgId": "spoof", "from": {"friendCode": "UP-BOB222"}},
                    },
                ).status_code,
                403,
            )

            # Matching subject -> 200
            ok_push = self.client.post(
                "/api/social",
                headers={"X-UpBeat-Session": alice_token},
                json={
                    "action": "push",
                    "toId": "UP-ALICE1",
                    "packet": {"msgId": "ok1", "from": {"friendCode": "UP-ALICE1"}},
                },
            )
            self.assertEqual(ok_push.status_code, 200)
            ok_poll = self.client.get(
                "/api/social?id=UP-ALICE1&since=0",
                headers={"X-UpBeat-Session": alice_token},
            )
            self.assertEqual(ok_poll.status_code, 200)
            self.assertEqual(len(ok_poll.json()["inbox"]), 1)

            # Room token check: matches JAM-1122 (200), rejects JAM-9999 (403)
            self.assertEqual(
                self.client.post(
                    "/api/jam/room/send",
                    headers={"X-UpBeat-Session": room_token},
                    json={"roomCode": "JAM-9999", "packet": {"_packetId": "p1"}},
                ).status_code,
                403,
            )
            self.assertEqual(
                self.client.post(
                    "/api/jam/room/send",
                    headers={"X-UpBeat-Session": room_token},
                    json={"roomCode": "JAM-1122", "packet": {"_packetId": "p1"}},
                ).status_code,
                200,
            )

    def test_social_hmac_tokens_interoperate_across_python_and_edge_js(self):
        import shutil
        import subprocess

        node_bin = shutil.which("node")
        if not node_bin:
            self.skipTest("Node.js runtime not available")

        secret = "cross-runtime-secret-123"
        exp = int(time.time() * 1000) + 60_000
        py_token = social_mod.create_social_session_token({"sub": "UP-CROSS1", "exp": exp}, secret=secret)

        repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))
        js_script = (
            "import { createSocialSessionToken, verifySocialSessionToken } from './api/social.js';"
            "const pyClaims = await verifySocialSessionToken(process.argv[1], process.argv[2]);"
            "const jsTok = await createSocialSessionToken({ sub: 'UP-CROSS2', exp: Number(process.argv[3]) }, process.argv[2]);"
            "console.log(JSON.stringify({ pyClaims, jsTok }));"
        )
        proc = subprocess.run(
            [node_bin, "--input-type=module", "-e", js_script, py_token, secret, str(exp)],
            cwd=repo_root,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(proc.returncode, 0, msg=proc.stderr)
        out = json.loads(proc.stdout.strip())
        self.assertEqual(out["pyClaims"]["sub"], "UP-CROSS1")
        js_claims = social_mod.verify_social_session_token(out["jsTok"], secret=secret)
        self.assertIsNotNone(js_claims)
        self.assertEqual(js_claims["sub"], "UP-CROSS2")


if __name__ == "__main__":
    unittest.main()
