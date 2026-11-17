import type { Point2D } from '../pose/wireframe';
import type { PoseLandmark } from '../types';
import { getLandmark } from '../pose/landmarks';
import {
  canvasDirection,
  clipToCameraImage,
  drawAngleGuide,
  drawDashedLine,
  drawFootLine,
  drawLabel,
  drawSegment,
  formCanvas,
  liveRangeColor,
  midpoint2D,
  tiltLabel,
  type FormCanvas,
  type FormColor,
  type FormDrawOptions,
} from './formOverlayKit';
import type { BodySide, Tilt } from './formCommon';
import type { LungeFormResult } from './lungeForm';
import { distance2D, rayAlong, turnFromUp } from './squatFormOverlay';

const POINTS: Record<BodySide, { shoulder: 'leftShoulder' | 'rightShoulder'; hip: 'leftHip' | 'rightHip'; knee: 'leftKnee' | 'rightKnee'; ankle: 'leftAnkle' | 'rightAnkle' }> = {
  left: { shoulder: 'leftShoulder', hip: 'leftHip', knee: 'leftKnee', ankle: 'leftAnkle' },
  right: { shoulder: 'rightShoulder', hip: 'rightHip', knee: 'rightKnee', ankle: 'rightAnkle' },
};

const ZERO_PROMPT = 'Stand still to zero angles';

/**
 * Side-view lunge guides for the front leg, drawn the way each angle is measured: the thigh
 * against a vertical line through the knee, the shin against a vertical line through the ankle,
 * and the back against the patient's own standing back (a vertical line until the zero is set).
 * With a model picked each is coloured by its verdict while in a rep.
 */
function drawLungeSideOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: FormCanvas,
  landmarks: readonly PoseLandmark[],
  form: LungeFormResult,
): void {
  const frame = form.frame;
  const angles = frame?.side;
  if (!frame || !angles) return;
  const { point, fontPx, lineWidth } = canvas;
  const anchor = getLandmark(landmarks, 'leftHip') ?? getLandmark(landmarks, 'rightHip');
  const up = anchor ? canvasDirection(canvas, anchor, frame.upImage) : { x: 0, y: -1 };
  const bodyRight = anchor
    ? canvasDirection(canvas, anchor, { x: -frame.upImage.y, y: frame.upImage.x })
    : { x: 1, y: 0 };
  const forward = { x: bodyRight.x * angles.facing, y: bodyRight.y * angles.facing };
  const live = form.ranges?.live ?? [];
  const color = (angle: string): FormColor => (form.ranges ? liveRangeColor(live, angle) : 'neutral');

  const lead = POINTS[angles.leadSide];
  const trail = POINTS[angles.leadSide === 'left' ? 'right' : 'left'];
  const hip = point(lead.hip) ?? point(trail.hip);
  const shoulder = point(lead.shoulder) ?? point(trail.shoulder);
  const knee = point(lead.knee);
  const ankle = point(lead.ankle);
  const offset = fontPx * 2.4;

  if (hip && shoulder && angles.back !== undefined) {
    const backColor = color('back');
    const reference = turnFromUp(up, bodyRight, angles.backReference);
    drawAngleGuide(ctx, hip, rayAlong(hip, reference, distance2D(hip, shoulder)), shoulder, backColor, lineWidth);
    drawLabel(ctx, rayAlong(hip, forward, -offset), `${Math.round(angles.back)}°`, backColor, fontPx);
  }
  if (hip && knee && angles.knee !== undefined) {
    const kneeColor = color('knee');
    drawAngleGuide(ctx, knee, rayAlong(knee, up, distance2D(hip, knee)), hip, kneeColor, lineWidth);
    drawLabel(ctx, rayAlong(rayAlong(knee, forward, offset), up, fontPx * 1.2), `${Math.round(angles.knee)}°`, kneeColor, fontPx);
  }
  if (knee && ankle && angles.ankle !== undefined) {
    const ankleColor = color('ankle');
    drawAngleGuide(ctx, ankle, rayAlong(ankle, up, distance2D(knee, ankle)), knee, ankleColor, lineWidth);
    drawLabel(ctx, rayAlong(ankle, forward, offset), `${Math.round(angles.ankle)}°`, ankleColor, fontPx);
  }
  if (!angles.zeroSet) {
    const image = canvas.mapper.frame;
    drawLabel(ctx, { x: image.x + image.width / 2, y: image.y + fontPx * 1.5 }, ZERO_PROMPT, 'neutral', fontPx);
  }
}

