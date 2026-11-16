import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

import backend.main as main_mod
import backend.favorites_store as fav_mod


class TestApiContracts(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.orig_favs_file = fav_mod.FAVS_FILE
        self.orig_data_dir = fav_mod.DATA_DIR
        self.orig_profile_file = main_mod.PROFILE_FILE

        fav_mod.DATA_DIR = self.tmpdir.name
        fav_mod.FAVS_FILE = os.path.join(self.tmpdir.name, "favorites.json")
        main_mod.PROFILE_FILE = os.path.join(self.tmpdir.name, "user_profile.json")

        main_mod._SOCIAL_MAILBOX.clear()
        main_mod._SOCIAL_PRESENCE.clear()
        main_mod._JAM_ROOMS.clear()

        self.client = TestClient(main_mod.app)

    def tearDown(self):
        fav_mod.FAVS_FILE = self.orig_favs_file
        fav_mod.DATA_DIR = self.orig_data_dir
        main_mod.PROFILE_FILE = self.orig_profile_file
        self.tmpdir.cleanup()

    def test_status_contract(self):
        res = self.client.get("/api/status")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertEqual(body["status"], "online")
        self.assertEqual(body["app"], "UpBeat")
        self.assertTrue(isinstance(body["models"], list) and len(body["models"]) >= 1)

    def test_favorites_toggle_cycle(self):
        track = {"title": "Starboy", "artist": "The Weeknd", "video_id": "34Na4j8AVgA", "duration_text": "3:50"}
        r0 = self.client.get("/api/favorites")
        self.assertEqual(r0.status_code, 200)
        self.assertEqual(r0.json(), {"favorites": []})

        r1 = self.client.post("/api/favorites/toggle", json={"track": track})
        self.assertEqual(r1.status_code, 200)
        self.assertTrue(r1.json()["is_favorite"])
        self.assertEqual(len(r1.json()["favorites"]), 1)

        r2 = self.client.post("/api/favorites/toggle", json={"track": track})
        self.assertEqual(r2.status_code, 200)
        self.assertFalse(r2.json()["is_favorite"])
        self.assertEqual(r2.json()["favorites"], [])

    def test_social_and_jam_room_relay_contracts(self):
        send_res = self.client.post(
            "/api/social",
            json={
                "action": "push",
                "toId": "ABC123",
                "packet": {"msgId": "m1", "type": "FRIEND_REQ", "from": {"friendCode": "UP-XYZ789", "name": "Sender"}},
            },
        )
        self.assertEqual(send_res.status_code, 200)
        self.assertTrue(send_res.json()["ok"])

        poll_res = self.client.get("/api/social?id=UP-ABC123&friends=UP-XYZ789&since=0")
        self.assertEqual(poll_res.status_code, 200)
        poll_data = poll_res.json()
        self.assertEqual(len(poll_data["inbox"]), 1)
        self.assertEqual(poll_data["inbox"][0]["msgId"], "m1")
        self.assertEqual(len(poll_data["friends"]), 1)
        self.assertTrue(poll_data["friends"][0]["online"])

        room_send = self.client.post(
            "/api/jam/room/send",
            json={"roomCode": "JAM-9988", "packet": {"_packetId": "p1", "type": "PLAY", "isPlaying": True}},
        )
        self.assertEqual(room_send.status_code, 200)
        self.assertTrue(room_send.json()["ok"])

        room_poll = self.client.get("/api/jam/room/poll?roomCode=JAM-9988&since=0")
        self.assertEqual(room_poll.status_code, 200)
        self.assertEqual(len(room_poll.json()["packets"]), 1)
        self.assertEqual(room_poll.json()["packets"][0]["_packetId"], "p1")

    def test_profile_roundtrip(self):
        res_empty = self.client.get("/api/profile")
        self.assertEqual(res_empty.status_code, 200)
        self.assertEqual(res_empty.json(), {})

        save_res = self.client.post("/api/profile", json={"name": "Tester", "friendCode": "UP-111222"})
        self.assertEqual(save_res.status_code, 200)
        self.assertTrue(save_res.json()["ok"])

        get_res = self.client.get("/api/profile")
        self.assertEqual(get_res.json()["name"], "Tester")

    def test_search_and_curate_with_mocks(self):
        with patch.object(main_mod, "search_youtube_single", return_value=None):
            res_404 = self.client.get("/api/search?q=nonexistent")
            self.assertEqual(res_404.status_code, 404)

        mock_track = {"title": "Kesariya", "artist": "Arijit Singh", "video_id": "BddP6PYo2gs", "duration_text": "4:28"}
        with patch.object(main_mod, "search_youtube_single", return_value=mock_track):
            res_ok = self.client.get("/api/search?q=kesariya")
            self.assertEqual(res_ok.status_code, 200)
            self.assertEqual(res_ok.json()["video_id"], "BddP6PYo2gs")

        with (
            patch.object(main_mod, "curate_playlist", return_value={"title": "Mix", "tracks": [mock_track]}),
            patch.object(main_mod, "resolve_tracks_batch", return_value=[mock_track]),
        ):
            curate_res = self.client.post(
                "/api/curate",
                json={"seed_tracks": [mock_track], "mood_prompt": "chill evening", "energy_level": 60, "count": 5},
            )
            self.assertEqual(curate_res.status_code, 200)
            self.assertEqual(len(curate_res.json()["tracks"]), 1)

    def test_curator_default_model_and_timeout_fallback(self):
        import inspect
        from backend import curator

        self.assertEqual(inspect.signature(curator.curate_playlist).parameters["model_name"].default, "gemini-4-argon")
        self.assertEqual(inspect.signature(curator.analyze_taste_dna).parameters["model_name"].default, "gemini-4-argon")

        calls = []

        def fake_rest(model_id, prompt, timeout=14.0):
            calls.append((model_id, timeout))
            if model_id == "gemini-3.8-flash":
                raise RuntimeError("Request timed out")
            return {"playlist_title": "Monogatari Mix", "tracks": []}

        with patch.object(curator, "_call_gemini_rest", side_effect=fake_rest):
            res = curator.generate_fast_with_fallback("prompt", preferred_model="gemini-3.8-flash")
            self.assertEqual(res["used_model"], "gemini-4-argon")
            self.assertTrue(res["is_fallback"])
            self.assertEqual(calls[0][0], "gemini-3.8-flash")


if __name__ == "__main__":
    unittest.main()
