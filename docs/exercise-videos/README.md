# Exercise demonstration video workflow

This folder documents how to produce, validate, and bundle AI-generated 3D exercise demonstration videos for the Body Motion smart-mirror app.

## End-to-end pipeline

```text
Gemini Exercise Plan
        ↓
Exercise id + name + trackingRules
        ↓
Reference 3D model image (fixed)
        ↓
AI-generated exercise animation/video
        ↓
Transparent background (preferred)
        ↓
WebM (VP9 + alpha)
        ↓
app/public/exercise-videos/
        ↓
manifest.json (keyed by exercise id)
        ↓
resolveExerciseDemoVideoUrl()
        ↓
ExerciseDemoVideo (autoplay, loop, muted)
```

## Stable exercise identifiers

Every Gemini exercise includes a unique stable `id` validated by the server schema:

- Pattern: `^[a-z0-9_-]+$`
- Max length: 64 characters
- Examples: `shoulder_abduction_001`, `shoulder_flexion_march`
- Display names (`name`) may change; **always map videos by `id`**

See `server/src/schemas/exercise.schema.ts` and `app/src/exercise/demoVideoSpec.ts`.

## Documents in this folder

| File | Purpose |
|------|---------|
| [SPECIFICATION.md](./SPECIFICATION.md) | Character, camera, animation, and technical video requirements |
| [REFERENCE-IMAGE.md](./REFERENCE-IMAGE.md) | Approved reference image requirements for video generation |
| [PROMPT-TEMPLATE.md](./PROMPT-TEMPLATE.md) | Reusable AI video-generation prompt template |

## Asset locations

| Asset | Path |
|-------|------|
| Generated videos | `app/public/exercise-videos/*.webm` |
| Manifest | `app/public/exercise-videos/manifest.json` |
| Reference image | `app/public/exercise-videos/reference/body-motion-model-front.png` |
| Prompt builder (code) | `app/src/exercise/buildVideoPrompt.ts` |
| Validation (code) | `app/src/exercise/validateExerciseVideoAssets.ts` |

## Recommended rollout

1. Place the approved reference image at `reference/body-motion-model-front.png`.
2. Generate **one test video** first — **Shoulder Abduction** (simple, single-joint).
3. Validate with `npm run validate:exercise-videos`.
4. Add the manifest entry using the Gemini exercise `id`.
5. Verify in the exercise session UI (`ExerciseScreen` → 3D demo panel).
6. After visual approval, generate the remaining 4–5 exercises.

Do **not** add fake or placeholder video files. The UI shows a clean fallback until real videos exist.

## Validation

From `app/`:

```bash
npm run validate:exercise-videos
```

Checks manifest structure, file existence, size, and (when `ffprobe` is installed) duration, resolution, codec, and alpha channel.

## Source of truth for rep counting

The demo video is **visual guidance only**. Rep validation remains:

```text
Gemini trackingRules
        +
Live MediaPipe landmarks
        +
Joint-angle calculations
        +
RepDetector
```

Do not use generated video motion for rep detection.

## Related code (do not modify for asset workflow)

- `vision/exercise/RepDetector.ts`
- `vision/exercise/ExerciseTracker.ts`
- `vision/pose/jointAngles.ts`
- `vision/exercise/ExerciseSessionController.ts`
