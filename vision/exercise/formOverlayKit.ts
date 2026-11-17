import { getLandmark, type PoseLandmarkName } from '../pose/landmarks';
import {
  createWireframeMapper,
  type Point2D,
  type WireframeDrawOptions,
  type WireframeMapper,
} from '../pose/wireframe';
import type { PoseLandmark } from '../types';
import type { BodySide, FaultStatus, Tilt } from './formCommon';

export const FORM_COLORS = {
  good: 'rgba(52, 211, 153, 0.95)',
  pending: 'rgba(251, 191, 36, 0.95)',
  fault: 'rgba(248, 113, 113, 0.98)',
  neutral: 'rgba(96, 210, 255, 0.95)',
  guide: 'rgba(245, 166, 35, 0.95)',
  label: 'rgba(15, 23, 42, 0.82)',
  text: 'rgba(255, 255, 255, 0.98)',
} as const;

export type FormColor = 'good' | 'pending' | 'fault' | 'neutral' | 'guide';

export type FormDrawOptions = Pick<WireframeDrawOptions, 'fit' | 'sourceWidth' | 'sourceHeight' | 'mirrorX'> & {
  fontPx?: number;
  lineWidth?: number;
};

export interface FormCanvas {
  mapper: WireframeMapper;
  fontPx: number;
  lineWidth: number;
  /** Canvas point of a pose landmark, or null when it is off the camera image. */
  point(name: PoseLandmarkName): Point2D | null;
}

export function formCanvas(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  options: FormDrawOptions,
): FormCanvas {
  const { width, height } = ctx.canvas;
  const mapper = createWireframeMapper(width, height, options);
  return {
    mapper,
    fontPx: options.fontPx ?? Math.max(11, Math.round(Math.min(width, height) * 0.028)),
    lineWidth: options.lineWidth ?? 3,
    point: (name) => {
      const lm = getLandmark(landmarks, name);
      return lm ? mapper.joint(lm) : null;
    },
  };
}

/** Red once any of `codes` is held, amber while one is building up, green otherwise. */
export function faultColor<Code extends string>(
  faults: readonly FaultStatus<Code>[],
  codes: readonly Code[],
): FormColor {
  let color: FormColor = 'good';
  for (const status of faults) {
    if (!codes.includes(status.code)) continue;
    if (status.sustained) return 'fault';
    color = 'pending';
  }
  return color;
}

/** A squat or lunge model's verdict as a colour: green correct, amber borderline, red incorrect. */
export function verdictColor(verdict: 'correct' | 'borderline' | 'incorrect'): FormColor {
  if (verdict === 'correct') return 'good';
  return verdict === 'borderline' ? 'pending' : 'fault';
}

/**
 * Colour of a model-judged angle this frame: its verdict while in a rep, neutral while standing
 * or when the model does not judge it in this view.
 */
export function liveRangeColor(
  live: readonly { angle: string; side?: BodySide; verdict: 'correct' | 'borderline' | 'incorrect' }[],
  angle: string,
  side?: BodySide,
): FormColor {
  const item = live.find((entry) => entry.angle === angle && (side === undefined || entry.side === side));
  return item ? verdictColor(item.verdict) : 'neutral';
}

export function tiltLabel(tilt: Tilt): string {
  const side: Record<BodySide, string> = { left: 'L', right: 'R' };
  return `${Math.round(tilt.deg)}° ${side[tilt.toward]}`;
}

