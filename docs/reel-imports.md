# Reel imports

The iOS app sends owner-authenticated requests to Convex. Convex creates the durable import record, checks the owner's quota, and invokes the private FastAPI ingress on Modal. The Modal ingress returns a job receipt immediately; CPU media preparation and L4 inference run as background Modal functions. Modal posts a timestamped HMAC-signed callback to Convex. Convex resolves candidate names with Places and stores only Google Place IDs from provider data.

## Convex configuration

Configure these Convex deployment environment variables:

- `MODAL_REEL_IMPORT_URL`: the deployed Modal `/v1/jobs` URL.
- `MODAL_REEL_IMPORT_TOKEN`: a high-entropy bearer token shared with the Modal secret.
- `MODAL_IMPORT_CALLBACK_SECRET`: the HMAC key shared with the Modal secret.
- `REEL_URL_IMPORT_ENABLED`: keep `false` until platform-terms review approves automated Instagram retrieval. Uploaded video processing does not depend on this switch.

Convex already provides `CONVEX_SITE_URL`; Modal uses it to call `/api/internal/imports/callback`.

## Modal configuration

Create the Modal secret `vazhi-reel-imports` with:

- `MODAL_INGRESS_TOKEN`: same value as Convex `MODAL_REEL_IMPORT_TOKEN`.
- `MODAL_IMPORT_CALLBACK_SECRET`: same value as Convex `MODAL_IMPORT_CALLBACK_SECRET`.
- `CONVEX_IMPORT_CALLBACK_URL`: the full deployed Convex site URL plus `/api/internal/imports/callback`.

Install dependencies and deploy from the backend repository root after creating the Modal secret and configuring Convex as described above:

```sh
python3 -m pip install -r modal/requirements.txt
modal deploy modal/reel_import.py
```

Use `modal serve modal/reel_import.py` for local iteration. The first inference call downloads Qwen model weights into the persistent Modal model-cache volume. Source videos, extracted audio, and sampled frames live only in each worker's temporary directory or invocation payload; the workers do not persist media to a Modal volume. The app has no scheduled tasks or minimum warm containers. All three Modal functions use a two-second scale-down window and scale to zero when idle. Modal compute is billed for execution and any brief scale-down time; persistent model-weight storage is billed separately under Modal's volume policy. Convex file URLs are bearer URLs that remain usable until the file is deleted; callbacks delete uploaded videos after processing, and a Convex hourly job deletes media from imports that time out.

## HTTP contract

- `POST /api/owner/imports` with `{ "idempotencyKey": "UUID", "sourceURL": "https://www.instagram.com/reel/.../" }` starts link retrieval.
- `POST /api/owner/imports/upload?idempotencyKey=UUID` with `Content-Type: video/mp4` or `video/quicktime` and the raw video body creates a new upload job. An optional `sourceURL` query parameter records the original public reel URL.
- `POST /api/owner/imports/upload?importId=...` with the raw video body reuses that owner-owned `needs_media` job for Photos fallback rather than creating a second import and consuming another import quota token.
- `GET /api/owner/imports` returns the owner's 50 most recent imports and candidate evidence; `GET /api/owner/imports?importId=...` returns one job. Neither polling endpoint calls billable Place Details. The client can resolve a user-selected Place ID through the existing quota-limited `/api/owner/places/details` endpoint. Only Place IDs are persisted from Google; the client must treat display details as transient and show required Google attribution.
- `DELETE /api/owner/imports` with `{ "importId": "..." }` removes the import and any in-flight Convex upload.

Every owner route requires a Better Auth bearer JWT and derives ownership from the authenticated identity. The signed internal callback is not accessible with that owner token. All owner responses are `no-store`. Keep the Modal token and callback HMAC key only in Convex/Modal environment secrets.

Link extraction accepts only public Instagram reel/post URLs. When retrieval is unavailable, the job returns `needs_media`; the user can upload an MP4 or QuickTime clip under 20 MB. Convex's authenticated HTTP action enforces the cap before storage, attaches the stored blob to the owner-scoped job in the same request, and deletes it if attachment fails. This launch cap avoids exposing a generated upload URL, which would allow unbounded file size and unattached blobs. Larger videos require a future import-scoped object-storage flow with enforced size and expiry. All clips are limited to 90 seconds. Model output is treated as untrusted: candidate count, names, evidence, timestamps, and evidence types are bounded before storage. Place suggestions stay drafts and do not create Journeys or Paths.

## Modality handling

CPU preparation probes for an audio stream, extracts mono audio, measures its RMS level, and samples up to 24 frames across the clip. Near-silent audio is skipped. The GPU reports `mediaSignals` with `audioTrackDetected`, `audioHasEnergy`, `audioTranscriptDetected`, `framesAnalyzed`, and `visibleTextDetected`. ASR errors are reported as warning codes while video analysis continues; readable captions and other text can be detected even when they do not name a place. The vision model receives the transcript and sampled frames together, so it can use audio transcripts (including lyrics when ASR recognizes them), subtitles, signs, and visible landmarks as separate evidence types.

These flags are evidence signals, not guarantees: ASR can mistake lyrics for dialogue or miss quiet/overlapping audio, and frame sampling can miss brief captions between sampled frames. An empty candidate list means no grounded place was returned; it does not mean the clip had no audio or text. The job exposes signals so the app can explain which sources were present and offer the Photos upload route when link retrieval fails.

| Clip content | Processing behavior |
| --- | --- |
| No audio track | Skip ASR; analyze sampled frames for text and grounded landmarks. |
| Silent audio track | Mark the track present, detect near silence, skip ASR; continue frame analysis. |
| Music with captions | Transcribe only if ASR recognizes words; detect captions from frames independently and combine any place evidence. |
| Speech with no captions | Transcribe audio and use the transcript with the frames. |
| Captions with no audio | Run visual analysis only; captions can produce text evidence even when they contain no place. |
| Audio and captions | Analyze both branches; keep evidence tagged by source so the user can review it. |
| Neither useful audio nor readable text | Return no place candidates rather than guessing from generic scenery. |

Automated URL retrieval remains disabled until review because yt-dlp still depends on Instagram's unofficial, changeable access paths. Do not add authenticated cookies or rotating proxies to this integration.
