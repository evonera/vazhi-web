"""Small, dependency-free validation helpers for the reel import worker."""

from __future__ import annotations

import hashlib
import hmac
import json
import re
import time
from urllib.parse import urlparse

MAX_DURATION_SECONDS = 90
MAX_CANDIDATES = 12


def require_one_media_input(source_url: str | None, media_url: str | None) -> None:
    """Reject missing or ambiguous worker media sources before processing."""
    if (source_url is None) == (media_url is None):
        raise ValueError("Provide exactly one reel URL or uploaded media URL.")


def normalize_analysis(value: object, duration_seconds: float) -> tuple[list[dict[str, object]], bool]:
    """Parse grounded place candidates and whether the vision model saw legible text."""
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("invalid_model_json")
        value = json.loads(text[start : end + 1])
    if not isinstance(value, dict):
        raise ValueError("invalid_model_result")
    return normalize_candidates(value, duration_seconds), value.get("visibleTextDetected") is True


def canonical_instagram_url(raw_url: str) -> str:
    try:
        parsed = urlparse(raw_url.strip())
    except ValueError as exc:
        raise ValueError("invalid_instagram_url") from exc
    host = (parsed.hostname or "").lower().removeprefix("www.")
    if parsed.scheme != "https" or host not in {"instagram.com", "m.instagram.com"} or parsed.username or parsed.password:
        raise ValueError("invalid_instagram_url")
    match = re.fullmatch(r"/(?:reel|reels|p)/([A-Za-z0-9_-]{5,32})/?", parsed.path)
    if not match:
        raise ValueError("invalid_instagram_url")
    return f"https://www.instagram.com/reel/{match.group(1)}/"


def normalize_candidates(value: object, duration_seconds: float) -> list[dict[str, object]]:
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("```"):
            text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.IGNORECASE)
        start, end = text.find("{"), text.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("invalid_model_json")
        value = json.loads(text[start : end + 1])
    if not isinstance(value, dict) or not isinstance(value.get("candidates"), list):
        raise ValueError("invalid_model_result")

    normalized: list[dict[str, object]] = []
    seen: set[str] = set()
    for item in value["candidates"][:MAX_CANDIDATES]:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        evidence = item.get("evidence")
        evidence_type = item.get("evidenceType")
        if not isinstance(name, str) or not isinstance(evidence, str) or evidence_type not in {"audio", "speech", "screen_text", "visual_landmark"}:
            continue
        name, evidence = name.strip()[:120], evidence.strip()[:300]
        if len(name) < 2 or not evidence:
            continue
        key = re.sub(r"[^\w]", "", name.casefold())
        if not key or key in seen:
            continue
        seen.add(key)
        candidate: dict[str, object] = {"name": name, "evidence": evidence, "evidenceType": evidence_type}
        start_time = item.get("startSeconds")
        end_time = item.get("endSeconds")
        if isinstance(start_time, (int, float)) and 0 <= start_time <= duration_seconds:
            candidate["startSeconds"] = round(float(start_time), 2)
        if isinstance(end_time, (int, float)) and 0 <= end_time <= duration_seconds:
            candidate["endSeconds"] = round(float(end_time), 2)
        normalized.append(candidate)
    return normalized


def callback_signature(raw_body: bytes, secret: str, timestamp: int | None = None) -> str:
    issued_at = int(time.time()) if timestamp is None else timestamp
    digest = hmac.new(secret.encode(), str(issued_at).encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    return f"t={issued_at},v1={digest}"
