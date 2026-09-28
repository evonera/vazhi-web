"""FastAPI ingress and asynchronous Modal workers for Vazhi reel imports.

The public mobile app talks to Convex. Convex calls this service with a secret;
this service then creates CPU and GPU Modal calls and reports signed callbacks.
"""

from __future__ import annotations

import asyncio
import glob
import hmac
import io
import json
import math
import os
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path
from typing import Literal

import modal
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator

from reel_import_core import callback_signature, canonical_instagram_url, normalize_analysis, require_one_media_input

APP_NAME = "vazhi-reel-imports"
MAX_MEDIA_BYTES = 100 * 1024 * 1024
MAX_VIDEO_DURATION = 90
MAX_FRAME_COUNT = 24

app = modal.App(APP_NAME)
model_cache = modal.Volume.from_name("vazhi-reel-model-cache", create_if_missing=True)
secret = modal.Secret.from_name("vazhi-reel-imports")

common_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install("fastapi>=0.115,<1", "pydantic>=2,<3")
)
cpu_image = common_image.pip_install("yt-dlp>=2026.3.3", "pillow>=11,<13").add_local_python_source("reel_import_core")
gpu_image = (
    common_image
    .pip_install("torch>=2.8", "torchvision", "accelerate>=1.10", "qwen-asr>=0.0.6", "transformers>=4.57", "qwen-vl-utils>=0.0.14", "pillow>=11,<13")
    .add_local_python_source("reel_import_core")
)
api_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi>=0.115,<1", "pydantic>=2,<3")
    .add_local_python_source("reel_import_core")
)

api = FastAPI(title="Vazhi Reel Imports", docs_url=None, redoc_url=None)
_asr_model: object | None = None
_vision_models: tuple[object, object] | None = None


class ImportJobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    importId: str = Field(min_length=4, max_length=128, pattern=r"^[A-Za-z0-9_-]+$")
    attempt: int = Field(ge=0, le=1_000_000)
    sourceURL: str | None = Field(default=None, max_length=2048)
    mediaURL: str | None = Field(default=None, max_length=4096)

    @model_validator(mode="after")
    def exactly_one_input(self) -> "ImportJobRequest":
        require_one_media_input(self.sourceURL, self.mediaURL)
        if self.sourceURL is not None:
            self.sourceURL = canonical_instagram_url(self.sourceURL)
        return self


async def post_callback(callback_url: str, payload: dict[str, object]) -> None:
    secret_value = os.environ.get("MODAL_IMPORT_CALLBACK_SECRET", "")
    if not secret_value:
        raise RuntimeError("Modal callback secret is missing")
    body = json.dumps(payload, separators=(",", ":")).encode()
    signature = callback_signature(body, secret_value)
    request = urllib.request.Request(
        callback_url,
        data=body,
        headers={"content-type": "application/json", "x-vazhi-edge-signature": signature},
        method="POST",
    )
    await asyncio.to_thread(urllib.request.urlopen, request, timeout=20)


def probe_duration(video_path: Path) -> float:
    result = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(video_path)],
        check=True, capture_output=True, text=True, timeout=20,
    )
    duration = float(json.loads(result.stdout)["format"]["duration"])
    if duration <= 0 or duration > MAX_VIDEO_DURATION:
        raise ValueError("clip_too_long")
    return duration


def download_upload(media_url: str, destination: Path) -> None:
    request = urllib.request.Request(media_url, headers={"user-agent": "Vazhi/1.0 reel import"})
    with urllib.request.urlopen(request, timeout=30) as response, destination.open("wb") as output:
        length = response.headers.get("content-length")
        if length and int(length) > MAX_MEDIA_BYTES:
            raise ValueError("video_too_large")
        total = 0
        while chunk := response.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_MEDIA_BYTES:
                raise ValueError("video_too_large")
            output.write(chunk)


def prepare_audio_and_frames(video_path: Path, working_dir: Path) -> tuple[bytes, list[dict[str, object]], float, dict[str, object]]:
    duration = probe_duration(video_path)
    audio_path = working_dir / "audio.wav"
    audio_stream = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "csv=p=0", str(video_path)],
        check=True, capture_output=True, text=True, timeout=20,
    ).stdout.strip()
    audio = b""
    if audio_stream:
        subprocess.run(
            ["ffmpeg", "-nostdin", "-y", "-i", str(video_path), "-t", str(MAX_VIDEO_DURATION), "-vn", "-ac", "1", "-ar", "16000", str(audio_path)],
            check=True, capture_output=True, timeout=60,
        )
        audio = audio_path.read_bytes()
    frames_dir = working_dir / "frames"
    frames_dir.mkdir()
    subprocess.run(
        ["ffmpeg", "-nostdin", "-y", "-i", str(video_path), "-t", str(MAX_VIDEO_DURATION), "-vf", "fps=1,scale=512:512:force_original_aspect_ratio=decrease", "-q:v", "5", str(frames_dir / "%03d.jpg")],
        check=True, capture_output=True, timeout=60,
    )
    frame_paths = sorted(Path(path) for path in glob.glob(str(frames_dir / "*.jpg")))
    if len(frame_paths) > MAX_FRAME_COUNT:
        indices = [round(index * (len(frame_paths) - 1) / (MAX_FRAME_COUNT - 1)) for index in range(MAX_FRAME_COUNT)]
        frame_paths = [frame_paths[index] for index in indices]
    frames = [{"timestamp": float(path.stem) - 1.0, "image": path.read_bytes()} for path in frame_paths]
    if not frames and not audio:
        raise ValueError("empty_video")
    audio_has_energy = False
    if audio:
        with wave.open(str(audio_path), "rb") as wav_file:
            pcm = wav_file.readframes(wav_file.getnframes())
            if pcm:
                import array
                samples = array.array("h")
                samples.frombytes(pcm)
                if os.sys.byteorder != "little":
                    samples.byteswap()
                rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples))
                # About -60 dBFS: keep quiet speech while ignoring digital silence.
                audio_has_energy = rms >= 32
    signals: dict[str, object] = {
        "audioTrackDetected": bool(audio_stream),
        "audioHasEnergy": audio_has_energy,
        "framesAnalyzed": len(frames),
        "visibleTextDetected": False,
        "audioTranscriptDetected": False,
    }
    return audio, frames, duration, signals


