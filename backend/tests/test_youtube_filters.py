import unittest
from backend.youtube_search import (
    is_strict_music_track,
    is_valid_music_track,
    format_seconds,
    _duration_to_seconds,
)
from backend.yt.innertube_client import (
    canonical_song_title,
    deduplicate_search_songs,
    is_unrequested_variant,
)


class TestYoutubeFilters(unittest.TestCase):
    def test_alias_parity(self):
        self.assertIs(is_valid_music_track, is_strict_music_track)

    def test_format_seconds(self):
        self.assertEqual(format_seconds(0), "")
        self.assertEqual(format_seconds(-10), "")
        self.assertEqual(format_seconds(185), "3:05")
        self.assertEqual(format_seconds(3665), "1:01:05")

    def test_duration_to_seconds(self):
        self.assertEqual(_duration_to_seconds("3:05"), 185)
        self.assertEqual(_duration_to_seconds("1:01:05"), 3665)
        self.assertEqual(_duration_to_seconds("bad"), 0)

    def test_accepts_valid_music_tracks(self):
        self.assertTrue(
            is_valid_music_track(
                {"title": "Shinunoga E-Wa", "artist": "Fujii Kaze", "video_id": "dawrQnvwMTY", "duration_text": "3:05"}
            )
        )
        self.assertTrue(
            is_valid_music_track(
                {"title": "Intro Track", "artist": "Artist", "video_id": "abcdefghijk", "duration_sec": 75}
            )
        )
        self.assertTrue(
            is_valid_music_track(
                {"title": "Long Track", "artist": "Artist", "video_id": "abcdefghij1", "duration_sec": 420}
            )
        )

    def test_rejects_comedy_devotional_kids_gaming_lectures(self):
        bad_tracks = [
            {"title": "Stand Up Comedy", "artist": "Aakash Gupta", "video_id": "dQw4w9WgXcQ", "duration_sec": 240},
            {"title": "Crowd Work Clip", "artist": "Zakir Khan", "video_id": "dQw4w9WgXcQ", "duration_sec": 240},
            {"title": "Sampoorna Ganesh Aarti", "artist": "Rahul Vaidya", "video_id": "dQw4w9WgXcQ", "duration_sec": 280},
            {"title": "Dawn of Serenity Krishna Bhajan", "artist": "Channel", "video_id": "dQw4w9WgXcQ", "duration_sec": 210},
            {"title": "Kids Music Playlist", "artist": "Fun Family", "video_id": "dQw4w9WgXcQ", "duration_sec": 190},
            {"title": "Laplace Transform Lecture", "artist": "NPTEL", "video_id": "dQw4w9WgXcQ", "duration_sec": 300},
            {"title": "Minecraft Gameplay", "artist": "Dream", "video_id": "dQw4w9WgXcQ", "duration_sec": 200},
        ]
        for track in bad_tracks:
            with self.subTest(title=track["title"]):
                self.assertFalse(is_valid_music_track(track))

    def test_rejects_invalid_metadata_and_out_of_bounds_duration(self):
        self.assertFalse(is_valid_music_track({}))
        self.assertFalse(is_valid_music_track({"title": "Song", "artist": "1.2M views", "duration_sec": 200}))
        self.assertFalse(is_valid_music_track({"title": "Song", "artist": "Artist", "video_id": "short"}))
        self.assertFalse(is_valid_music_track({"title": "Short Clip", "artist": "Artist", "duration_sec": 74}))
        self.assertFalse(is_valid_music_track({"title": "Podcast Ep", "artist": "Artist", "duration_sec": 421}))

    def test_unrequested_variants_and_canonical_title(self):
        self.assertEqual(canonical_song_title("Sapphire (Official Video) [HD]"), "sapphire")
        slowed = {"title": "Sapphire (Slowed + Reverb)", "artist": "AudioLab", "video_id": "slw12345678", "duration_sec": 210}
        self.assertTrue(is_unrequested_variant(slowed, "Sapphire"))
        self.assertFalse(is_unrequested_variant(slowed, "Sapphire slowed reverb"))

    def test_deduplicate_search_songs_ranks_exact_first_and_collapses_dups(self):
        items = [
            {"title": "Sapphire (Slowed + Reverb)", "artist": "Remix", "video_id": "bad00000001", "duration_sec": 210},
            {"title": "Sapphire (Lyric Video)", "artist": "Ed Sheeran", "video_id": "dup00000002", "duration_sec": 196, "play_count_num": 1_000_000},
            {"title": "Sapphire", "artist": "Ed Sheeran", "video_id": "main0000001", "duration_sec": 195, "play_count_num": 40_000_000, "vibe": "YT Music"},
        ]
        deduped = deduplicate_search_songs(items, "Sapphire", {"ed sheeran"})
        self.assertEqual(len(deduped), 1)
        self.assertEqual(deduped[0]["video_id"], "main0000001")
        self.assertEqual(deduped[0]["fallback_ids"], ["dup00000002"])


if __name__ == "__main__":
    unittest.main()
