import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reel_import_core import callback_signature, canonical_instagram_url, normalize_analysis, normalize_candidates, require_one_media_input


class ReelImportCoreTests(unittest.TestCase):
    def test_worker_requires_exactly_one_media_source(self):
        require_one_media_input("https://www.instagram.com/reel/ABC123xyz/", None)
        require_one_media_input(None, "https://example.test/upload.mp4")
        with self.assertRaises(ValueError):
            require_one_media_input(None, None)
        with self.assertRaises(ValueError):
            require_one_media_input("https://www.instagram.com/reel/ABC123xyz/", "https://example.test/upload.mp4")

    def test_canonicalizes_public_reel_and_post_links(self):
        self.assertEqual(
            canonical_instagram_url("https://www.instagram.com/reel/ABC123xyz/?igsh=tracking"),
            "https://www.instagram.com/reel/ABC123xyz/",
        )
        self.assertEqual(
            canonical_instagram_url("https://instagram.com/p/ABC123xyz/"),
            "https://www.instagram.com/reel/ABC123xyz/",
        )

    def test_rejects_untrusted_hosts_and_non_reel_urls(self):
        for url in (
            "http://instagram.com/reel/ABC123xyz/",
            "https://instagram.com.evil.test/reel/ABC123xyz/",
            "https://instagram.com/accounts/login/",
            "https://user:pass@instagram.com/reel/ABC123xyz/",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                canonical_instagram_url(url)

    def test_normalizes_evidence_and_bounds_timestamps(self):
        result = normalize_candidates({"candidates": [
            {"name": " Kyoto Tower ", "evidence": " Sign says Kyoto Tower ", "evidenceType": "screen_text", "frameIndex": 0, "startSeconds": 9},
            {"name": "Kyoto Tower", "evidence": "duplicate", "evidenceType": "visual_landmark"},
            {"name": "Bad time", "evidence": "quote", "evidenceType": "speech", "startSeconds": 99},
        ]}, 20)
        self.assertEqual(len(result), 2)
        self.assertEqual(result[0]["name"], "Kyoto Tower")
        self.assertEqual(result[0]["startSeconds"], 9.0)
        self.assertNotIn("startSeconds", result[1])

    def test_parses_model_json_wrapped_in_markdown(self):
        parsed = normalize_candidates('```json\n{"candidates":[{"name":"Osaka Castle","evidence":"sign","evidenceType":"screen_text"}]}\n```', 12)
        self.assertEqual(parsed[0]["name"], "Osaka Castle")

    def test_reports_visible_text_independently_of_place_candidates(self):
        candidates, text_detected = normalize_analysis(
            '{"visibleTextDetected":true,"candidates":[]}', 12,
        )
        self.assertEqual(candidates, [])
        self.assertTrue(text_detected)

    def test_missing_visible_text_signal_defaults_to_false(self):
        _, text_detected = normalize_analysis({"candidates": []}, 12)
        self.assertFalse(text_detected)

    def test_signature_matches_convex_timestamped_hmac_format(self):
        signature = callback_signature(b'{"ok":true}', "shared-secret", timestamp=123)
        self.assertEqual(len(signature.split(",v1=")[1]), 64)
        self.assertTrue(signature.startswith("t=123,v1="))


if __name__ == "__main__":
    unittest.main()
