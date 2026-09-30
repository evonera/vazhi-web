import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from reel_import import analyze_media, prepare_audio_and_frames


class ReelImportWorkerTests(unittest.TestCase):
    def test_initial_callback_failure_does_not_mask_recovery_with_uninitialized_cleanup(self):
        callback = AsyncMock(side_effect=[RuntimeError("initial callback unavailable"), None])
        with patch("reel_import.post_callback", callback):
            analyze_media.local("import-123", 0, "https://backend.example/callback", b"", [], 1.0, {})

        self.assertEqual(callback.await_count, 2)
        self.assertEqual(callback.await_args_list[0].args[1]["status"], "processing")
        self.assertEqual(callback.await_args_list[1].args[1]["status"], "failed")
        self.assertEqual(callback.await_args_list[1].args[1]["failureCode"], "analysis_failed")

    def test_bad_audio_track_preserves_video_frames(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            video = directory / "input.mp4"
            video.write_bytes(b"not used by mocked ffmpeg")

            def run(command, **_kwargs):
                if command[0] == "ffprobe":
                    return subprocess.CompletedProcess(command, 0, stdout="0\n")
                if "-vn" in command:
                    raise subprocess.CalledProcessError(1, command)
                frames = directory / "frames"
                (frames / "001.jpg").write_bytes(b"frame")
                return subprocess.CompletedProcess(command, 0)

            with patch("reel_import.probe_duration", return_value=12.0), patch("reel_import.subprocess.run", side_effect=run):
                audio, frames, duration, signals = prepare_audio_and_frames(video, directory)

            self.assertEqual(audio, b"")
            self.assertEqual(duration, 12.0)
            self.assertEqual(len(frames), 1)
            self.assertEqual(signals["framesAnalyzed"], 1)
            self.assertTrue(signals["audioTrackDetected"])
            self.assertFalse(signals["audioHasEnergy"])
            self.assertTrue(signals["audioExtractionFailed"])

    def test_invalid_wav_preserves_video_frames(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            video = directory / "input.mp4"
            video.write_bytes(b"not used by mocked ffmpeg")

            def run(command, **_kwargs):
                if command[0] == "ffprobe":
                    return subprocess.CompletedProcess(command, 0, stdout="0\n")
                if "-vn" in command:
                    (directory / "audio.wav").write_bytes(b"invalid wav")
                else:
                    (directory / "frames" / "001.jpg").write_bytes(b"frame")
                return subprocess.CompletedProcess(command, 0)

            with patch("reel_import.probe_duration", return_value=12.0), patch("reel_import.subprocess.run", side_effect=run):
                audio, frames, _duration, signals = prepare_audio_and_frames(video, directory)

            self.assertEqual(audio, b"")
            self.assertEqual(len(frames), 1)
            self.assertTrue(signals["audioExtractionFailed"])


if __name__ == "__main__":
    unittest.main()