/**
 * Dashed reference through the middle of a left–right body line, square to the body's up
 * axis (`up`, a canvas unit vector), with its angle label.
 */
function drawHorizontalReference(
  ctx: CanvasRenderingContext2D,
  canvas: FormCanvas,
  a: Point2D,
  b: Point2D,
  tilt: Tilt,
  up: Point2D,
): void {
  const mid = midpoint2D(a, b);
  const halfSpan = (Math.hypot(a.x - b.x, a.y - b.y) / 2) * 1.35;
  const across = { x: -up.y, y: up.x };
  const from = { x: mid.x - across.x * halfSpan, y: mid.y - across.y * halfSpan };
  const to = { x: mid.x + across.x * halfSpan, y: mid.y + across.y * halfSpan };
  drawDashedLine(ctx, from, to, 'neutral', canvas.lineWidth * 0.7);
  const labelAt = halfSpan + canvas.fontPx * 2.2;
  const right = to.x >= from.x ? 1 : -1;
  drawLabel(
    ctx,
    { x: mid.x + across.x * labelAt * right, y: mid.y + across.y * labelAt * right },
    tiltLabel(tilt),
    'neutral',
    canvas.fontPx,
  );
}

/**
 * Front-view lunge guides: one line from the lead foot's heel along the screen-locked up axis
 * (green while the knee is within the allowed angle, red beyond it), the shoulder and hip line
 * angles against the screen-locked horizontal, and the trunk midline against the screen-locked
 * vertical, which shows the body's inclination.
 */
export function drawLungeFormOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  form: LungeFormResult,
  options: FormDrawOptions = {},
): void {
  const frame = form.frame;
  if (!frame) return;
  const canvas = formCanvas(ctx, landmarks, options);
  const { point, fontPx } = canvas;

  ctx.save();
  clipToCameraImage(ctx, canvas);

  // A model monitors only its own angles in its own view. Facing the other way, the app asks the
  // patient to turn, so no guide is drawn for angles that are not being judged.
  const requiredView = form.ranges?.requiredView ?? null;
  if (requiredView && frame.view !== requiredView) {
    ctx.restore();
    return;
  }

  if (frame.view === 'side') {
    drawLungeSideOverlay(ctx, canvas, landmarks, form);
    ctx.restore();
    return;
  }

  const anchor = getLandmark(landmarks, 'leftHip') ?? getLandmark(landmarks, 'rightHip');
  const up = anchor ? canvasDirection(canvas, anchor, frame.upImage) : { x: 0, y: -1 };

  const line = frame.kneeLine;
  const heel = line ? canvas.mapper.joint(line.heel) : null;
  if (line && heel) {
    const color = line.onLine ? 'good' : 'fault';
    drawFootLine(ctx, canvas, heel, color, canvasDirection(canvas, line.heel, frame.upImage));
    const knee = point(line.side === 'left' ? 'leftKnee' : 'rightKnee');
    if (knee) {
      const side = Math.sign(knee.x - heel.x) || 1;
      drawLabel(ctx, { x: knee.x + side * fontPx * 2.4, y: knee.y }, `${Math.round(line.deviationDeg)}°`, color, fontPx);
    }
  }

  const ls = point('leftShoulder');
  const rs = point('rightShoulder');
  if (ls && rs && frame.shoulderTilt) drawHorizontalReference(ctx, canvas, ls, rs, frame.shoulderTilt, up);
  const lh = point('leftHip');
  const rh = point('rightHip');
  if (lh && rh && frame.pelvisTilt) drawHorizontalReference(ctx, canvas, lh, rh, frame.pelvisTilt, up);
  if (ls && rs && lh && rh && frame.trunkLean) {
    const hipMid = midpoint2D(lh, rh);
    const shoulderMid = midpoint2D(ls, rs);
    const length = Math.hypot(shoulderMid.x - hipMid.x, shoulderMid.y - hipMid.y);
    const vertical = { x: hipMid.x + up.x * length, y: hipMid.y + up.y * length };
    drawAngleGuide(ctx, hipMid, vertical, shoulderMid, 'neutral', canvas.lineWidth);
    drawSegment(ctx, hipMid, shoulderMid, 'neutral', canvas.lineWidth);
    const at = midpoint2D(hipMid, shoulderMid);
    // Across from the shoulder and hip labels, which sit to the right of the body.
    drawLabel(ctx, { x: at.x - fontPx * 3, y: at.y }, tiltLabel(frame.trunkLean), 'neutral', fontPx);
  }

  ctx.restore();
}
