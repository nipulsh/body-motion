import { getLandmark } from '../pose/landmarks';
import type { PoseLandmark } from '../types';
import {
  canvasDirection,
  clipToCameraImage,
  drawAngleGuide,
  drawLabel,
  formCanvas,
  type FormDrawOptions,
} from './formOverlayKit';
import type { ShoulderFormResult } from './shoulderForm';

const ZERO_PROMPT = 'Hold your arms down to zero angles';

const POINTS = {
  left: { shoulder: 'leftShoulder', elbow: 'leftElbow', other: 'rightShoulder' },
  right: { shoulder: 'rightShoulder', elbow: 'rightElbow', other: 'leftShoulder' },
} as const;

/**
 * Shoulder raise guides over the camera image: a dashed line straight down from each shoulder, an
 * arc from it to the arm, and how far that arm has risen. Each number starts at 0° with the arm
 * down and grows as the hand goes up. Until the resting position is set, the patient is asked for it.
 */
export function drawShoulderFormOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  form: ShoulderFormResult,
  options: FormDrawOptions = {},
): void {
  const frame = form.frame;
  if (!frame) return;
  const canvas = formCanvas(ctx, landmarks, options);
  const { fontPx, lineWidth, point } = canvas;

  ctx.save();
  clipToCameraImage(ctx, canvas);

  const labelOffset = fontPx * 2.4;
  // The image → canvas mapping is linear, so one direction serves every guide.
  const anchor = getLandmark(landmarks, 'leftShoulder') ?? getLandmark(landmarks, 'rightShoulder');
  const up = anchor ? canvasDirection(canvas, anchor, frame.upImage) : { x: 0, y: -1 };
  for (const side of ['left', 'right'] as const) {
    const angle = frame.armAngle[side];
    const names = POINTS[side];
    const shoulder = point(names.shoulder);
    if (angle === undefined || !shoulder) continue;
    const elbow = point(names.elbow);
    if (elbow) {
      const length = Math.hypot(elbow.x - shoulder.x, elbow.y - shoulder.y);
      const down = { x: shoulder.x - up.x * length, y: shoulder.y - up.y * length };
      drawAngleGuide(ctx, shoulder, down, elbow, 'neutral', lineWidth);
    }
    // Outside the body, away from the other shoulder.
    const other = point(names.other);
    const outward = other ? Math.sign(shoulder.x - other.x) || 1 : 1;
    drawLabel(
      ctx,
      { x: shoulder.x + outward * labelOffset, y: shoulder.y + up.y * fontPx * 1.2 },
      `${Math.round(angle)}°`,
      'neutral',
      fontPx,
    );
  }

  if (!frame.zeroSet) {
    const image = canvas.mapper.frame;
    drawLabel(ctx, { x: image.x + image.width / 2, y: image.y + fontPx * 1.5 }, ZERO_PROMPT, 'neutral', fontPx);
  }

  ctx.restore();
}
