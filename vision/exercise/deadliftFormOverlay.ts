import type { Point2D } from '../pose/wireframe';
import { SPINE_CURVE_POINT_COUNT } from '../posture/SpineCurveDetector';
import { UPPER_BACK_LINE_STATIONS } from '../spine/spineTrack';
import type { PoseLandmark } from '../types';
import { DEADLIFT_FAULT_PRIORITY, type DeadliftBackCheck, type DeadliftFormFrame, type DeadliftFormResult } from './deadliftForm';
import {
  canvasDirection,
  clipToCameraImage,
  drawAngleGuide,
  drawDashedLine,
  drawLabel,
  faultColor,
  formCanvas,
  pointAlong,
  FORM_COLORS,
  type FormColor,
  type FormDrawOptions,
} from './formOverlayKit';

/**
 * Positioning hints. A failed outline is not one of these: the hip angle keeps updating,
 * and the patient is not told to move when the shoulders, hips, and knees are already seen.
 */
export const BACK_CHECK_HINTS: Partial<Record<DeadliftBackCheck, string>> = {
  no_silhouette: 'Back check unavailable on this device',
  not_side_on: 'Turn side-on so your back can be checked',
  landmarks_missing: 'Move so your shoulders, hips, and knees stay in view',
};

const BASELINE_HINT = 'Stand side-on and tall to set your baseline';

const ROUNDING_LABEL: Record<(typeof DEADLIFT_FAULT_PRIORITY)[number], string> = {
  possible_upper_back_rounding: 'Possible upper-back rounding',
  possible_lower_back_rounding: 'Possible lower-back rounding',
  possible_combined_rounding: 'Possible upper- and lower-back rounding',
};

/**
 * Deadlift back guide over the wireframe. The spine is eight estimated stations from the pelvis
 * to the neck, joined by a smooth curve: the model's spine keypoints when it has them, otherwise
 * points on the body outline. Those stations are not vertebrae. A sustained warning is worded as
 * a possible change, not an injury. The back angle is how far the trunk has bent from the vertical through the hip.
 * While the back is being read, the keypoint bend is shown in degrees, or the outline's upper-
 * and lower-back estimates with their confidence.
 */
