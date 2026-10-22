export interface ExerciseVideoPromptInput {
  id: string;
  name: string;
  description: string;
  instructions: string[];
  safetyNotes?: string[];
  trackingRules: Array<{
    joint: string;
    movement: string;
    startingPosition: string;
    targetPosition: string;
    startAngle?: number;
    requiredAngle?: number;
    holdDurationSeconds?: number;
  }>;
}

const BASE_PROMPT = `You are generating a physiotherapy exercise demonstration video for a smart-mirror rehabilitation application.

GLOBAL RULES — follow strictly:
- Preserve the EXACT appearance of the supplied reference 3D human character (anatomy, proportions, clothing, colors, lighting style).
- Do NOT change clothing, anatomy, body proportions, skin tone, hair, or model style between frames.
- Use a completely STATIC camera: front-facing, centered, fixed distance, full body visible from head to feet.
- NO camera movement, zoom, pan, tilt, orbit, or rotation around the character.
- Animate ONLY the body movement required for this exercise.
- Use slow, controlled, clinical physiotherapy-style movement — not athletic or exaggerated motion.
- Avoid unnecessary movement in unrelated body parts.
- Start in the correct starting position, move to the target position, optionally hold briefly, return to start, and repeat seamlessly.
- The first and last frame must match so the clip loops cleanly with no visible jump.
- Background MUST be fully transparent when the tool supports alpha output.
- If transparency is unavailable, use a single flat solid color that can be keyed out later without touching the body.
- NO on-screen text, UI, logos, captions, watermarks, props, or obstructing objects.
- NO audio and NO background music.

IMPORTANT SAFETY NOTE:
This video is a visual guide for the patient only. It is NOT used for rep counting or clinical measurement.`;

function formatTrackingRules(exercise: ExerciseVideoPromptInput): string {
  return exercise.trackingRules
    .map((rule, index) => {
      const hold =
        rule.holdDurationSeconds && rule.holdDurationSeconds > 0
          ? `\n  Hold at target: ${rule.holdDurationSeconds} seconds`
          : '';
      const angles =
        rule.startAngle !== undefined && rule.requiredAngle !== undefined
          ? `\n  Joint angle guide: ${rule.startAngle}° → ${rule.requiredAngle}°`
          : '';
      return `${index + 1}. Joint: ${rule.joint}
  Movement: ${rule.movement}
  Starting position: ${rule.startingPosition}
  Target position: ${rule.targetPosition}${hold}${angles}`;
    })
    .join('\n\n');
}

/**
 * Build a reusable AI video-generation prompt from a Gemini exercise definition.
 */
export function buildExerciseVideoPrompt(
  exercise: ExerciseVideoPromptInput,
  options?: {
    referenceImagePath?: string;
    outputFilename?: string;
  },
): string {
  const referencePath =
    options?.referenceImagePath ?? 'public/exercise-videos/reference/body-motion-model-front.png';
  const outputFilename = options?.outputFilename ?? `${exercise.id}.webm`;

  return `${BASE_PROMPT}

REFERENCE IMAGE:
- Use this exact approved Body Motion 3D model reference for character appearance:
  ${referencePath}

OUTPUT TARGET:
- Format: WebM, VP9 codec, alpha channel preferred
- Duration: 5–10 seconds, seamless loop
- Frame rate: 24–30 fps
- Resolution: portrait orientation suitable for smart-mirror display (recommended 1080×1920)
- Suggested output filename: ${outputFilename}

EXERCISE DEFINITION (from Gemini plan):
- Stable exercise id: ${exercise.id}
- Display name: ${exercise.name}
- Description: ${exercise.description}

Instructions:
${exercise.instructions.map((step, index) => `${index + 1}. ${step}`).join('\n')}

Tracking rules to visually match (vision pipeline uses these separately for rep counting):
${formatTrackingRules(exercise)}

${exercise.safetyNotes?.length ? `Safety notes:\n${exercise.safetyNotes.map((note) => `- ${note}`).join('\n')}\n` : ''}
ANIMATION SEQUENCE:
1. Begin in starting position and hold briefly
2. Move slowly toward target position
3. Reach target position${exercise.trackingRules.some((rule) => (rule.holdDurationSeconds ?? 0) > 0) ? ' and hold briefly' : ''}
4. Return slowly to starting position
5. Repeat continuously for the full clip duration

Verify before delivery:
- Full body remains visible throughout
- Camera is completely static
- Loop is seamless
- Only the required joints move
- Character appearance matches the reference image exactly`;
}
