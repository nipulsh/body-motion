# Exercise demonstration video specification

Use this specification for every AI-generated 3D exercise demonstration video in Body Motion.

## Character

- Use the approved Body Motion 3D human model / reference image.
- Keep the **same model appearance** across all exercises.
- Keep proportions and body structure consistent.
- Do **not** change clothing, colors, anatomy, or model style between exercises or frames.
- Reference image path: `app/public/exercise-videos/reference/body-motion-model-front.png`

## Camera (identical for every exercise)

| Requirement | Value |
|-------------|-------|
| View | Front-facing |
| Framing | Full body visible (head to feet) |
| Position | Character centered |
| Camera movement | **None** |
| Zoom | **None** |
| Orbit / rotation | **None** |
| Distance | Fixed for all exercises |

## Background

**Preferred:** fully transparent background (WebM VP9 with alpha).

**Fallback:** if the generation tool cannot export transparency, use a single flat solid color that can be keyed out later without affecting the body silhouette.

The app uses a subtle panel backdrop when alpha is unavailable; missing alpha must **not** break the exercise screen.

## Animation

The character must:

1. Start in the correct **starting position** (from Gemini `trackingRules`)
2. Move **slowly and clearly** toward the **target position**
3. Optionally **hold briefly** at target (when `holdDurationSeconds` is set)
4. **Return** to the starting position
5. **Repeat continuously** for the clip duration
6. Use controlled **physiotherapy-style** movement
7. Avoid exaggerated or athletic motion
8. Avoid unnecessary movement in unrelated body parts

The animation should **visually correspond** to the exercise Gemini `trackingRules`, but the video is **not** used for rep counting.

### First test exercise sequence (Shoulder Abduction)

```text
Starting position (arm at side)
        ↓
Raise arm slowly to the side
        ↓
Reach target position (~90° abduction)
        ↓
Brief hold
        ↓
Return to starting position
        ↓
Repeat (seamless loop)
```

Generate and approve **this one video** before producing the full 5–6 exercise set.

## Technical requirements

| Property | Target |
|----------|--------|
| Format | WebM |
| Codec | VP9 (preferred) |
| Alpha | Preferred (`yuva420p` pixel format) |
| FPS | 24–30 |
| Resolution | Portrait smart-mirror display; recommended **1080×1920**, minimum **480×640** |
| Duration | **5–10 seconds** |
| Loop | Seamless (first frame ≈ last frame) |
| Audio | **None** |

### Encoding example (ffmpeg)

After generation, re-encode if needed:

```bash
ffmpeg -i input.mov -c:v libvpx-vp9 -pix_fmt yuva420p -an -b:v 2M output.webm
```

## Asset naming

Prefer the stable Gemini exercise id:

```text
<exercise-id>.webm
```

Example:

```text
shoulder_abduction_001.webm
```

Do **not** name files from display names (`Shoulder Abduction.webm`) because names can change.

## Manifest entry

Add to `app/public/exercise-videos/manifest.json`:

```json
{
  "videos": {
    "shoulder_abduction_001": "shoulder_abduction_001.webm"
  }
}
```

The key must match the Gemini exercise `id` exactly.

## Validation

Run from `app/`:

```bash
npm run validate:exercise-videos
```

Programmatic constants: `app/src/exercise/demoVideoSpec.ts`  
Validation logic: `app/src/exercise/demoVideoValidation.ts`

## Transparent WebM in Electron / Chromium

The desktop app runs in a **Chromium-based webview** (Electron on Windows uses Chromium).

| Topic | Notes |
|-------|-------|
| VP9 WebM playback | Supported |
| VP9 WebM with alpha | Supported in Chromium when encoded as `yuva420p` |
| `<video>` element | Used by `ExerciseDemoVideo`; no custom decoder required |
| Limitations | Some AI tools export incorrect alpha; verify with `ffprobe -show_streams` (`pix_fmt` contains `yuva`). Very large files may load slowly on low-end mirrors. Hardware decode edge cases are rare but re-encoding usually fixes them. |
| Fallback | If alpha is missing or decode fails, the app shows a neutral gradient panel — exercise session continues normally. |

## Safety / accuracy

The generated video is a **visual demonstration only**.

Source of truth for rep detection:

```text
Gemini trackingRules + MediaPipe + joint angles + RepDetector
```
