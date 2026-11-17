import type { PoseLandmark } from '../types';
import { drawDeadliftFormOverlay } from './deadliftFormOverlay';
import type { ExerciseFormResult } from './exerciseForm';
import type { FormDrawOptions } from './formOverlayKit';
import { drawLungeFormOverlay } from './lungeFormOverlay';
import { drawShoulderFormOverlay } from './shoulderFormOverlay';
import { drawSquatFormOverlay } from './squatFormOverlay';

/** Draw the form guides for whichever exercise produced `form`. */
export function drawExerciseFormOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  form: ExerciseFormResult,
  options: FormDrawOptions = {},
): void {
  switch (form.kind) {
    case 'squat':
      drawSquatFormOverlay(ctx, landmarks, form, options);
      return;
    case 'lunge':
      drawLungeFormOverlay(ctx, landmarks, form, options);
      return;
    case 'deadlift':
      drawDeadliftFormOverlay(ctx, landmarks, form, options);
      return;
    case 'shoulder':
      drawShoulderFormOverlay(ctx, landmarks, form, options);
      return;
    default: {
      const exhaustive: never = form;
      return exhaustive;
    }
  }
}