@app.function(
    image=cpu_image,
    secrets=[secret],
    timeout=180,
    max_containers=4,
    scaledown_window=2,
)
def prepare_media(import_id: str, attempt: int, source_url: str | None, media_url: str | None, callback_url: str) -> None:
    try:
        require_one_media_input(source_url, media_url)
    except ValueError:
        asyncio.run(post_callback(callback_url, {"importId": import_id, "attempt": attempt, "status": "failed", "failureCode": "invalid_media_input"}))
        return
    is_link_download = source_url is not None and media_url is None
    if source_url is not None:
        try:
            source_url = canonical_instagram_url(source_url)
        except ValueError:
            asyncio.run(post_callback(callback_url, {"importId": import_id, "attempt": attempt, "status": "failed", "failureCode": "invalid_source"}))
            return

    with tempfile.TemporaryDirectory(prefix="vazhi-reel-") as temporary:
        working_dir = Path(temporary)
        video_path = working_dir / "source.mp4"
        try:
            if media_url is None and source_url:
                import yt_dlp

                options = {
                    "format": "best[ext=mp4]/best",
                    "outtmpl": str(video_path),
                    "noplaylist": True,
                    "quiet": True,
                    "no_warnings": True,
                    "max_filesize": MAX_MEDIA_BYTES,
                    "socket_timeout": 25,
                    "retries": 1,
                    "extractor_retries": 1,
                }
                with yt_dlp.YoutubeDL(options) as downloader:
                    metadata = downloader.extract_info(source_url, download=False)
                    if not metadata or float(metadata.get("duration") or 0) > MAX_VIDEO_DURATION:
                        raise ValueError("clip_too_long")
                    downloader.download([source_url])
                candidates = list(working_dir.glob("source.*"))
                if not candidates:
                    raise RuntimeError("download_failed")
                video_path = candidates[0]
                if video_path.stat().st_size > MAX_MEDIA_BYTES:
                    raise ValueError("video_too_large")
            else:
                assert media_url is not None
                download_upload(media_url, video_path)

            audio, frames, duration, signals = prepare_audio_and_frames(video_path, working_dir)
            analyze_media.spawn(import_id, attempt, callback_url, audio, frames, duration, signals)
        except Exception as error:
            if is_link_download and isinstance(error, ValueError) and str(error) in {"clip_too_long", "video_too_large", "empty_video"}:
                status, failure = "failed", str(error)
            elif is_link_download:
                status, failure = "needs_media", "source_unavailable"
            else:
                status, failure = "failed", str(error)[:80] if isinstance(error, ValueError) else "invalid_uploaded_video"
            asyncio.run(post_callback(callback_url, {"importId": import_id, "attempt": attempt, "status": status, "failureCode": failure}))


def load_asr_model():
    import torch
    from qwen_asr import Qwen3ASRModel

    asr = Qwen3ASRModel.from_pretrained(
        "Qwen/Qwen3-ASR-0.6B", dtype=torch.bfloat16, device_map="cuda:0", max_new_tokens=1024,
    )

    return asr


def load_vision_models():
    import torch
    from transformers import AutoProcessor, Qwen3VLForConditionalGeneration

    processor = AutoProcessor.from_pretrained("Qwen/Qwen3-VL-4B-Instruct")
    vision = Qwen3VLForConditionalGeneration.from_pretrained(
        "Qwen/Qwen3-VL-4B-Instruct", torch_dtype=torch.bfloat16, device_map="cuda:0",
    )
    return processor, vision


