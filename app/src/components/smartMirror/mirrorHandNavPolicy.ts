import type { WorkflowStage } from '../../workflow/types';

const MIRROR_KIOSK_STAGES: ReadonlySet<WorkflowStage> = new Set([
  'mirror_home',
  'mirror_analysis',
  'mirror_uploading',
  'mirror_processing',
  'mirror_results',
  'mirror_demo_results',
  'mirror_exercise_plan',
  'mirror_exercise_session',
  'games_placeholder',
  // Failure screen (Retry / Home) shown when analysis or upload fails.
  'error',
]);

/** Full-body games own the camera, and their arm movements would steer the hand pointer. */
const MIRROR_GAME_STAGES: ReadonlySet<WorkflowStage> = new Set(['balance_bird_game', 'bowling_game', 'rehab_games']);

export function isMirrorGameStage(stage: WorkflowStage): boolean {
  return MIRROR_GAME_STAGES.has(stage);
}

/**
 * Whether fist/point hand navigation should run for the mirror kiosk flow.
 */
export function isMirrorHandNavEnabled(
  stage: WorkflowStage,
  analysisCaptureActive: boolean,
): boolean {
  if (isMirrorGameStage(stage)) return false;
  if (!MIRROR_KIOSK_STAGES.has(stage)) return false;
  if (stage === 'mirror_analysis' && analysisCaptureActive) return false;
  return true;
}
