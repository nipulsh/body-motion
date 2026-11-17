import { getLandmark, type PoseLandmarkName } from '../pose/landmarks';
import type { Point2D } from '../pose/wireframe';
import type { PoseLandmark } from '../types';
import type { BodySide } from './formCommon';
import {
  canvasDirection,
  clipToCameraImage,
  drawAngleGuide,
  drawFootLine,
  drawJointArc,
  drawLabel,
  drawSegment,
  faultColor,
  formCanvas,
  liveRangeColor,
  midpoint2D,
  tiltLabel,
  type FormDrawOptions,
} from './formOverlayKit';
import type { FormColor } from './formOverlayKit';
import type { SquatFaultCode, SquatFormResult } from './squatForm';

const KNEE_FAULTS: Record<BodySide, readonly SquatFaultCode[]> = {
  left: ['left_knee_inward', 'left_knee_outward', 'knee_past_toes'],
  right: ['right_knee_inward', 'right_knee_outward', 'knee_past_toes'],
};

const SIDE_POINTS: Record<
  BodySide,
  {
    shoulder: PoseLandmarkName;
    hip: PoseLandmarkName;
    knee: PoseLandmarkName;
    ankle: PoseLandmarkName;
    heel: PoseLandmarkName;
    toe: PoseLandmarkName;
  }
> = {
  left: {
    shoulder: 'leftShoulder',
    hip: 'leftHip',
    knee: 'leftKnee',
    ankle: 'leftAnkle',
    heel: 'leftHeel',
    toe: 'leftFootIndex',
  },
  right: {
    shoulder: 'rightShoulder',
    hip: 'rightHip',
    knee: 'rightKnee',
    ankle: 'rightAnkle',
    heel: 'rightHeel',
    toe: 'rightFootIndex',
  },
};

const ZERO_PROMPT = 'Stand still to zero angles';

/** Point `length` pixels from `from` along the canvas unit vector `direction`. */
export function rayAlong(from: Point2D, direction: Point2D, length: number): Point2D {
  return { x: from.x + direction.x * length, y: from.y + direction.y * length };
}

export function distance2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Canvas unit vector `deg` away from `up` toward `right`, counted as `signedFromVerticalDeg` counts
 * a lean. Both are canvas images of the camera-plane axes, so a mirrored canvas turns the right way.
 */
export function turnFromUp(up: Point2D, right: Point2D, deg: number): Point2D {
  const rad = (deg * Math.PI) / 180;
  const x = up.x * Math.cos(rad) + right.x * Math.sin(rad);
  const y = up.y * Math.cos(rad) + right.y * Math.sin(rad);
  const length = Math.hypot(x, y);
  return length > 1e-9 ? { x: x / length, y: y / length } : up;
}

/**
 * Squat guides over the camera image: a dashed line rising from each heel with the knee's angle
 * off it, joint angles, and trunk/shoulder/pelvis tilt. Side view draws how each angle is
 * measured: the back against the patient's own standing back (a vertical line through the hip
 * until the standing zero is set), and the knee as the femur against a vertical line through the
 * knee, so a straight leg closes the arc to nothing.
 * The other reference lines follow the screen-locked axis, so they are square to the screen edges.
 * The numbers are measured from the patient's standing pose; until it is set, the patient is asked
 * to stand still. Green is on target, amber is drifting, red has been off for over the sustain time.
 */