export function drawDeadliftFormOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  form: DeadliftFormResult,
  options: FormDrawOptions = {},
): void {
  const frame = form.frame;
  if (!frame) return;
  const canvas = formCanvas(ctx, landmarks, options);
  const color = faultColor(form.faults, DEADLIFT_FAULT_PRIORITY);
  const width = color === 'good' ? canvas.lineWidth : canvas.lineWidth * 1.45;

  const stations = emphasizeUpperBack(spineCurveOnCanvas(canvas.mapper, frame));
  const curve = withNeck(stations, frame, canvas.mapper);
  let line: Point2D[];
  if (curve.length >= 2) {
    line = curve.map((station) => station.at);
  } else {
    const outline = frame.backEdge
      .map((point) => canvas.mapper.joint(point))
      .filter((point): point is Point2D => point !== null);
    if (outline.length >= 2) {
      line = outline;
    } else {
      const back = frame.back.map((point) => canvas.mapper.joint(point));
      if (back.some((point) => !point)) return;
      const head = frame.head ? canvas.mapper.joint(frame.head) : null;
      line = head ? [...(back as Point2D[]), head] : (back as Point2D[]);
    }
  }

  ctx.save();
  clipToCameraImage(ctx, canvas);
  const hip = canvas.mapper.joint(frame.back[0]!);
  const shoulder = canvas.mapper.joint(frame.back[frame.back.length - 1]!);
  if (hip && shoulder) {
    const up = canvasDirection(canvas, frame.back[0]!, frame.upImage);
    const length = Math.hypot(shoulder.x - hip.x, shoulder.y - hip.y);
    const reference = pointAlong(hip, up, length);
    drawAngleGuide(ctx, hip, reference, shoulder, color, canvas.lineWidth);
    // Behind the hip, clear of the vertical and of the back leaning forward of it.
    const across = { x: -up.y, y: up.x };
    const side = (shoulder.x - hip.x) * across.x + (shoulder.y - hip.y) * across.y;
    const sign = Math.abs(side) > 1e-6 ? -Math.sign(side) : -1;
    const offset = canvas.fontPx * 2.4;
    drawLabel(
      ctx,
      { x: hip.x + across.x * sign * offset, y: hip.y + across.y * sign * offset },
      `${Math.round(frame.backAngleDeg)}°`,
      color,
      canvas.fontPx,
    );
  }
  if (curve.length >= 2) {
    drawSpineCurve(ctx, curve, color, width);
    drawUpperBackLine(ctx, stations, frame, color, canvas.lineWidth);
  } else {
    for (let i = 1; i < line.length; i += 1) {
      drawDashedLine(ctx, line[i - 1]!, line[i]!, color, width);
    }
    ctx.fillStyle = FORM_COLORS[color];
    for (const point of [line[0]!, line[line.length - 1]!]) {
      ctx.beginPath();
      ctx.arc(point.x, point.y, width * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const at = line[Math.floor(line.length / 2)]!;
  const labelAt = { x: at.x, y: at.y - canvas.fontPx * 1.6 };
  const readout = postureReadout(frame, form, color);
  if (readout) drawLabel(ctx, labelAt, readout.text, readout.tone, canvas.fontPx);
  const upper = upperBackReadout(frame, color);
  if (upper && readout) {
    drawLabel(ctx, { x: labelAt.x, y: labelAt.y - canvas.fontPx * 2 }, upper.text, upper.tone, canvas.fontPx);
  }
  ctx.restore();
}

/** The keypoint stations T8, T3 and C7 on the canvas, when all eight stations were placed. */
function upperBackLineStations(stations: readonly CanvasStation[]): [Point2D, Point2D, Point2D] | null {
  if (stations.length !== SPINE_CURVE_POINT_COUNT) return null;
  const [a, b, c] = UPPER_BACK_LINE_STATIONS.map((index) => stations[index]?.at);
  return a && b && c ? [a, b, c] : null;
}

/**
 * A dashed straight line from T8 to C7. T3 sits on it when the upper back is straight, so a bend
 * there shows as the gap between the dot and the line.
 */
function drawUpperBackLine(
  ctx: CanvasRenderingContext2D,
  stations: readonly CanvasStation[],
  frame: DeadliftFormFrame,
  color: FormColor,
  lineWidth: number,
): void {
  if (frame.spineSource !== 'spinepose' || frame.upperBackLineDeg === null) return;
  const line = upperBackLineStations(stations);
  if (!line) return;
  drawDashedLine(ctx, line[0], line[2], frame.upperBackLineBent ? color : 'good', lineWidth * 0.8);
}

/** How far the T8–T3–C7 line has bent past standing, once the back is being judged. */
function upperBackReadout(frame: DeadliftFormFrame, color: FormColor): { text: string; tone: FormColor } | null {
  if (frame.spineSource !== 'spinepose' || frame.backCheck !== 'judged' || frame.calibration !== 'ready') return null;
  if (frame.upperBackLineDeltaDeg === null) return null;
  return {
    text: `Upper back ${Math.round(frame.upperBackLineDeltaDeg)}°`,
    tone: frame.upperBackLineBent ? color : 'good',
  };
}

interface CanvasStation {
  at: Point2D;
  confidence: number;
}

function spineCurveOnCanvas(
  mapper: { joint: (point: { x: number; y: number }) => Point2D | null },
  frame: DeadliftFormFrame,
): CanvasStation[] {
  const stations: CanvasStation[] = [];
  for (const point of frame.spineCurve.points) {
    const at = mapper.joint(point);
    if (at) stations.push({ at, confidence: point.confidence });
  }
  return stations;
}

/**
 * Drawing only: a deadlift rounds up at the shoulders and neck, but the model's stations lie close
 * to straight there, so a bend that matters can look flat. Each station's sideways distance from the
 * hip→neck chord is multiplied by a gain that is 1 through the low back and rises to
 * `UPPER_BACK_DISPLAY_GAIN` by T8. From T8 up the gain is the same for every station, so T8, T3
 * and C7 are drawn in a line exactly when they are measured in a line; only a bend between them is
 * enlarged. Measurements and warnings do not use this.
 */
export const UPPER_BACK_DISPLAY_GAIN = 2.6;
/** Share of the hip→neck length where the extra gain starts. */
const UPPER_BACK_GAIN_FROM = 0.3;
/** Share where the gain reaches its full value: the T8 station. */
const UPPER_BACK_GAIN_FULL = UPPER_BACK_LINE_STATIONS[0] / (SPINE_CURVE_POINT_COUNT - 1);
/** Stations from this share up are drawn heavier, as the upper-back stretch. */
const UPPER_BACK_FROM = 0.55;

function displayGain(t: number): number {
  const x = Math.min(1, Math.max(0, (t - UPPER_BACK_GAIN_FROM) / (UPPER_BACK_GAIN_FULL - UPPER_BACK_GAIN_FROM)));
  const eased = x * x * (3 - 2 * x);
  return 1 + (UPPER_BACK_DISPLAY_GAIN - 1) * eased;
}

export function emphasizeUpperBack(stations: readonly CanvasStation[]): CanvasStation[] {
  if (stations.length < 3) return [...stations];
  const first = stations[0]!.at;
  const last = stations[stations.length - 1]!.at;
  const chordX = last.x - first.x;
  const chordY = last.y - first.y;
  const length = Math.hypot(chordX, chordY);
  if (length < 1e-6) return [...stations];
  const ux = chordX / length;
  const uy = chordY / length;
  return stations.map((station, index) => {
    const t = index / (stations.length - 1);
    const dx = station.at.x - first.x;
    const dy = station.at.y - first.y;
    const along = dx * ux + dy * uy;
    const across = -dx * uy + dy * ux;
    const gain = displayGain(t);
    return {
      ...station,
      at: {
        x: first.x + ux * along - uy * across * gain,
        y: first.y + uy * along + ux * across * gain,
      },
    };
  });
}

/** Carries the line on up the neck to the ear, so a neck that drops forward shows on the curve. */
function withNeck(
  stations: CanvasStation[],
  frame: DeadliftFormFrame,
  mapper: { joint: (point: { x: number; y: number }) => Point2D | null },
): CanvasStation[] {
  if (stations.length < 2 || !frame.head) return stations;
  const head = mapper.joint(frame.head);
  if (!head) return stations;
  return [...stations, { at: head, confidence: 1 }];
}

/** Catmull-Rom samples so the eight stations read as one curve, not a polyline of straight chords. */
function smoothSpine(points: readonly Point2D[], samplesPerSpan = 6): Point2D[] {
  if (points.length < 3) return [...points];
  const out: Point2D[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p1 = points[i]!;
    const p2 = points[i + 1]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let step = 0; step < samplesPerSpan; step += 1) {
      const t = step / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push({
        x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  out.push(points[points.length - 1]!);
  return out;
}

function drawSpineCurve(
  ctx: CanvasRenderingContext2D,
  stations: readonly CanvasStation[],
  color: FormColor,
  width: number,
): void {
  const path = smoothSpine(stations.map((station) => station.at));
  // The upper-back and neck stretch is drawn heavier than the low back.
  const heavyFrom = Math.floor(path.length * UPPER_BACK_FROM);
  ctx.strokeStyle = FORM_COLORS[color];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [from, to, scale] of [
    [0, heavyFrom, 1],
    [Math.max(0, heavyFrom - 1), path.length - 1, 1.6],
  ] as const) {
    ctx.beginPath();
    ctx.moveTo(path[from]!.x, path[from]!.y);
    for (let i = from + 1; i <= to; i += 1) ctx.lineTo(path[i]!.x, path[i]!.y);
    ctx.lineWidth = width * scale;
    ctx.stroke();
  }
  ctx.fillStyle = FORM_COLORS[color];
  stations.forEach((station, index) => {
    const upper = index / (stations.length - 1) >= UPPER_BACK_FROM;
    ctx.globalAlpha = 0.45 + 0.55 * Math.max(0, Math.min(1, station.confidence));
    ctx.beginPath();
    ctx.arc(station.at.x, station.at.y, width * (1.3 + station.confidence) * (upper ? 1.35 : 1), 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
}

function postureReadout(
  frame: DeadliftFormFrame,
  form: DeadliftFormResult,
  color: FormColor,
): { text: string; tone: FormColor } | null {
  const sustained = form.faults.find((fault) => fault.sustained);
  if (sustained) return { text: ROUNDING_LABEL[sustained.code], tone: 'fault' };
  const hint = BACK_CHECK_HINTS[frame.backCheck];
  if (hint) return { text: hint, tone: 'pending' };
  if (frame.backCheck === 'judged' && frame.calibration !== 'ready') {
    return { text: BASELINE_HINT, tone: 'pending' };
  }
  if (frame.classification === 'insufficient_tracking' && frame.backCheck === 'judged') {
    return { text: 'Tracking is not steady enough to judge your back', tone: 'pending' };
  }
  if (frame.backCheck !== 'judged') return null;
  return { text: estimateText(frame), tone: color };
}

function estimateText(frame: DeadliftFormFrame): string {
  // Degrees above the person's own standing spine, read from the keypoints.
  if (frame.spineBendDeltaDeg !== null && frame.spineBendDeltaDeg !== undefined) {
    return `Spine bend ${Math.round(frame.spineBendDeltaDeg)}°`;
  }
  return `${regionText('Upper', frame.thoracic)} · ${regionText('Lower', frame.lumbar)}`;
}

function regionText(name: string, region: DeadliftFormFrame['thoracic']): string {
  const amount = region.sagitta === null ? '–' : `${Math.round(region.sagitta * 100)}%`;
  return `${name} ${amount} (${region.confidence.toFixed(1)})`;
}