@app.function(
    image=gpu_image,
    gpu="L4",
    volumes={"/root/.cache/huggingface": model_cache},
    secrets=[secret],
    timeout=600,
    max_containers=1,
    scaledown_window=2,
)
def analyze_media(
    import_id: str,
    attempt: int,
    callback_url: str,
    audio: bytes,
    raw_frames: list[dict[str, object]],
    duration: float,
    signals: dict[str, object],
) -> None:
    from PIL import Image

    try:
        asyncio.run(post_callback(callback_url, {"importId": import_id, "attempt": attempt, "status": "processing"}))
        audio_path: Path | None = None
        if audio:
            audio_path = Path(tempfile.gettempdir()) / f"vazhi-{import_id}.wav"
            audio_path.write_bytes(audio)
        frames = [
            {"timestamp": float(item["timestamp"]), "image": Image.open(io.BytesIO(item["image"])).convert("RGB")}
            for item in raw_frames
        ]

        global _asr_model, _vision_models
        transcript = ""
        language = "unknown"
        warnings: list[str] = []
        if audio_path is not None and signals.get("audioHasEnergy"):
            try:
                if _asr_model is None:
                    _asr_model = load_asr_model()
                transcript_result = _asr_model.transcribe(audio=str(audio_path), language=None)[0]
                transcript = str(transcript_result.text).strip()[:6000]
                language = str(getattr(transcript_result, "language", "unknown"))[:40]
                signals["audioTranscriptDetected"] = bool(transcript)
            except Exception:
                warnings.append("audio_analysis_unavailable")

        if _vision_models is None:
            _vision_models = load_vision_models()
        processor, vision = _vision_models

        content: list[dict[str, object]] = [{"type": "text", "text": (
            "Identify travel places explicitly evidenced by the transcript or these video frames. "
            "Do not guess from generic scenery. Return JSON only: {\"candidates\":[{\"name\":string,"
            "\"evidence\":string,\"evidenceType\":\"audio\"|\"screen_text\"|\"visual_landmark\","
            "\"frameIndex\":integer|null}],\"visibleTextDetected\":boolean}. Set visibleTextDetected true only if readable text is visible in any frame, including captions/subtitles, whether or not it names a place. "
            "Evidence must quote the transcript or describe a clearly identifiable sign/landmark. "
            "Use frameIndex for screen_text and visual_landmark candidates, null for audio. Maximum 12 candidates. "
            f"Detected transcript language: {language}. Transcript: {transcript or '[no intelligible audio transcript]'}"
        )}]
        for index, frame in enumerate(frames):
            seconds = frame["timestamp"]
            content.append({"type": "text", "text": f"Frame {index}; timestamp {seconds:.2f} seconds."})
            content.append({"type": "image", "image": frame["image"]})
        messages = [{"role": "user", "content": content}]
        inputs = processor.apply_chat_template(
            messages, tokenize=True, add_generation_prompt=True, return_dict=True, return_tensors="pt",
        )
        inputs = {key: value.to(vision.device) if hasattr(value, "to") else value for key, value in inputs.items()}
        output = vision.generate(**inputs, max_new_tokens=800, do_sample=False)
        prompt_length = inputs["input_ids"].shape[-1]
        model_text = processor.decode(output[0][prompt_length:], skip_special_tokens=True)
        candidates, visible_text_detected = normalize_analysis(model_text, duration)
        signals["visibleTextDetected"] = visible_text_detected
        for item in candidates:
            frame_index = None
            try:
                raw = json.loads(model_text[model_text.find("{") : model_text.rfind("}") + 1])
                matched = next((candidate for candidate in raw.get("candidates", []) if candidate.get("name", "").strip().casefold() == item["name"].casefold()), None)
                if matched:
                    frame_index = matched.get("frameIndex")
            except Exception:
                pass
            if item["evidenceType"] in {"screen_text", "visual_landmark"} and isinstance(frame_index, int) and 0 <= frame_index < len(frames):
                timestamp = float(frames[frame_index]["timestamp"])
                item["startSeconds"] = round(timestamp, 2)
                item["endSeconds"] = round(min(duration, timestamp + 1), 2)

        asyncio.run(post_callback(callback_url, {
            "importId": import_id, "attempt": attempt, "status": "completed", "candidates": candidates,
            "mediaSignals": signals, "warnings": warnings,
        }))
    except Exception:
        asyncio.run(post_callback(callback_url, {"importId": import_id, "attempt": attempt, "status": "failed", "failureCode": "analysis_failed"}))
    finally:
        if audio_path is not None:
            audio_path.unlink(missing_ok=True)


@api.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@api.post("/v1/jobs", status_code=202)
async def submit_job(body: ImportJobRequest, authorization: str | None = Header(default=None)) -> dict[str, object]:
    expected = f"Bearer {os.environ.get('MODAL_INGRESS_TOKEN', '')}"
    if expected == "Bearer " or not authorization or not hmac.compare_digest(authorization, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")
    callback_url = os.environ.get("CONVEX_IMPORT_CALLBACK_URL", "")
    if not callback_url.startswith("https://") or "/api/internal/imports/callback" not in callback_url:
        raise HTTPException(status_code=503, detail="Callback is not configured")
    call = await prepare_media.spawn.aio(body.importId, body.attempt, body.sourceURL, body.mediaURL, callback_url)
    return {"callId": call.object_id, "accepted": True}


@app.function(image=api_image, secrets=[secret], max_containers=2, scaledown_window=2)
@modal.asgi_app()
def fastapi_app() -> FastAPI:
    return api
