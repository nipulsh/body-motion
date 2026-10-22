import type { PoseLandmark } from '../types';
import { getLandmark, type PoseLandmarkName } from './landmarks';

export interface Point2D {
  x: number;
  y: number;
}

export type WireframeSegment = readonly [PoseLandmarkName, PoseLandmarkName];

/**
 * Body lines. Arms follow MediaPipe pose indices:
 * shoulder 11/12 → elbow 13/14 → wrist 15/16, then the pose hand
 * (pinky 17/18, index 19/20, thumb 21/22) so the limb reaches the hand.
 * Face landmarks stay as joints and are not connected.
 */
export const WIREFRAME_SEGMENTS: readonly WireframeSegment[] = [
  ['leftHip', 'leftShoulder'],
  ['leftElbow', 'leftShoulder'],
  ['leftElbow', 'leftWrist'],
  ['leftWrist', 'leftPinky'],
  ['leftWrist', 'leftIndex'],
  ['leftWrist', 'leftThumb'],
  ['leftPinky', 'leftIndex'],
  ['leftHip', 'leftKnee'],
  ['leftKnee', 'leftAnkle'],
  ['rightHip', 'rightShoulder'],
  ['rightElbow', 'rightShoulder'],
  ['rightElbow', 'rightWrist'],
  ['rightWrist', 'rightPinky'],
  ['rightWrist', 'rightIndex'],
  ['rightWrist', 'rightThumb'],
  ['rightPinky', 'rightIndex'],
  ['rightHip', 'rightKnee'],
  ['rightKnee', 'rightAnkle'],
  ['leftShoulder', 'rightShoulder'],
  ['leftHip', 'rightHip'],
] as const;

/**
 * Wrist and pose-hand points are often scored well below the torso threshold
 * even when the model placed them. Any positive visibility or presence draws
 * them. A missing landmark is not invented.
 */
const DISTAL_ARM_LANDMARKS: ReadonlySet<PoseLandmarkName> = new Set([
  'leftWrist',
  'rightWrist',
  'leftPinky',
  'rightPinky',
  'leftIndex',
  'rightIndex',
  'leftThumb',
  'rightThumb',
]);

/** Draw parts PoseNet still shows when confidence is only moderate. Angle math keeps its own gate. */
export const WIREFRAME_MIN_VISIBILITY = 0.2;

/** Full confidence uses `jointRadius`. Dimmer landmarks draw smaller, like PoseNet's `10 * score`. */
export function jointRadiusForVisibility(jointRadius: number, visibility: number): number {
  return jointRadius * visibility;
}

export const WIREFRAME_JOINTS: readonly PoseLandmarkName[] = [
  'nose',
  'leftEye',
  'rightEye',
  'leftEar',
  'rightEar',
  'leftShoulder',
  'rightShoulder',
  'leftElbow',
  'rightElbow',
  'leftWrist',
  'rightWrist',
  'leftPinky',
  'rightPinky',
  'leftIndex',
  'rightIndex',
  'leftThumb',
  'rightThumb',
  'leftHip',
  'rightHip',
  'leftKnee',
  'rightKnee',
  'leftAnkle',
  'rightAnkle',
];

export function landmarkToCanvasPoint(
  landmark: PoseLandmark,
  width: number,
  height: number,
): Point2D {
  return {
    x: landmark.x * width,
    y: landmark.y * height,
  };
}

/**
 * Letterbox a normalized image-space landmark into the canvas.
 * The camera frame stays centered and keeps its aspect ratio.
 * `mirrorX` flips image-left/right so the skeleton matches a mirrored preview.
 * Detection still uses the raw camera frame; only the drawing is flipped.
 */
/** Map normalized image coordinates into a letterboxed (object-contain) viewport. */
export function mapNormalizedToContainCanvas(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  mirrorX = false,
): Point2D {
  return fitLandmarkToCanvas({ x, y }, canvasWidth, canvasHeight, sourceWidth, sourceHeight, mirrorX);
}

