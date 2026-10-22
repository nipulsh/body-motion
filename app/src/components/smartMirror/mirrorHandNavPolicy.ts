import type { WorkflowStage } from '../../workflow/types';

const MIRROR_KIOSK_STAGES: ReadonlySet<WorkflowStage> = new Set([
  'mirror_home',
  'mirror_analysis',
  'mirror_uploading',
  'mirror_processing',
  'mirror_results',
  'mirror_exercise_plan',
  'mirror_exercise_session',
  'games_placeholder',
]);

/**
 * Whether fist/point hand navigation should run for the mirror kiosk flow.
 */
export function isMirrorHandNavEnabled(
  stage: WorkflowStage,
  analysisCaptureActive: boolean,
): boolean {
  if (stage === 'balance_bird_game') return false;
  if (!MIRROR_KIOSK_STAGES.has(stage)) return false;
  if (stage === 'mirror_analysis' && analysisCaptureActive) return false;
  return true;
}
