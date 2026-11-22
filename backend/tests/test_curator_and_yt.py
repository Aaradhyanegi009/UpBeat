import os
import time
import unittest
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import backend.curator as curator
import backend.main as main_mod
from backend.yt import innertube_client as ic
from backend.yt import stream_resolver as sr


class TestCuratorAndYt(unittest.TestCase):
    def setUp(self):
        curator.clear_model_cooldowns()
        ic._STREAM_CACHE.clear()
        ic._SEARCH_CACHE.clear()
        ic._SEARCH_CACHE_TS.clear()
        main_mod._SOCIAL_MAILBOX.clear()
        main_mod._SOCIAL_PRESENCE.clear()
        main_mod._JAM_ROOMS.clear()

    def tearDown(self):
        curator.clear_model_cooldowns()
        ic._STREAM_CACHE.clear()
        ic._SEARCH_CACHE.clear()
        ic._SEARCH_CACHE_TS.clear()

    def test_gemini_rest_uses_x_goog_api_key_header_not_query_param(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": '{"tracks": []}'}]}}]
        }
        with patch.dict(os.environ, {"GEMINI_API_KEY": "secret-test-key"}), patch.object(
            curator._HTTP, "post", return_value=mock_resp
        ) as mock_post:
            res = curator._call_gemini_rest("gemini-2.5-flash", "prompt")
            self.assertEqual(res["tracks"], [])
            called_url = mock_post.call_args[0][0]
            called_headers = mock_post.call_args[1]["headers"]
            self.assertNotIn("?key=", called_url)
            self.assertNotIn("secret-test-key", called_url)
            self.assertEqual(called_headers.get("x-goog-api-key"), "secret-test-key")

    def test_missing_gemini_key_fails_fast_without_http_requests(self):
        with patch.dict(os.environ, {"GEMINI_API_KEY": "", "GROQ_API_KEY": "", "OPENROUTER_API_KEY": ""}), patch.object(
            curator, "GEMINI_API_KEY", ""
        ), patch.object(curator, "GROQ_API_KEY", ""), patch.object(
            curator, "OPENROUTER_API_KEY", ""
        ), patch.object(curator._HTTP, "post") as mock_post:
            with self.assertRaises(RuntimeError) as ctx:
                curator.generate_fast_with_fallback("test prompt")
            self.assertIn("GEMINI_API_KEY", str(ctx.exception))
            mock_post.assert_not_called()

    def test_429_cooldown_skips_exhausted_model_for_60_seconds(self):
        calls = []

        def fake_rest(model_id, prompt, timeout=14.0):
            calls.append(model_id)
            if model_id == "gemini-4-argon":
                raise RuntimeError("HTTP 429")
            return {"playlist_title": "Healthy Mix", "tracks": []}

        with patch.object(curator, "_call_gemini_rest", side_effect=fake_rest):
            self.assertEqual(curator.MODEL_429_COOLDOWN_SEC, 60.0)
            r1 = curator.generate_fast_with_fallback("p1", preferred_model="gemini-4-argon")
            self.assertEqual(r1["used_model"], "gemini-flash-lite-latest")
            self.assertEqual(calls, ["gemini-4-argon", "gemini-flash-lite-latest"])

            # Second call within 60s should skip gemini-4-argon AND its alias gemini-2.5-flash-lite
            calls.clear()
            r2 = curator.generate_fast_with_fallback("p2", preferred_model="gemini-4-argon")
            self.assertEqual(r2["used_model"], "gemini-flash-lite-latest")
            self.assertEqual(calls, ["gemini-flash-lite-latest"])

            calls.clear()
            r3 = curator.generate_fast_with_fallback("p3", preferred_model="gemini-2.5-flash-lite")
            self.assertEqual(r3["used_model"], "gemini-flash-lite-latest")
            self.assertEqual(calls, ["gemini-flash-lite-latest"])

    def test_verified_gemini_aliases_and_no_speculative_fallback_ids(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "candidates": [{"content": {"parts": [{"text": '{"tracks": []}'}]}}]
        }
        with patch.dict(os.environ, {"GEMINI_API_KEY": "k-test"}), patch.object(
            curator._HTTP, "post", return_value=mock_resp
        ) as mock_post:
            curator._call_gemini_rest("gemini-4-argon", "prompt")
            called_url = mock_post.call_args[0][0]
            self.assertIn("/models/gemini-2.5-flash-lite:generateContent", called_url)

        seen_models = []

        def fail_all(model_id, prompt, timeout=14.0):
            seen_models.append(model_id)
            raise RuntimeError("HTTP 404")

        with patch.dict(os.environ, {"GROQ_API_KEY": "", "OPENROUTER_API_KEY": ""}), patch.object(
            curator, "GROQ_API_KEY", ""
        ), patch.object(curator, "OPENROUTER_API_KEY", ""), patch.object(
            curator, "_call_gemini_rest", side_effect=fail_all
        ):
            with self.assertRaises(RuntimeError):
                curator.generate_fast_with_fallback("prompt")

        dead_ids = {
            "gemini-3.1-flash-lite",
            "gemini-3.5-flash-lite",
            "gemini-3-flash-preview",
            "gemma-4-26b-a4b-it",
            "gemini-3.8-flash",
        }
        self.assertTrue(dead_ids.isdisjoint(set(seen_models)))
        self.assertEqual(
            seen_models,
            ["gemini-4-argon", "gemini-flash-lite-latest", "gemini-2.5-flash", "gemini-2.0-flash"],
        )

    def test_clean_json_response_handles_prose_and_markdown(self):
        prose = 'Here is your playlist:\n```json\n{"playlist_title": "Night", "tracks": []}\n```\nEnjoy!'
        self.assertEqual(curator.clean_json_response(prose)["playlist_title"], "Night")

        bare_prose = 'Sure! {"tracks": [{"title": "Starboy"}]} Hope you like it.'
        self.assertEqual(curator.clean_json_response(bare_prose)["tracks"][0]["title"], "Starboy")

    def test_is_specific_entity_query_avoids_substring_and_mood_misfires(self):
        self.assertFalse(curator._is_specific_entity_query("floating ambient beats"))  # contains 'aot'
        self.assertFalse(curator._is_specific_entity_query("sunnier morning vibes"))   # contains 'nier'
        self.assertFalse(curator._is_specific_entity_query("chill late night"))
        self.assertFalse(curator._is_specific_entity_query("best study songs"))

        self.assertTrue(curator._is_specific_entity_query("attack on titan"))
        self.assertTrue(curator._is_specific_entity_query("aot ost"))
        self.assertTrue(curator._is_specific_entity_query("monogatari bests"))
        self.assertTrue(curator._is_specific_entity_query("daft punk"))

    def test_curate_playlist_hydrates_video_id_and_duration_from_yt_catalog(self):
        catalog = [
            {
                "title": "Renai Circulation",
                "artist": "Kana Hanazawa",
                "video_id": "uKxyi7m0001",
                "duration_text": "4:12",
            }
        ]
        llm_output = {
            "playlist_title": "Monogatari Mix",
            "tracks": [
                {
                    "title": "Renai Circulation",
                    "artist": "Kana Hanazawa",
                    "match_tier": "Direct Match",
                    "reason": "Bouncy acoustic guitars and sweet whispered vocal hook.",
                }
            ],
        }
        with patch.object(curator, "search_youtube_music_catalog", return_value=catalog), patch.object(
            curator, "generate_fast_with_fallback", return_value=llm_output
        ):
            out = curator.curate_playlist([], mood_prompt="monogatari", count=5)
            self.assertEqual(out["tracks"][0]["video_id"], "uKxyi7m0001")
            self.assertEqual(out["tracks"][0]["duration_text"], "4:12")

    def test_stream_resolver_prefers_fast_innertube_locally_and_respects_expire(self):
        future_exp = int(time.time()) + 120
        fast_entry = {
            "url": f"https://redirector.googlevideo.com/videoplayback?expire={future_exp}",
            "mime": "audio/mp4",
            "clen": 123456,
            "ua": "IOS-UA",
            "duration": 200,
            "ts": time.time(),
        }
        with patch.dict(os.environ, {}, clear=False), patch.object(
            sr, "_fast_innertube_audio", return_value=dict(fast_entry)
        ) as mock_fast, patch.object(sr, "_get_ydl") as mock_ydl:
            os.environ.pop("VERCEL", None)
            got = sr.get_audio_stream_url("dQw4w9WgXcQ")
            self.assertIsNotNone(got)
            self.assertEqual(got["url"], fast_entry["url"])
            mock_fast.assert_called_once()
            mock_ydl.assert_not_called()

        # Verify expired URLs are not served from cache
        past_exp = int(time.time()) - 10
        ic._stream_cache_set(
            "expired1234",
            {"url": f"https://redirector.googlevideo.com/videoplayback?expire={past_exp}", "ts": time.time()},
        )
        self.assertIsNone(ic._stream_cache_get("expired1234"))

    def test_search_youtube_single_allows_long_mix_when_mix_query(self):
        fake_yt_resp = MagicMock()
        fake_yt_resp.status_code = 200
        fake_yt_resp.json.return_value = {
            "contents": {
                "videoRenderer": {
                    "videoId": "mix12345678",
                    "title": {"simpleText": "1 Hour Ambient Space Mix"},
                    "ownerText": {"simpleText": "Ambient Channel"},
                    "lengthText": {"simpleText": "1:02:15"},
                }
            }
        }
        with patch.object(ic._SESSION, "post", return_value=fake_yt_resp), patch.object(
            ic, "_fast_innertube_audio", return_value={"url": "https://x", "duration": 3735}
        ):
            res = ic.search_youtube_single("1 hour ambient mix")
            self.assertIsNotNone(res)
            self.assertEqual(res["video_id"], "mix12345678")
            self.assertEqual(res["duration_text"], "1:02:15")

    def test_social_normalization_and_since_cursor_parity(self):
        client = TestClient(main_mod.app)
        p1 = client.post(
            "/api/social",
            json={
                "action": "push",
                "toId": "abc123",
                "packet": {"msgId": "m1", "type": "PING", "from": {"friendCode": "xyz789", "name": "A"}},
            },
        ).json()
        self.assertTrue(p1["ok"])

        poll1 = client.get("/api/social?id=ABC123&friends=UP-XYZ789&since=0").json()
        self.assertEqual(len(poll1["inbox"]), 1)
        self.assertEqual(poll1["friends"][0]["friendCode"], "UP-XYZ789")

        # Subsequent poll with same since=0 retains packet; with since=poll1.serverTs returns empty
        self.assertEqual(len(client.get("/api/social?id=UP-ABC123&since=0").json()["inbox"]), 1)
        self.assertEqual(
            len(client.get(f"/api/social?id=UP-ABC123&since={poll1['serverTs']}").json()["inbox"]),
            0,
        )

        # New push in the same millisecond is still visible after poll1.serverTs
        p2 = client.post(
            "/api/social",
            json={"action": "push", "toId": "UP-ABC123", "packet": {"msgId": "m2", "type": "PONG"}},
        ).json()
        self.assertGreater(p2["serverTs"], poll1["serverTs"])
        poll2 = client.get(f"/api/social?id=UP-ABC123&since={poll1['serverTs']}").json()
        self.assertEqual([m["msgId"] for m in poll2["inbox"]], ["m2"])


if __name__ == "__main__":
    unittest.main()
