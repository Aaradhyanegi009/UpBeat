import json
import os
import unittest
from fastapi.testclient import TestClient

import backend.main as main_mod
import backend.safari_bridge as safari_mod
from backend.youtube_search import is_valid_music_track

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../.."))


class TestFilterParityAndConfig(unittest.TestCase):
    def test_backend_filter_json_matches_shared(self):
        with open(os.path.join(ROOT_DIR, "shared", "music_filters.json"), "r", encoding="utf-8") as f:
            shared = json.load(f)
        with open(os.path.join(ROOT_DIR, "backend", "music_filters.json"), "r", encoding="utf-8") as f:
            backend_copy = json.load(f)
        self.assertEqual(backend_copy, shared)

    def test_python_is_valid_music_track_matches_shared_corpus(self):
        with open(os.path.join(ROOT_DIR, "shared", "filter_test_corpus.json"), "r", encoding="utf-8") as f:
            corpus = json.load(f)
        for item in corpus:
            with self.subTest(label=item["label"]):
                self.assertEqual(is_valid_music_track(item["track"]), item["expected"])

    def test_safari_extractor_js_injects_synced_rules(self):
        js = safari_mod._build_safari_extraction_js()
        self.assertNotIn("__FILTER_RULES__", js)
        self.assertIn("aakash", js)
        self.assertIn("sampoorna", js)
        self.assertIn("nursery", js)

    def test_fastapi_version_synced_and_cors_hardened(self):
        with open(os.path.join(ROOT_DIR, "package.json"), "r", encoding="utf-8") as f:
            pkg_ver = json.load(f)["version"]
        self.assertEqual(main_mod.app.version, pkg_ver)

        client = TestClient(main_mod.app)
        res_untrusted = client.get("/api/status", headers={"Origin": "https://example.com"})
        self.assertEqual(res_untrusted.status_code, 200)
        self.assertIsNone(res_untrusted.headers.get("access-control-allow-origin"))
        self.assertNotEqual(res_untrusted.headers.get("access-control-allow-credentials"), "true")

        for trusted_origin in (
            "http://localhost:5173",
            "http://127.0.0.1:48173",
            "http://192.168.1.42:5173",
            "capacitor://localhost",
        ):
            with self.subTest(origin=trusted_origin):
                res_trusted = client.get("/api/status", headers={"Origin": trusted_origin})
                self.assertEqual(res_trusted.status_code, 200)
                self.assertEqual(res_trusted.headers.get("access-control-allow-origin"), trusted_origin)
                exposed = res_trusted.headers.get("access-control-expose-headers", "")
                for h in ("Content-Range", "Content-Length", "Accept-Ranges", "X-Track-Duration", "Content-Disposition"):
                    self.assertIn(h, exposed)


if __name__ == "__main__":
    unittest.main()
