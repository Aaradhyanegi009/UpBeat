import os
import sys
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from fastapi import FastAPI
from fastapi.testclient import TestClient

import backend.main as main_mod
import backend.safari_bridge as safari_mod
from backend.routers import require_local_origin


class TestSecurityAndSafari(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main_mod.app)

    def test_validate_youtube_url_allows_only_https_youtube_hosts(self):
        valid_urls = [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://music.youtube.com/playlist?list=LM",
            "https://youtube.com/feed/history",
            "https://youtu.be/dQw4w9WgXcQ",
        ]
        for url in valid_urls:
            with self.subTest(url=url):
                self.assertEqual(safari_mod.validate_youtube_url(url), url)

        invalid_urls = [
            "",
            "http://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "javascript:alert(1)",
            "file:///etc/passwd",
            'https://youtube.com/watch?v=abc" & do shell script "id',
            "https://youtube.com/watch?v=abc\ndo shell script",
            "https://evil.com/youtube.com",
            "https://user@youtube.com/watch?v=123",
            "https://youtube.com:8443/watch?v=123",
            "https://youtube.com/watch?v=123\\evil",
        ]
        for url in invalid_urls:
            with self.subTest(url=url):
                with self.assertRaises(ValueError):
                    safari_mod.validate_youtube_url(url)

    def test_escape_applescript_string_and_open_safari_url_guards(self):
        self.assertEqual(safari_mod._escape_applescript_string('a"b\\c'), 'a\\"b\\\\c')
        with self.assertRaises(ValueError):
            safari_mod._escape_applescript_string("line1\nline2")
        with self.assertRaises(ValueError):
            safari_mod._escape_applescript_string("nul\x00byte")

        with self.assertRaises(ValueError):
            safari_mod.open_safari_url("javascript:alert(1)")

        with patch.object(safari_mod, "is_macos_safari_supported", return_value=True), patch.object(
            safari_mod, "run_applescript", return_value="ok"
        ) as mock_run:
            res = safari_mod.open_safari_url("https://music.youtube.com/watch?v=dQw4w9WgXcQ")
            self.assertEqual(res["status"], "ok")
            mock_run.assert_called_once()
            self.assertIn("https://music.youtube.com/watch?v=dQw4w9WgXcQ", mock_run.call_args[0][0])

    def test_safari_open_and_control_route_validation_and_origin_guards(self):
        bad_open = self.client.post(
            "/api/safari/open",
            json={"destination": "custom", "custom_url": 'https://evil.com/" & do shell script "whoami'},
        )
        self.assertEqual(bad_open.status_code, 400)

        missing_custom = self.client.post(
            "/api/safari/open",
            json={"destination": "custom"},
        )
        self.assertEqual(missing_custom.status_code, 400)

        evil_origin = self.client.post(
            "/api/safari/open",
            headers={"Origin": "https://evil.example"},
            json={"destination": "yt_liked"},
        )
        self.assertEqual(evil_origin.status_code, 403)

        with patch.object(main_mod, "open_safari_url", return_value={"status": "ok"}) as mock_open:
            ok_open = self.client.post(
                "/api/safari/open",
                headers={"Origin": "http://localhost:5173"},
                json={"destination": "custom", "custom_url": "https://music.youtube.com/watch?v=dQw4w9WgXcQ"},
            )
            self.assertEqual(ok_open.status_code, 200)
            mock_open.assert_called_once_with("https://music.youtube.com/watch?v=dQw4w9WgXcQ")

        bad_ctrl = self.client.post(
            "/api/safari/control",
            json={"action": 'play_pause"; alert(1); //'},
        )
        self.assertEqual(bad_ctrl.status_code, 422)

        bad_idx = self.client.post(
            "/api/safari/control",
            json={"action": "play_pause", "window_idx": 0},
        )
        self.assertEqual(bad_idx.status_code, 422)

        with patch.object(main_mod, "control_safari", return_value={"status": "success", "result": "toggled"}):
            ok_ctrl = self.client.post(
                "/api/safari/control",
                headers={"Origin": "http://127.0.0.1:8000"},
                json={"action": "play_pause", "window_idx": 1, "tab_idx": 1},
            )
            self.assertEqual(ok_ctrl.status_code, 200)

    def test_non_macos_guards_block_osascript_and_open(self):
        with patch.object(safari_mod.sys, "platform", "linux"):
            self.assertFalse(safari_mod.is_macos_safari_supported())
            self.assertEqual(safari_mod.list_safari_tabs(), [])
            self.assertIsNone(safari_mod.get_safari_now_playing())
            self.assertEqual(safari_mod.get_safari_youtube_profile(), {})
            ext = safari_mod.extract_all_safari_yt_tracks()
            self.assertIn("macOS", ext.get("error", ""))
            with self.assertRaises(RuntimeError):
                safari_mod.run_applescript('tell application "Safari" to activate')

        with patch("backend.routers.offline.sys.platform", "linux"), patch(
            "backend.routers.offline.subprocess.Popen"
        ) as mock_popen:
            r_dl = self.client.post("/api/open-downloads")
            self.assertEqual(r_dl.status_code, 200)
            self.assertEqual(r_dl.json()["status"], "unsupported")
            mock_popen.assert_not_called()

        with patch("backend.routers.social.sys.platform", "linux"), patch(
            "backend.routers.social.subprocess.run"
        ) as mock_run:
            r_pick = self.client.post("/api/profile/pick-photo")
            self.assertEqual(r_pick.status_code, 200)
            self.assertFalse(r_pick.json()["ok"])
            mock_run.assert_not_called()

    def test_sensitive_local_routes_reject_untrusted_origins_and_non_loopback(self):
        for path in ("/api/open-downloads", "/api/profile/pick-photo"):
            r_origin = self.client.post(path, headers={"Origin": "https://attacker.site"})
            self.assertEqual(r_origin.status_code, 403)
            r_null = self.client.post(path, headers={"Origin": "null"})
            self.assertEqual(r_null.status_code, 403)
            r_cross = self.client.post(path, headers={"Sec-Fetch-Site": "cross-site"})
            self.assertEqual(r_cross.status_code, 403)

        fake_req = SimpleNamespace(
            client=SimpleNamespace(host="192.168.1.55"),
            headers={},
        )
        with self.assertRaises(Exception) as ctx:
            require_local_origin(fake_req, require_loopback=True)
        self.assertEqual(ctx.exception.status_code, 403)

    def test_innertube_proxy_allowlist_and_async_forwarding(self):
        for bad_ep in ("", "../player", "account/account_menu", "search?foo=bar", "browse/extra"):
            with self.subTest(endpoint=bad_ep):
                r = self.client.post("/api/innertube", json={"endpoint": bad_ep, "body": {}, "service": "music"})
                self.assertEqual(r.status_code, 400)

        r_bad_svc = self.client.post("/api/innertube", json={"endpoint": "search", "body": {}, "service": "evil"})
        self.assertEqual(r_bad_svc.status_code, 400)

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.content = b'{"ok":true}'
        with patch("backend.routers.music.ext_requests.post", return_value=mock_resp) as mock_post:
            r_ok = self.client.post(
                "/api/innertube",
                json={"endpoint": "search", "body": {"query": "lofi"}, "service": "music"},
            )
            self.assertEqual(r_ok.status_code, 200)
            self.assertEqual(r_ok.json(), {"ok": True})
            self.assertEqual(
                mock_post.call_args[0][0],
                "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
            )

    def test_spa_fallback_serves_index_and_keeps_api_404_json(self):
        with tempfile.TemporaryDirectory() as dist_dir:
            assets_dir = os.path.join(dist_dir, "assets")
            os.makedirs(assets_dir, exist_ok=True)
            with open(os.path.join(dist_dir, "index.html"), "w", encoding="utf-8") as f:
                f.write("<!doctype html><html><body>SPA</body></html>")
            with open(os.path.join(assets_dir, "app.js"), "w", encoding="utf-8") as f:
                f.write("console.log('upbeat');")

            spa_app = FastAPI()
            spa_app.include_router(main_mod.safari_router)

            @spa_app.get("/{full_path:path}", include_in_schema=False)
            def _get(full_path: str):
                return main_mod.serve_spa_path(dist_dir, full_path)

            c = TestClient(spa_app)
            self.assertEqual(c.get("/").status_code, 200)
            self.assertIn("SPA", c.get("/library").text)
            self.assertIn("SPA", c.get("/collection/abc").text)
            self.assertIn("console.log", c.get("/assets/app.js").text)
            self.assertEqual(c.get("/assets/missing.js").status_code, 404)

            api_404 = c.get("/api/nonexistent-endpoint")
            self.assertEqual(api_404.status_code, 404)
            self.assertEqual(api_404.json(), {"detail": "Not Found"})

            traversal = c.get("/../../etc/passwd")
            self.assertEqual(traversal.status_code, 200)
            self.assertIn("SPA", traversal.text)


if __name__ == "__main__":
    unittest.main()