export function fitLandmarkToCanvas(
  landmark: Pick<PoseLandmark, 'x' | 'y'>,
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
  mirrorX = false,
): Point2D {
  const xNorm = mirrorX ? 1 - landmark.x : landmark.x;
  const yNorm = landmark.y;
  if (sourceWidth <= 0 || sourceHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: xNorm * canvasWidth, y: yNorm * canvasHeight };
  }

  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  let drawWidth: number;
  let drawHeight: number;
  let offsetX: number;
  let offsetY: number;

  if (sourceAspect > canvasAspect) {
    drawWidth = canvasWidth;
    drawHeight = canvasWidth / sourceAspect;
    offsetX = 0;
    offsetY = (canvasHeight - drawHeight) / 2;
  } else {
    drawHeight = canvasHeight;
    drawWidth = canvasHeight * sourceAspect;
    offsetX = (canvasWidth - drawWidth) / 2;
    offsetY = 0;
  }

  return {
    x: offsetX + xNorm * drawWidth,
    y: offsetY + yNorm * drawHeight,
  };
}

function landmarkScore(landmark: PoseLandmark): number {
  const presence = landmark.presence;
  return Math.max(landmark.visibility, typeof presence === 'number' ? presence : 0);
}

export function isLandmarkVisible(
  landmark: PoseLandmark | undefined,
  minVisibility: number,
  name?: PoseLandmarkName,
): boolean {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
  const score = landmarkScore(landmark);
  if (name && DISTAL_ARM_LANDMARKS.has(name)) return score > 0;
  return score >= minVisibility;
}

/** Map a normalized landmark with the same fit and mirror rules as the body wireframe. */
export function toWireframePoint(
  landmark: Pick<PoseLandmark, 'x' | 'y'>,
  canvasWidth: number,
  canvasHeight: number,
  options?: WireframeDrawOptions,
): Point2D {
  const mirrorX = options?.mirrorX ?? false;
  const sourceWidth = options?.sourceWidth ?? 0;
  const sourceHeight = options?.sourceHeight ?? 0;
  const useContain = options?.fit === 'contain' && sourceWidth > 0 && sourceHeight > 0;
  if (useContain) {
    return fitLandmarkToCanvas(
      landmark,
      canvasWidth,
      canvasHeight,
      sourceWidth,
      sourceHeight,
      mirrorX,
    );
  }
  const x = mirrorX ? 1 - landmark.x : landmark.x;
  return { x: x * canvasWidth, y: landmark.y * canvasHeight };
}

export interface WireframeDrawOptions {
  minVisibility?: number;
  jointRadius?: number;
  lineWidth?: number;
  strokeStyle?: string;
  jointFillStyle?: string;
  /** `stretch` maps landmarks onto the full canvas. `contain` letterboxes the camera frame. */
  fit?: 'stretch' | 'contain';
  sourceWidth?: number;
  sourceHeight?: number;
  mirrorX?: boolean;
  /**
   * Pose landmarks used to seat each detected hand on the matching arm wrist.
   * Full finger bones still come from the 21 hand landmarks.
   */
  poseLandmarks?: readonly PoseLandmark[];
}

export function drawPoseWireframe(
  ctx: CanvasRenderingContext2D,
  landmarks: readonly PoseLandmark[],
  options?: WireframeDrawOptions,
): void {
  const minVisibility = options?.minVisibility ?? WIREFRAME_MIN_VISIBILITY;
  const jointRadius = options?.jointRadius ?? 4;
  const lineWidth = options?.lineWidth ?? 3;
  const strokeStyle = options?.strokeStyle ?? 'rgba(96, 210, 255, 0.92)';
  const jointFillStyle = options?.jointFillStyle ?? 'rgba(255, 255, 255, 0.95)';
  const fit = options?.fit ?? 'stretch';
  const sourceWidth = options?.sourceWidth ?? 0;
  const sourceHeight = options?.sourceHeight ?? 0;
  const mirrorX = options?.mirrorX ?? false;

  const { width, height } = ctx.canvas;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = jointFillStyle;

  const toPoint = (landmark: PoseLandmark): Point2D =>
    toWireframePoint(landmark, width, height, { fit, sourceWidth, sourceHeight, mirrorX });

  for (const [fromName, toName] of WIREFRAME_SEGMENTS) {
    const from = getLandmark(landmarks, fromName);
    const to = getLandmark(landmarks, toName);
    if (!isLandmarkVisible(from, minVisibility, fromName) || !isLandmarkVisible(to, minVisibility, toName)) {
      continue;
    }
    const a = toPoint(from!);
    const b = toPoint(to!);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const name of WIREFRAME_JOINTS) {
    const landmark = getLandmark(landmarks, name);
    if (!isLandmarkVisible(landmark, minVisibility, name)) continue;
    const point = toPoint(landmark!);
    ctx.beginPath();
    ctx.arc(
      point.x,
      point.y,
      jointRadiusForVisibility(jointRadius, landmarkScore(landmark!)),
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}