export function drawSquatFormOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  form: SquatFormResult,
  options: FormDrawOptions = {},
): void {
  const frame = form.frame;
  if (!frame) return;
  const canvas = formCanvas(ctx, landmarks, options);
  const { fontPx, lineWidth, point } = canvas;

  ctx.save();
  clipToCameraImage(ctx, canvas);

  // The image → canvas mapping is linear, so one direction serves every guide.
  const anchor = getLandmark(landmarks, 'leftHip') ?? getLandmark(landmarks, 'rightHip');
  const up = anchor ? canvasDirection(canvas, anchor, frame.upImage) : { x: 0, y: -1 };
  // Body-right of the camera-plane up axis, which is what a positive lean leans toward. The axis is
  // locked to the screen edges, so its image direction is a quarter turn of `upImage`.
  const bodyRight = anchor
    ? canvasDirection(canvas, anchor, { x: -frame.upImage.y, y: frame.upImage.x })
    : { x: 1, y: 0 };
  const upFrom = (origin: Point2D) => canvasDirection(canvas, origin, frame.upImage);
  // With a model picked its verdicts colour the judged angles; the rest of the guides stay neutral.
  const ranges = form.ranges ?? null;
  // A model monitors only its own angles in its own view. Facing the other way, the app asks the
  // patient to turn, so no guide is drawn for angles that are not being judged.
  if (ranges?.requiredView && frame.view !== ranges.requiredView) {
    ctx.restore();
    return;
  }
  // Side on with a model, only the thigh and back are judged: the heel line and its angle are not drawn.
  const modelSide = ranges !== null && frame.view === 'side';
  const rangeColor = (angle: string, side?: BodySide): FormColor | null =>
    ranges ? liveRangeColor(ranges.live, angle, side) : null;
  for (const line of modelSide ? [] : frame.kneeLines) {
    const heel = line.heel ? canvas.mapper.joint(line.heel) : null;
    if (!line.heel || !heel) continue;
    const modelColor = frame.view === 'front' ? rangeColor('tibia', line.side) : ranges ? 'neutral' : null;
    drawFootLine(
      ctx,
      canvas,
      heel,
      modelColor ?? faultColor(form.faults, line.fault ? [line.fault] : KNEE_FAULTS[line.side]),
      upFrom(line.heel),
    );
  }

  const labelOffset = fontPx * 2.4;
  const across = { x: -up.y, y: up.x };
  for (const side of ['left', 'right'] as const) {
    const names = SIDE_POINTS[side];
    const kneeAngle = frame.kneeAngle[side];
    const knee = point(names.knee);
    const hip = point(names.hip);
    const ankle = point(names.ankle);
    const heel = point(names.heel);
    const toe = point(names.toe);
    const kneeColor = (frame.view === 'side' ? rangeColor('knee') : ranges ? 'neutral' : null) ?? faultColor(form.faults, KNEE_FAULTS[side]);
    const backColor = rangeColor('back') ?? faultColor(form.faults, ['chest_dropping']);
    // Side on, labels sit clear of the guides: the way the patient faces is +1 along `across`.
    const facing =
      toe && ankle ? ((toe.x - ankle.x) * across.x + (toe.y - ankle.y) * across.y >= 0 ? 1 : -1) : 1;
    // Front on, each leg's labels sit outside it, away from the other knee.
    const otherKnee = frame.view === 'front' ? point(SIDE_POINTS[side === 'left' ? 'right' : 'left'].knee) : null;
    const outward = otherKnee && knee ? Math.sign(knee.x - otherKnee.x) || 1 : 1;

    if (frame.view === 'side' && kneeAngle !== undefined) {
      const shoulder = point(names.shoulder);
      if (frame.backAngle[side] !== undefined && hip && shoulder) {
        // 0° is the back the patient stands with, so standing puts the back on this line.
        const reference = turnFromUp(up, bodyRight, frame.backReference[side] ?? 0);
        drawAngleGuide(ctx, hip, rayAlong(hip, reference, distance2D(hip, shoulder)), shoulder, backColor, lineWidth);
      }
      if (hip && knee) {
        drawAngleGuide(ctx, knee, rayAlong(knee, up, distance2D(hip, knee)), hip, kneeColor, lineWidth);
      }
    }

    // Face on with a model, the tibia is shown as the model judges it: signed true geometry,
    // positive with the knee outside the heel line, against the range for the foot's toe-out.
    const tibia = ranges && frame.view === 'front' ? frame.tibiaAngle[side] : undefined;
    const kneeHeelAngle = modelSide ? undefined : (tibia ?? frame.kneeHeelAngle[side]);
    if (kneeHeelAngle !== undefined && heel && knee) {
      const heelColor = tibia !== undefined ? (rangeColor('tibia', side) ?? 'neutral') : ranges ? 'neutral' : kneeColor;
      drawSegment(ctx, heel, knee, heelColor, lineWidth);
      drawJointArc(ctx, heel, rayAlong(heel, up, distance2D(heel, knee)), knee, heelColor, lineWidth);
      const mid = midpoint2D(heel, knee);
      const away = frame.view === 'side' ? rayAlong(mid, across, -facing * labelOffset) : { x: mid.x + outward * labelOffset, y: mid.y };
      drawLabel(ctx, away, `${Math.round(kneeHeelAngle)}°`, heelColor, fontPx);
    }
    const toeOut = ranges && frame.view === 'front' ? (ranges.toeOut[side] ?? frame.toeOut[side]) : undefined;
    if (toeOut !== undefined && heel) {
      // Under the foot, outside it: the toe-out the tibia range was picked by.
      drawLabel(ctx, { x: heel.x + outward * labelOffset, y: heel.y + fontPx * 1.8 }, `Toe ${Math.round(toeOut)}°`, 'neutral', fontPx);
    }

    if (kneeAngle !== undefined && knee) {
      // Side on, the label sits ahead of and above the knee, clear of the vertical line and the femur.
      const at =
        frame.view === 'side'
          ? rayAlong(rayAlong(knee, across, facing * labelOffset), up, fontPx * 1.2)
          : { x: knee.x + outward * labelOffset, y: knee.y };
      drawLabel(ctx, at, `${Math.round(kneeAngle)}°`, kneeColor, fontPx);
    }
    const backAngle = frame.backAngle[side];
    if (backAngle !== undefined && hip) {
      // Behind the hip, clear of the vertical line and the back leaning forward of it.
      drawLabel(ctx, rayAlong(hip, across, -facing * labelOffset), `${Math.round(backAngle)}°`, backColor, fontPx);
    }
  }

  if (frame.view === 'front') {
    // Central lines: eye line, shoulder line, trunk midline and hip line, each in its own fault colour.
    const le = point('leftEye');
    const re = point('rightEye');
    const ls = point('leftShoulder');
    const rs = point('rightShoulder');
    const lh = point('leftHip');
    const rh = point('rightHip');
    const shoulderMid = ls && rs ? midpoint2D(ls, rs) : null;
    const hipMid = lh && rh ? midpoint2D(lh, rh) : null;
    const sideLabelX = (a: Point2D, b: Point2D) => Math.max(a.x, b.x) + labelOffset * 1.2;

    if (le && re && frame.eyeTilt) {
      drawSegment(ctx, le, re, 'neutral', lineWidth);
      drawLabel(ctx, { x: sideLabelX(le, re), y: midpoint2D(le, re).y }, tiltLabel(frame.eyeTilt), 'neutral', fontPx);
    }
    if (ls && rs && shoulderMid && frame.shoulderTilt) {
      const color = faultColor(form.faults, ['shoulders_uneven']);
      drawSegment(ctx, ls, rs, color, lineWidth);
      drawLabel(ctx, { x: sideLabelX(ls, rs), y: shoulderMid.y }, tiltLabel(frame.shoulderTilt), color, fontPx);
    }
    if (shoulderMid && hipMid) {
      const color = faultColor(form.faults, ['trunk_leaning_sideways']);
      drawSegment(ctx, hipMid, shoulderMid, color, lineWidth);
      if (frame.trunkSideLean) {
        const at = midpoint2D(shoulderMid, hipMid);
        drawLabel(ctx, { x: at.x - labelOffset * 1.2, y: at.y }, tiltLabel(frame.trunkSideLean), color, fontPx);
      }
    }
    if (lh && rh && hipMid && frame.pelvisTilt) {
      const color = faultColor(form.faults, ['hips_uneven']);
      drawSegment(ctx, lh, rh, color, lineWidth);
      drawLabel(ctx, { x: sideLabelX(lh, rh), y: hipMid.y }, tiltLabel(frame.pelvisTilt), color, fontPx);
    }
  }

  if (!frame.zeroSet) {
    const image = canvas.mapper.frame;
    drawLabel(ctx, { x: image.x + image.width / 2, y: image.y + fontPx * 1.5 }, ZERO_PROMPT, 'neutral', fontPx);
  }

  ctx.restore();
}
