# Reference image requirements

The reference image is supplied to the AI video-generation model for **every** exercise demonstration. It defines the approved Body Motion 3D human character appearance.

## File location

```text
app/public/exercise-videos/reference/body-motion-model-front.png
```

Referenced in `manifest.json` as `"referenceImage": "reference/body-motion-model-front.png"`.

## Required content

The reference image must show:

| Requirement | Detail |
|-------------|--------|
| Model | Exact approved Body Motion 3D human model |
| Pose | Neutral standing pose |
| View | Front-facing |
| Framing | Full body visible (head to feet) |
| Centering | Character centered in frame |
| Lighting | Consistent, even clinical lighting |
| Proportions | Consistent with the approved model |
| Obstructions | No props, furniture, or objects blocking the body |
| Background | Clean / transparent / solid keyable color — no busy scenery |

## Reuse policy

- Use the **same reference image for every exercise**.
- Do not create per-exercise reference variants unless clinically required and approved.
- The video model must preserve this appearance across all generated clips.

## Producing the reference image

Suggested sources in this project:

- Render a front-facing full-body frame from the approved Body Explorer / anatomy model (`BodyExplorer`, `anatomy.glb`).
- Export as PNG with transparency if the render pipeline supports it.

## What the reference image is NOT

- Not a substitute for live pose tracking
- Not used by MediaPipe or RepDetector
- Not modified per patient session (patient-specific rigged models are separate from exercise demos)

## Checklist before first video generation

- [ ] Full body visible head-to-toe
- [ ] Front-facing, neutral standing pose
- [ ] Approved model appearance locked
- [ ] No text, UI, logos, or watermarks
- [ ] Saved to `reference/body-motion-model-front.png`