export function midpoint2D(a: Point2D, b: Point2D): Point2D {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function drawLabel(
  ctx: CanvasRenderingContext2D,
  at: Point2D,
  text: string,
  color: FormColor,
  fontPx: number,
): void {
  ctx.font = `600 ${fontPx}px system-ui, sans-serif`;
  const padX = fontPx * 0.45;
  const height = fontPx * 1.5;
  const width = ctx.measureText(text).width + padX * 2;
  ctx.fillStyle = FORM_COLORS.label;
  ctx.strokeStyle = FORM_COLORS[color];
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(at.x - width / 2, at.y - height / 2, width, height, height / 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = FORM_COLORS.text;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y + 1);
}

export function drawSegment(ctx: CanvasRenderingContext2D, a: Point2D, b: Point2D, color: FormColor, lineWidth: number): void {
  ctx.strokeStyle = FORM_COLORS[color];
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
}

export function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  from: Point2D,
  to: Point2D,
  color: FormColor,
  lineWidth: number,
): void {
  ctx.strokeStyle = FORM_COLORS[color];
  ctx.lineWidth = lineWidth;
  ctx.setLineDash([lineWidth * 3, lineWidth * 2.5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Arc at `vertex` sweeping the short way from the ray toward `a` to the ray toward `b`. */
export function drawJointArc(
  ctx: CanvasRenderingContext2D,
  vertex: Point2D,
  a: Point2D,
  b: Point2D,
  color: FormColor,
  lineWidth: number,
): void {
  const from = Math.atan2(a.y - vertex.y, a.x - vertex.x);
  const to = Math.atan2(b.y - vertex.y, b.x - vertex.x);
  let sweep = to - from;
  while (sweep > Math.PI) sweep -= Math.PI * 2;
  while (sweep < -Math.PI) sweep += Math.PI * 2;
  const radius = Math.min(Math.hypot(a.x - vertex.x, a.y - vertex.y), Math.hypot(b.x - vertex.x, b.y - vertex.y)) * 0.35;
  ctx.strokeStyle = FORM_COLORS[color];
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(vertex.x, vertex.y, radius, from, from + sweep, sweep < 0);
  ctx.stroke();
}

/**
 * Angle guide at `vertex`: a dashed reference ray toward `reference`, and an arc
 * sweeping the short way from that ray to the solid segment toward `limb`.
 */
export function drawAngleGuide(
  ctx: CanvasRenderingContext2D,
  vertex: Point2D,
  reference: Point2D,
  limb: Point2D,
  color: FormColor,
  lineWidth: number,
): void {
  drawDashedLine(ctx, vertex, reference, color, Math.max(1.5, lineWidth * 0.75));
  drawJointArc(ctx, vertex, reference, limb, color, lineWidth);
}

/**
 * Canvas point `length` from `vertex` along the horizontal reference (square to `up`, a canvas
 * unit vector), on the side `toward` lies; on the `fallback` side (+1 body-right, −1 body-left)
 * when `toward` is straight along `up`.
 */
export function horizontalReferenceEnd(
  vertex: Point2D,
  toward: Point2D,
  up: Point2D,
  length: number,
  fallback: 1 | -1 = 1,
): Point2D {
  const across = { x: -up.y, y: up.x };
  const side = (toward.x - vertex.x) * across.x + (toward.y - vertex.y) * across.y;
  const sign = Math.abs(side) > 1e-6 ? Math.sign(side) : fallback;
  return { x: vertex.x + across.x * sign * length, y: vertex.y + across.y * sign * length };
}

/**
 * Canvas unit vector for a body axis given in normalized image coordinates (see `upImage`).
 * Mapping a short step from `origin` keeps mirroring and reflection projections exact.
 * Falls back to screen up when the axis cannot be mapped.
 */
export function canvasDirection(
  canvas: FormCanvas,
  origin: Point2D,
  directionImage: Point2D | undefined,
): Point2D {
  const screenUp = { x: 0, y: -1 };
  if (!directionImage) return screenUp;
  const step = 0.01;
  const tryMap = (sign: 1 | -1): Point2D | null => {
    const a = canvas.mapper.joint(origin);
    const b = canvas.mapper.joint({
      x: origin.x + directionImage.x * step * sign,
      y: origin.y + directionImage.y * step * sign,
    });
    if (!a || !b) return null;
    const dx = (b.x - a.x) * sign;
    const dy = (b.y - a.y) * sign;
    const length = Math.hypot(dx, dy);
    return length > 1e-6 ? { x: dx / length, y: dy / length } : null;
  };
  return tryMap(1) ?? tryMap(-1) ?? screenUp;
}

/** Point `length` canvas pixels from `from` along `direction`. */
export function pointAlong(from: Point2D, direction: Point2D, length: number): Point2D {
  return { x: from.x + direction.x * length, y: from.y + direction.y * length };
}

/**
 * Dashed reference line from a point on the foot (the heel in a squat, the toe in a lunge) along
 * the body's up axis to the edge of the camera image. `up` is a canvas unit vector (screen up when omitted).
 */
export function drawFootLine(
  ctx: CanvasRenderingContext2D,
  canvas: FormCanvas,
  foot: Point2D,
  color: FormColor,
  up: Point2D = { x: 0, y: -1 },
): void {
  const { frame } = canvas.mapper;
  const reach = Math.hypot(frame.width, frame.height);
  drawDashedLine(ctx, foot, pointAlong(foot, up, reach), color, canvas.lineWidth);
  ctx.fillStyle = FORM_COLORS[color];
  ctx.beginPath();
  ctx.arc(foot.x, foot.y, canvas.lineWidth * 1.6, 0, Math.PI * 2);
  ctx.fill();
}

export function clipToCameraImage(ctx: CanvasRenderingContext2D, canvas: FormCanvas): void {
  const { frame } = canvas.mapper;
  ctx.beginPath();
  ctx.rect(frame.x, frame.y, frame.width, frame.height);
  ctx.clip();
}
