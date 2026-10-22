# Reference model image

The image-generation pipeline uses a **common male human reference model** image stored on the server (not patient photographs). Gemini uses this asset to keep proportions and anatomy consistent across the four generated views (front, right, back, left).

## Setup

1. Place a PNG, JPEG, or WEBP file at the default path:
   ```
   src/assets/reference-male-model.png
   ```
2. Or set `REFERENCE_MODEL_IMAGE_PATH` in `.env` to any absolute or project-relative path.

## Requirements

- Full-body, neutral anatomical reference (not a real patient photo).
- Prefer a front-facing pose with clear limb definition.
- Recommended minimum resolution: 1024×1024.

## Runtime behaviour

- The server **does not** require this file to start.
- If the file is missing when a job reaches the **image generation** stage, the pipeline fails with a clear `CONFIGURATION_ERROR` and the job moves to `FAILED` at step `IMAGE_GENERATION`.
- Add the file before retrying the job via `POST /api/jobs/:jobId/retry`.

## Git

Binary assets under `src/assets/` are gitignored. Each deployment environment must supply its own reference image.
