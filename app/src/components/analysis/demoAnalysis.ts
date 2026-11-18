import type { Exercise } from '@vision';
import type { AnalysisResponse } from '../../api/types';
import { EXERCISE_LIBRARY } from '../../exercise/library';
import { normalizeExercise } from '../../exercise/normalizeExercise';

/**
 * A fixed sample result for demos. It opens the mirror results page without a scan,
 * the server or Gemini, and never replaces the patient's own analysis.
 * Mesh names match `public/muscleMap.json`, so the 3D model highlights each muscle.
 */
export const DEMO_ANALYSIS: AnalysisResponse = {
  bodyRegion: 'Upper back and shoulders',
  observedDeformation: 'Rounded shoulders with forward head posture',
  affectedSide: 'right',
  summary:
    'Sample result, not from a scan. The head sits forward of the shoulders, both shoulders roll forward, and the right shoulder rests higher than the left.',
  analysisPossible: true,
  deformities: [
    {
      name: 'Forward head posture',
      region: 'head_neck',
      side: 'midline',
      severity: 0.7,
      description: 'The ear sits well in front of the shoulder line in the side view.',
    },
    {
      name: 'Rounded shoulders',
      region: 'shoulder',
      side: 'bilateral',
      severity: 0.55,
      description: 'Both shoulders roll forward and the upper back rounds.',
    },
    {
      name: 'Raised right shoulder',
      region: 'shoulder',
      side: 'right',
      severity: 0.3,
      description: 'The right shoulder rests slightly higher than the left in the front view.',
    },
  ],
  muscles: [
    {
      name: 'Pectoralis Minor',
      side: 'bilateral',
      likelihood: 0.82,
      deformation: 'shortened',
      intensity: 0.7,
      reason: 'A tight pectoralis minor pulls the shoulder blades forward and down.',
      contributionPercent: 30,
      bodyExplorerMeshNames: ['left_pectoralis_minor', 'right_pectoralis_minor'],
    },
    {
      name: 'Upper Trapezius',
      side: 'right',
      likelihood: 0.74,
      deformation: 'overactive',
      intensity: 0.6,
      reason: 'Holds the right shoulder higher than the left.',
      contributionPercent: 25,
      bodyExplorerMeshNames: ['descending_part_of_right_trapezius'],
    },
    {
      name: 'Sternocleidomastoid',
      side: 'bilateral',
      likelihood: 0.66,
      deformation: 'shortened',
      intensity: 0.5,
      reason: 'Short neck flexors draw the head forward of the shoulders.',
      contributionPercent: 20,
      bodyExplorerMeshNames: ['left_sternocleidomastoid', 'right_sternocleidomastoid'],
    },
    {
      name: 'Rhomboid Major',
      side: 'bilateral',
      likelihood: 0.58,
      deformation: 'lengthened and weak',
      intensity: 0.45,
      reason: 'Weak rhomboids let the shoulder blades drift apart.',
      contributionPercent: 15,
      bodyExplorerMeshNames: ['left_rhomboid_major', 'right_rhomboid_major'],
    },
    {
      name: 'Levator Scapulae',
      side: 'right',
      likelihood: 0.44,
      deformation: 'overactive',
      intensity: 0.35,
      reason: 'Helps lift the right shoulder blade.',
      contributionPercent: 10,
      bodyExplorerMeshNames: ['right_levator_scapulae'],
    },
  ],
};

/** Library exercises shown as the sample plan, so the demo needs no exercise call to the server. */
const DEMO_EXERCISE_IDS = ['library_shoulder_abduction', 'library_deadlift'];

export function demoSuggestedExercises(): Exercise[] {
  return DEMO_EXERCISE_IDS.flatMap((id) => {
    const exercise = EXERCISE_LIBRARY.find((item) => item.id === id);
    return exercise ? [normalizeExercise(exercise)] : [];
  });
}
