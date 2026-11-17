import type { PoseResult } from '@vision';
import { evaluateBodyVisibility } from '@vision';

/** Recommended smart-mirror camera setup derived from vision quality gates. */
export const CAMERA_SETUP = {
  recommendedDistanceMeters: { min: 2.0, ideal: 2.5, max: 3.5 },
  recommendedHeightMeters: { lensAtChest: 1.0, lensAtMidTorso: 1.2 },
  minimumFrame: { width: 640, height: 360 },
  preferredResolution: { width: 1280, height: 720 },
  lighting:
    'Even front lighting on the body. Avoid strong backlighting or shadows across shoulders and hips.',
  visibleLandmarks:
    'Head, both shoulders, both hips, and feet should remain visible throughout the exercise.',
} as const;

export const PATIENT_POSITIONING_STEPS = [
  'Step back until your entire body is visible in the mirror.',
  'Center yourself in the camera view.',
  'Face the mirror directly with shoulders square.',
  'Stand tall with arms relaxed at your sides before starting.',
  'Make sure your head, shoulders, hips, and feet are all visible.',
] as const;

export function resolveCameraPositioningFeedback(pose: PoseResult | null): string | null {
  if (!pose?.landmarks?.length) {
    return 'Step back until your entire body is visible.';
  }

  const visibility = evaluateBodyVisibility(pose.landmarks, pose.frameAspect);
  if (visibility.visible) return null;

  const missing = visibility.missingLandmarks.map((name) => name.toLowerCase());
  if (missing.some((name) => name.includes('ankle') || name.includes('nose'))) {
    return 'Step back until your entire body is visible.';
  }
  if (missing.some((name) => name.includes('hip') || name.includes('shoulder'))) {
    return 'Please move into position so your shoulders and hips are visible.';
  }

  return 'Step back until your entire body is visible.';
}

export function formatCameraSetupSummary(): string {
  return [
    `Distance: ${CAMERA_SETUP.recommendedDistanceMeters.ideal} m (range ${CAMERA_SETUP.recommendedDistanceMeters.min}–${CAMERA_SETUP.recommendedDistanceMeters.max} m)`,
    `Camera height: lens at chest to mid-torso (~${CAMERA_SETUP.recommendedHeightMeters.lensAtChest}–${CAMERA_SETUP.recommendedHeightMeters.lensAtMidTorso} m)`,
    `Resolution target: ${CAMERA_SETUP.preferredResolution.width}×${CAMERA_SETUP.preferredResolution.height}`,
    `Lighting: ${CAMERA_SETUP.lighting}`,
  ].join('\n');
}
