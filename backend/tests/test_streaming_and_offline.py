import os
import tempfile
import unittest
import warnings
from unittest.mock import MagicMock, patch
from fastapi.testclient import TestClient

import backend.main as main_mod
import backend.routers.offline as offline_mod
from backend.yt.innertube_client import _STREAM_CACHE


class _FakeUpstreamResponse:
    def __init__(self, status_code: int, chunks=None, headers=None):
        self.status_code = status_code
        self._chunks = chunks or []
        self.headers = headers or {}
        self.closed = False

    def iter_content(self, chunk_size=65536):
        for c in self._chunks:
            yield c

    def close(self):
        self.closed = True


class TestStreamingAndOffline(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.orig_downloads_dir = offline_mod.DOWNLOADS_DIR
        self.orig_meta_file = offline_mod.DOWNLOADS_META_FILE
        offline_mod.DOWNLOADS_DIR = self.tmpdir.name
        offline_mod.DOWNLOADS_META_FILE = os.path.join(self.tmpdir.name, "downloads.json")
        _STREAM_CACHE.clear()
        self.client = TestClient(main_mod.app)

    def tearDown(self):
        offline_mod.DOWNLOADS_DIR = self.orig_downloads_dir
        offline_mod.DOWNLOADS_META_FILE = self.orig_meta_file
        _STREAM_CACHE.clear()
        self.tmpdir.cleanup()

    def test_openapi_emits_zero_duplicate_operation_id_warnings(self):
        main_mod.app.openapi_schema = None
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            main_mod.app.openapi()
        dup_warnings = [w for w in caught if "Duplicate Operation ID" in str(w.message)]
        self.assertEqual(dup_warnings, [])

    def test_strict_video_id_blocks_path_traversal_and_invalid_ids(self):
        with self.assertRaises(Exception) as ctx:
            offline_mod._sanitize_video_id("..")
        self.assertEqual(ctx.exception.status_code, 400)

        bad_ids = ["%2e%2e", "..foo", "short", "waytoolong1234", "bad.id!1234", "abc$def_123"]
        for bad in bad_ids:
            with self.subTest(bad=bad):
                self.assertEqual(self.client.get(f"/api/audio/{bad}").status_code, 400)
                self.assertEqual(self.client.get(f"/api/audio?id={bad}").status_code, 400)
                self.assertEqual(self.client.get(f"/api/download/{bad}").status_code, 400)
                self.assertEqual(self.client.delete(f"/api/offline/tracks/{bad}").status_code, 400)
                self.assertEqual(self.client.get(f"/api/audio-info/{bad}").status_code, 400)
                self.assertEqual(self.client.get(f"/api/audio-info?id={bad}").status_code, 400)
        self.assertEqual(self.client.get("/api/audio?id=..").status_code, 400)

    def test_content_disposition_strips_crlf_and_control_chars(self):
        header = offline_mod._make_content_disposition("Track\r\nX-Injected: evil\x00Name.m4a")
        self.assertNotIn("\r", header)
        self.assertNotIn("\n", header)
        self.assertNotIn("\x00", header)
        self.assertNotIn("%0D", header)
        self.assertNotIn("%0A", header)
        self.assertIn('filename="TrackX-Injected evilName.m4a"', header)

    def test_parse_byte_range_validation_and_416_bounds(self):
        self.assertEqual(offline_mod._parse_byte_range(None, 1000), (0, 999, False))
        self.assertEqual(offline_mod._parse_byte_range("bytes=0-99", 1000), (0, 99, True))
        self.assertEqual(offline_mod._parse_byte_range("bytes=500-", 1000), (500, 999, True))
        self.assertEqual(offline_mod._parse_byte_range("bytes=-200", 1000), (800, 999, True))
        self.assertEqual(offline_mod._parse_byte_range("bytes=900-5000", 1000), (900, 999, True))

        for bad_hdr in ("items=0-10", "bytes=abc-def", "bytes=-0", "bytes=500-200", "bytes=1000-1005", "bytes=-"):
            with self.subTest(bad_hdr=bad_hdr):
                with self.assertRaises(ValueError):
                    offline_mod._parse_byte_range(bad_hdr, 1000)

    def test_local_cached_audio_200_vs_206_head_and_416(self):
        vid = "dQw4w9WgXcQ"
        payload = b"A" * 60000
        local_path = os.path.join(self.tmpdir.name, f"{vid}.m4a")
        with open(local_path, "wb") as f:
            f.write(payload)

        r_full = self.client.get(f"/api/audio/{vid}")
        self.assertEqual(r_full.status_code, 200)
        self.assertIsNone(r_full.headers.get("content-range"))
        self.assertEqual(r_full.headers.get("content-length"), str(len(payload)))
        self.assertEqual(len(r_full.content), len(payload))

        r_query = self.client.get(f"/api/audio?id={vid}")
        self.assertEqual(r_query.status_code, 200)
        self.assertEqual(len(r_query.content), len(payload))

        r_head = self.client.head(f"/api/audio/{vid}")
        self.assertEqual(r_head.status_code, 200)
        self.assertIsNone(r_head.headers.get("content-range"))
        self.assertEqual(r_head.headers.get("content-length"), str(len(payload)))
        self.assertEqual(r_head.content, b"")

        r_partial = self.client.get(f"/api/audio/{vid}", headers={"Range": "bytes=10-109"})
        self.assertEqual(r_partial.status_code, 206)
        self.assertEqual(r_partial.headers.get("content-range"), f"bytes 10-109/{len(payload)}")
        self.assertEqual(r_partial.headers.get("content-length"), "100")
        self.assertEqual(r_partial.content, b"A" * 100)

        r_416 = self.client.get(f"/api/audio/{vid}", headers={"Range": "bytes=99999-100010"})
        self.assertEqual(r_416.status_code, 416)
        self.assertEqual(r_416.headers.get("content-range"), f"bytes */{len(payload)}")

        r_bad_416 = self.client.get(f"/api/audio/{vid}", headers={"Range": "bytes=xyz-123"})
        self.assertEqual(r_bad_416.status_code, 416)

    def test_upstream_stream_single_lookup_200_vs_206_and_403_cache_invalidation(self):
        vid = "34Na4j8AVgA"
        stream_info = {
            "url": "https://redirector.googlevideo.com/videoplayback?expire=9999999999",
            "mime": "audio/mp4",
            "clen": 100,
            "ua": "IOS-UA",
            "duration": 230,
        }
        _STREAM_CACHE[vid] = dict(stream_info)

        calls = []

        def fake_get(url, headers=None, stream=True, timeout=15):
            calls.append((url, headers))
            if url.endswith("expired"):
                return _FakeUpstreamResponse(403)
            return _FakeUpstreamResponse(206, chunks=[b"Z" * 100], headers={"Content-Range": "bytes 0-99/100"})

        with patch.object(main_mod, "get_audio_stream_url", return_value=stream_info) as mock_lookup, patch.object(
            offline_mod._STREAM_HTTP_SESSION, "get", side_effect=fake_get
        ):
            r_no_range = self.client.get(f"/api/audio/{vid}")
            self.assertEqual(r_no_range.status_code, 200)
            self.assertIsNone(r_no_range.headers.get("content-range"))
            self.assertEqual(r_no_range.headers.get("x-track-duration"), "230")
            self.assertEqual(r_no_range.content, b"Z" * 100)
            # Only 1 lookup (previously called twice!)
            self.assertEqual(mock_lookup.call_count, 1)

        # Now test 403 invalidation & retry on chunk 0
        expired_info = dict(stream_info, url="https://redirector.googlevideo.com/expired")
        fresh_info = dict(stream_info, url="https://redirector.googlevideo.com/fresh")
        _STREAM_CACHE[vid] = dict(expired_info)

        with patch.object(
            main_mod, "get_audio_stream_url", side_effect=[expired_info, fresh_info]
        ), patch.object(offline_mod._STREAM_HTTP_SESSION, "get", side_effect=fake_get):
            r_retry = self.client.get(f"/api/audio/{vid}", headers={"Range": "bytes=0-99"})
            self.assertEqual(r_retry.status_code, 206)
            self.assertEqual(r_retry.content, b"Z" * 100)
            self.assertNotIn(vid, _STREAM_CACHE)

    def test_upstream_stream_refreshes_on_midstream_403_after_first_chunk(self):
        vid = "MpYy6wwqxoo"
        chunk_sz = offline_mod._STREAM_CHUNK_BYTES
        chunk_1 = b"A" * chunk_sz
        chunk_2 = b"B" * 250
        total_len = chunk_sz + len(chunk_2)

        initial_info = {
            "url": "https://redirector.googlevideo.com/chunked-throttled",
            "mime": "audio/mp4",
            "clen": total_len,
            "ua": "ANDROID-UA",
            "duration": 330,
        }
        refreshed_info = dict(initial_info, url="https://redirector.googlevideo.com/chunked-fresh")
        _STREAM_CACHE[vid] = dict(initial_info)

        def fake_get(url, headers=None, stream=True, timeout=15):
            rng = (headers or {}).get("Range", "")
            if rng == f"bytes=0-{chunk_sz - 1}":
                return _FakeUpstreamResponse(206, chunks=[chunk_1])
            if url.endswith("throttled"):
                return _FakeUpstreamResponse(403)
            return _FakeUpstreamResponse(206, chunks=[chunk_2])

        with patch.object(
            main_mod, "get_audio_stream_url", side_effect=[initial_info, refreshed_info]
        ) as mock_lookup, patch.object(
            offline_mod._STREAM_HTTP_SESSION, "get", side_effect=fake_get
        ):
            r = self.client.get(f"/api/audio/{vid}", headers={"Range": "bytes=0-"})
            self.assertEqual(r.status_code, 206)
            self.assertEqual(len(r.content), total_len)
            self.assertEqual(r.content, chunk_1 + chunk_2)
            self.assertEqual(mock_lookup.call_count, 2)

    def test_download_never_promotes_truncated_or_failed_partial_file(self):
        vid = "BddP6PYo2gs"
        chunk_1 = b"B" * offline_mod._STREAM_CHUNK_BYTES
        total_len = offline_mod._STREAM_CHUNK_BYTES + 500
        stream_info = {
            "url": "https://redirector.googlevideo.com/dl",
            "mime": "audio/mp4",
            "clen": total_len,
            "ua": "IOS-UA",
            "title": "Kesariya",
            "uploader": "Arijit Singh",
            "duration": 268,
        }

        # Chunk 1 succeeds with 206, chunk 2 fails with 403
        responses = [
            _FakeUpstreamResponse(206, chunks=[chunk_1]),
            _FakeUpstreamResponse(403),
        ]
        with patch.object(main_mod, "get_audio_stream_url", return_value=stream_info), patch.object(
            offline_mod._STREAM_HTTP_SESSION, "get", side_effect=responses
        ):
            r = self.client.get(f"/api/download/{vid}?title=Kesariya&artist=Arijit+Singh")
            self.assertEqual(r.status_code, 200)
            # Only chunk 1 was streamed before upstream broke
            self.assertEqual(len(r.content), len(chunk_1))

        # Critical assertion: truncated .part file MUST NOT be promoted or saved in downloads.json
        local_path = os.path.join(self.tmpdir.name, f"{vid}.m4a")
        self.assertFalse(os.path.exists(local_path))
        self.assertEqual(offline_mod._load_downloads_meta(), [])
        leftovers = [f for f in os.listdir(self.tmpdir.name) if ".part_" in f]
        self.assertEqual(leftovers, [])

    def test_download_complete_persists_meta_and_supports_list_and_delete(self):
        vid = "BddP6PYo2gs"
        body = b"C" * 60000
        stream_info = {
            "url": "https://redirector.googlevideo.com/dl-ok",
            "mime": "audio/mp4",
            "clen": len(body),
            "ua": "IOS-UA",
            "title": "Kesariya",
            "uploader": "Arijit Singh",
            "duration": 268,
        }
        with patch.object(main_mod, "get_audio_stream_url", return_value=stream_info), patch.object(
            offline_mod._STREAM_HTTP_SESSION,
            "get",
            return_value=_FakeUpstreamResponse(206, chunks=[body]),
        ):
            r = self.client.get(f"/api/download/{vid}?title=Kesariya&artist=Arijit+Singh")
            self.assertEqual(r.status_code, 200)
            self.assertEqual(len(r.content), len(body))

        local_path = os.path.join(self.tmpdir.name, f"{vid}.m4a")
        self.assertTrue(os.path.exists(local_path))
        listed = self.client.get("/api/offline/tracks").json()["tracks"]
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["video_id"], vid)

        del_res = self.client.delete(f"/api/offline/tracks/{vid}")
        self.assertEqual(del_res.status_code, 200)
        self.assertFalse(os.path.exists(local_path))
        self.assertEqual(self.client.get("/api/offline/tracks").json()["tracks"], [])


if __name__ == "__main__":
    unittest.main()
