"""Router parity tests verifying extracted backend.routers and offline fallthrough fixes."""

import os
import tempfile
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient

import backend.main as main_mod
import backend.routers.offline as offline_mod


class TestRoutersParity(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.orig_downloads_dir = offline_mod.DOWNLOADS_DIR
        self.orig_meta_file = offline_mod.DOWNLOADS_META_FILE
        offline_mod.DOWNLOADS_DIR = self.tmpdir.name
        offline_mod.DOWNLOADS_META_FILE = os.path.join(self.tmpdir.name, "downloads.json")
        main_mod._SOCIAL_MAILBOX.clear()
        main_mod._SOCIAL_PRESENCE.clear()
        main_mod._JAM_ROOMS.clear()
        self.client = TestClient(main_mod.app)

    def tearDown(self):
        offline_mod.DOWNLOADS_DIR = self.orig_downloads_dir
        offline_mod.DOWNLOADS_META_FILE = self.orig_meta_file
        self.tmpdir.cleanup()

    def test_all_expected_api_routes_registered(self):
        registered = set(main_mod.app.openapi().get("paths", {}).keys())
        expected = {
            "/api/status",
            "/api/safari/tabs",
            "/api/safari/open",
            "/api/safari/extract",
            "/api/safari/now-playing",
            "/api/safari/profile",
            "/api/safari/control",
            "/api/taste-dna",
            "/api/curate",
            "/api/search",
            "/api/direct-search",
            "/api/playlist-browse",
            "/api/resolve-batch",
            "/api/innertube",
            "/api/audio-info/{video_id}",
            "/api/lyrics",
            "/api/favorites",
            "/api/favorites/toggle",
            "/api/audio/{video_id}",
            "/api/download/{video_id}",
            "/api/offline/tracks",
            "/api/offline/tracks/{video_id}",
            "/api/open-downloads",
            "/api/jam/social/send",
            "/api/jam/social/poll",
            "/api/social",
            "/api/jam/room/send",
            "/api/jam/room/poll",
            "/api/profile",
            "/api/profile/pick-photo",
        }
        self.assertTrue(expected.issubset(registered))

    def test_music_router_mocked_endpoints(self):
        sample_track = {"title": "Night Changes", "artist": "One Direction", "video_id": "syFZfO_wfMQ", "duration_text": "3:46"}
        with patch.object(main_mod, "direct_search_youtube_music", return_value={"tracks": [sample_track]}):
            r1 = self.client.get("/api/direct-search?q=night+changes&mode=songs")
            self.assertEqual(r1.status_code, 200)
            self.assertEqual(r1.json()["tracks"][0]["video_id"], "syFZfO_wfMQ")

        with patch.object(main_mod, "browse_youtube_music_playlist", return_value=[sample_track]):
            r2 = self.client.get("/api/playlist-browse?browse_id=VLPL123&title=Mix")
            self.assertEqual(r2.status_code, 200)
            self.assertEqual(len(r2.json()["tracks"]), 1)

        with patch.object(main_mod, "resolve_tracks_batch", return_value=[sample_track]):
            r3 = self.client.post("/api/resolve-batch", json={"tracks": [sample_track]})
            self.assertEqual(r3.status_code, 200)
            self.assertEqual(len(r3.json()["tracks"]), 1)

    def test_social_legacy_send_and_poll_endpoints(self):
        r_send = self.client.post(
            "/api/jam/social/send",
            json={
                "targetFriendCode": "UP-AAA111",
                "packet": {"_packetId": "pkt1", "type": "FRIEND_REQ", "from": {"friendCode": "UP-BBB222", "name": "Peer"}},
            },
        )
        self.assertEqual(r_send.status_code, 200)
        self.assertTrue(r_send.json()["ok"])

        r_poll = self.client.post(
            "/api/jam/social/poll",
            json={"friendCode": "UP-AAA111", "friendCodes": ["UP-BBB222"], "since": 0},
        )
        self.assertEqual(r_poll.status_code, 200)
        data = r_poll.json()
        self.assertEqual(len(data["packets"]), 1)
        self.assertEqual(len(data["friends"]), 1)
        self.assertTrue(data["friends"][0]["online"])

    def test_undersized_cached_file_removed_without_unbound_error(self):
        vid = "dQw4w9WgXcQ"
        bad_file = os.path.join(self.tmpdir.name, f"{vid}.m4a")
        with open(bad_file, "wb") as f:
            f.write(b"too-small")

        with patch.object(main_mod, "get_audio_stream_url", return_value=None):
            res_audio = self.client.get(f"/api/audio/{vid}")
            self.assertEqual(res_audio.status_code, 404)
            self.assertFalse(os.path.exists(bad_file))

            with open(bad_file, "wb") as f:
                f.write(b"still-too-small")
            res_dl = self.client.get(f"/api/download/{vid}")
            self.assertEqual(res_dl.status_code, 404)
            self.assertFalse(os.path.exists(bad_file))


if __name__ == "__main__":
    unittest.main()
