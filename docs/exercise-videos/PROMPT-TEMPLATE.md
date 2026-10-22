# AI video-generation prompt template

Use this template when generating 3D exercise demonstration videos. The canonical programmatic version lives in:

```text
app/src/exercise/buildVideoPrompt.ts
```

Generate a filled prompt from a Gemini exercise JSON:

```typescript
import { buildExerciseVideoPrompt } from '@/exercise/buildVideoPrompt';

const prompt = buildExerciseVideoPrompt({
  id: exercise.id,
  name: exercise.name,
  description: exercise.description,
  instructions: exercise.instructions,
  safetyNotes: exercise.safetyNotes,
  trackingRules: exercise.trackingRules,
});
```

## Template (manual fill)

Copy and replace the `{{placeholders}}`.

---

You are generating a physiotherapy exercise demonstration video for a smart-mirror rehabilitation application.

### Global rules

- Preserve the **exact appearance** of the supplied reference 3D human character.
- Do **not** change clothing, anatomy, proportions, skin tone, hair, or model style.
- Use a **completely static camera**: front-facing, centered, fixed distance, full body head-to-feet visible.
- **No** camera movement, zoom, pan, tilt, or orbit.
- Animate **only** the required body movement for this exercise.
- Use slow, controlled physiotherapy-style movement — not athletic or exaggerated motion.
- Start in the starting position → move to target → optional brief hold → return → repeat seamlessly.
- First and last frame must match for a clean loop.
- Background: **transparent** when supported; otherwise a flat solid keyable color.
- **No** text, UI, logos, captions, watermarks, props, or audio.

**Safety note:** This video is a visual guide only. It is **not** used for rep counting.

### Reference image

Use this approved Body Motion 3D model reference:

```text
public/exercise-videos/reference/body-motion-model-front.png
```

### Output target

| Property | Value |
|----------|-------|
| Format | WebM |
| Codec | VP9 |
| Alpha | Preferred |
| Duration | 5–10 seconds, seamless loop |
| FPS | 24–30 |
| Resolution | Portrait; recommended 1080×1920 |
| Filename | `{{exercise_id}}.webm` |
| Audio | None |

### Exercise definition (from Gemini)

- **Stable exercise id:** `{{exercise_id}}`
- **Display name:** `{{exercise_name}}`
- **Description:** `{{exercise_description}}`

**Instructions:**

1. `{{instruction_1}}`
2. `{{instruction_2}}`
…

**Tracking rules to visually match:**

```text
Joint: {{joint}}
Movement: {{movement}}
Starting position: {{starting_position}}
Target position: {{target_position}}
Hold at target: {{hold_duration_seconds}} (if applicable)
```

**Safety notes:**

- `{{safety_note_1}}`

### Animation sequence

1. Begin in starting position; hold briefly
2. Move slowly toward target position
3. Reach target; hold briefly if specified
4. Return slowly to starting position
5. Repeat continuously for the full clip

### Pre-delivery checklist

- [ ] Full body visible throughout
- [ ] Camera completely static
- [ ] Seamless loop
- [ ] Only required joints move
- [ ] Character matches reference image exactly
- [ ] No audio, text, or UI

---

## First recommended exercise

Generate **Shoulder Abduction** first:

- Simple single-joint movement (arm raise to the side)
- Easy to verify camera framing, loop quality, and transparency
- After approval, generate the remaining plan exercises

Use the Gemini exercise `id` from the generated plan (e.g. `shoulder_abduction_001`) — not the display name — for the filename and manifest entry.

## After generation

1. Save to `app/public/exercise-videos/<exercise-id>.webm`
2. Add manifest entry keyed by exercise `id`
3. Run `npm run validate:exercise-videos`
4. Verify in the exercise session UI
