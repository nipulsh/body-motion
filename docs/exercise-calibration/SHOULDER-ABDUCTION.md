# Shoulder Abduction — Real-World Calibration Guide

Calibrate **Shoulder Abduction only** before expanding to the full exercise plan.

## Enable diagnostic mode

In `app/.env` (development only):

```bash
VITE_EXERCISE_DIAGNOSTIC=true
```

Restart `npm run electron:dev`. The exercise screen shows a dev-only overlay with FPS, angles, phase, and rep count. Production builds ignore this flag.

## Record calibration data (no video)

1. Start an exercise session with Shoulder Abduction.
2. Click **Record calibration** during live movement.
3. Perform correct and incorrect reps listed below.
4. Click **Stop recording**, then **Download JSONL**.

Each line contains timestamp, joint angles, confidence, phase, rep count, tracking state, and feedback. No camera video is stored or uploaded.

## Recommended camera setup

| Setting | Recommendation |
|---------|----------------|
| Distance | 2.0–3.5 m from mirror (ideal ~2.5 m) |
| Camera height | Lens at chest to mid-torso (~1.0–1.2 m) |
| Framing | Full body visible (head to feet) |
| Lighting | Even front lighting; avoid strong backlight |
| Pose | Face mirror squarely; arms relaxed at sides before start |

Patient instruction: **Step back until your entire body is visible.**

## Test matrix

### Correct movement
- Slow controlled abduction
- Faster abduction
- Slightly different starting arm position
- Left arm only / right arm only (match Gemini `trackingRule.joint`)
- Multiple consecutive reps

### Incorrect movement (should NOT count)
- Half rep (stops before target zone)
- Reaches target but does not return
- Returns before reaching target
- Wrong arm moving
- Body partially out of frame
- Standing too close / too far

## If false reps occur

Check in order: landmark confidence → sudden-jump filter → start tolerance → Gemini target/tolerance → hold duration. Do **not** patch rep counting in the UI.

## Next exercises to calibrate

After Shoulder Abduction is reliable: shoulder flexion, knee extension, squat, then remaining plan exercises.
