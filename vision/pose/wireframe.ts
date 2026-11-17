import type { PoseLandmark } from '../types';
import { getLandmark, POSE_LANDMARK_INDEX, type PoseLandmarkName } from './landmarks';

export interface Point2D {
  x: number;
  y: number;
}

export type WireframeSegment = readonly [PoseLandmarkName, PoseLandmarkName];

/**
 * Body lines. Arms follow MediaPipe pose indices:
 * shoulder 11/12 → elbow 13/14 → wrist 15/16, then the pose hand
 * (pinky 17/18, index 19/20, thumb 21/22) so the limb reaches the hand.
 * Legs continue past the ankle into the foot (heel 29/30, foot index 31/32).
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
  ['leftAnkle', 'leftHeel'],
  ['leftHeel', 'leftFootIndex'],
  ['leftAnkle', 'leftFootIndex'],
  ['rightAnkle', 'rightHeel'],
  ['rightHeel', 'rightFootIndex'],
  ['rightAnkle', 'rightFootIndex'],
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

/**
 * Joints drawn by default: every body landmark including heels and toes, and the main face
 * points. The extra face points (`WIREFRAME_FACE_DETAIL_JOINTS`) are opt-in so the head does
 * not turn into a cluster of dots on the mirror.
 */
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
  'leftHeel',
  'rightHeel',
  'leftFootIndex',
  'rightFootIndex',
];

/** Remaining face landmarks, drawn when `faceDetail` is set. Together with the joints above, all 33. */
export const WIREFRAME_FACE_DETAIL_JOINTS: readonly PoseLandmarkName[] = [
  'leftEyeInner',
  'leftEyeOuter',
  'rightEyeInner',
  'rightEyeOuter',
  'mouthLeft',
  'mouthRight',
];

/**
 * Points MediaPipe does not report but the body implies: the base of the neck (between the
 * shoulders), the pelvis centre (between the hips) and two spine points evenly between them.
 * They give the trunk a midline so spine bend and side lean read on the wireframe.
 */
export type DerivedSpinePointName = 'neck' | 'upperSpine' | 'lowerSpine' | 'pelvis';

export interface DerivedSpinePoint {
  name: DerivedSpinePointName;
  x: number;
  y: number;
  visibility: number;
}

/** 0 at the ends of a spine segment, 1 at the middle. */
export function spineBowScale(t: number): number {
  return 4 * t * (1 - t);
}

export function derivedSpinePoints(
  landmarks: readonly PoseLandmark[],
  isShown: (landmark: PoseLandmark | undefined, name: PoseLandmarkName) => boolean,
  /** Image-space shift at mid-spine. The neck and pelvis stay where the body puts them. */
  bow: { x: number; y: number } = { x: 0, y: 0 },
): DerivedSpinePoint[] {
  const ls = getLandmark(landmarks, 'leftShoulder');
  const rs = getLandmark(landmarks, 'rightShoulder');
  const lh = getLandmark(landmarks, 'leftHip');
  const rh = getLandmark(landmarks, 'rightHip');
  const shoulders = isShown(ls, 'leftShoulder') && isShown(rs, 'rightShoulder');
  const hips = isShown(lh, 'leftHip') && isShown(rh, 'rightHip');
  const points: DerivedSpinePoint[] = [];
  const neck = shoulders
    ? { x: (ls!.x + rs!.x) / 2, y: (ls!.y + rs!.y) / 2, visibility: Math.min(landmarkScore(ls!), landmarkScore(rs!)) }
    : null;
  const pelvis = hips
    ? { x: (lh!.x + rh!.x) / 2, y: (lh!.y + rh!.y) / 2, visibility: Math.min(landmarkScore(lh!), landmarkScore(rh!)) }
    : null;
  if (neck) points.push({ name: 'neck', ...neck });
  if (neck && pelvis) {
    const at = (t: number) => {
      const scale = spineBowScale(t);
      return {
        x: neck.x + (pelvis.x - neck.x) * t + bow.x * scale,
        y: neck.y + (pelvis.y - neck.y) * t + bow.y * scale,
        visibility: Math.min(neck.visibility, pelvis.visibility),
      };
    };
    points.push({ name: 'upperSpine', ...at(1 / 3) }, { name: 'lowerSpine', ...at(2 / 3) });
  }
  if (pelvis) points.push({ name: 'pelvis', ...pelvis });
  return points;
}

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
  const frame = containFrameRect(canvasWidth, canvasHeight, sourceWidth, sourceHeight);
  return {
    x: frame.x + xNorm * frame.width,
    y: frame.y + yNorm * frame.height,
  };
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Canvas area covered by the camera image under object-contain framing.
 * Invalid sizes fall back to the whole canvas.
 */
export function containFrameRect(
  canvasWidth: number,
  canvasHeight: number,
  sourceWidth: number,
  sourceHeight: number,
): FrameRect {
  if (sourceWidth <= 0 || sourceHeight <= 0 || canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const canvasAspect = canvasWidth / canvasHeight;
  if (sourceAspect > canvasAspect) {
    const height = canvasWidth / sourceAspect;
    return { x: 0, y: (canvasHeight - height) / 2, width: canvasWidth, height };
  }
  const width = canvasHeight * sourceAspect;
  return { x: (canvasWidth - width) / 2, y: 0, width, height: canvasHeight };
}

/** The camera image area in canvas pixels, with the same fit rules as `toWireframePoint`. */
export function cameraFrameRect(
  canvasWidth: number,
  canvasHeight: number,
  options?: Pick<WireframeDrawOptions, 'fit' | 'sourceWidth' | 'sourceHeight'>,
): FrameRect {
  const sourceWidth = options?.sourceWidth ?? 0;
  const sourceHeight = options?.sourceHeight ?? 0;
  if (options?.fit === 'contain' && sourceWidth > 0 && sourceHeight > 0) {
    return containFrameRect(canvasWidth, canvasHeight, sourceWidth, sourceHeight);
  }
  return { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
}

export function pointInRect(point: Point2D, rect: FrameRect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Liang-Barsky clip of segment a→b to `rect`. Returns the visible part, or
 * null when no part of the segment lies inside the rect.
 */
export function clipSegmentToRect(
  a: Point2D,
  b: Point2D,
  rect: FrameRect,
): readonly [Point2D, Point2D] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, a.x - rect.x],
    [dx, rect.x + rect.width - a.x],
    [-dy, a.y - rect.y],
    [dy, rect.y + rect.height - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return null;
      continue;
    }
    const t = q / p;
    if (p < 0) {
      if (t > t1) return null;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return null;
      if (t < t1) t1 = t;
    }
  }
  return [
    { x: a.x + t0 * dx, y: a.y + t0 * dy },
    { x: a.x + t1 * dx, y: a.y + t1 * dy },
  ];
}

/** Clip later drawing to the camera image so stroke caps and joint dots stay inside it. */
export function clipContextToRect(ctx: CanvasRenderingContext2D, rect: FrameRect): void {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
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

/** Maps a normalized camera-image point to canvas pixels, or null when it has no position. */
export type WireframeProjection = (point: Point2D) => Point2D | null;

const CAMERA_IMAGE: FrameRect = { x: 0, y: 0, width: 1, height: 1 };

export interface WireframeMapper {
  /** Canvas area drawing is clipped to. */
  frame: FrameRect;
  /** Visible canvas part of the segment between two normalized landmarks. */
  segment(a: Point2D, b: Point2D): readonly [Point2D, Point2D] | null;
  /** Canvas point of a normalized landmark, or null when it is not shown. */
  joint(point: Point2D): Point2D | null;
}

/**
 * Shared landmark → canvas mapping for body and hand wireframes.
 *
 * Without `project`, landmarks follow the displayed camera image and are clipped
 * to it. With `project` (mirror reflection mode), segments are first clipped to
 * the camera image in image space, so nothing the camera did not see is drawn,
 * then projected and clipped to the canvas edge. Projections used here map
 * straight lines to straight lines, so clipping endpoints is exact.
 */
export function createWireframeMapper(
  canvasWidth: number,
  canvasHeight: number,
  options?: WireframeDrawOptions,
): WireframeMapper {
  const project = options?.project;
  if (!project) {
    const frame = cameraFrameRect(canvasWidth, canvasHeight, options);
    const toPoint = (point: Point2D) => toWireframePoint(point, canvasWidth, canvasHeight, options);
    return {
      frame,
      segment: (a, b) => clipSegmentToRect(toPoint(a), toPoint(b), frame),
      joint: (point) => {
        const mapped = toPoint(point);
        return pointInRect(mapped, frame) ? mapped : null;
      },
    };
  }
  const frame: FrameRect = { x: 0, y: 0, width: canvasWidth, height: canvasHeight };
  return {
    frame,
    segment: (a, b) => {
      const seen = clipSegmentToRect(a, b, CAMERA_IMAGE);
      if (!seen) return null;
      const from = project(seen[0]);
      const to = project(seen[1]);
      if (!from || !to) return null;
      return clipSegmentToRect(from, to, frame);
    },
    joint: (point) => {
      if (!pointInRect(point, CAMERA_IMAGE)) return null;
      const mapped = project(point);
      return mapped && pointInRect(mapped, frame) ? mapped : null;
    },
  };
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
   * Custom normalized-image → canvas mapping (Smart Mirror reflection). When set,
   * `fit` and `mirrorX` are ignored for placement and clipping uses the canvas edge.
   */
  project?: WireframeProjection;
  /**
   * Per-landmark draw decision, indexed like MediaPipe pose landmarks. When
   * set it replaces the stateless visibility floor (see LandmarkVisibilityGate),
   * so `minVisibility` is not used; the gate applies its own floor.
   */
  visibleMask?: readonly boolean[];
  /**
   * Pose landmarks used to seat each detected hand on the matching arm wrist.
   * Full finger bones still come from the 21 hand landmarks.
   */
  poseLandmarks?: readonly PoseLandmark[];
  /**
   * Inner/outer eye and mouth corners. `auto` (default) draws them only when the face is large
   * enough on the canvas for the dots not to merge into a cluster.
   */
  faceDetail?: boolean | 'auto';
  /**
   * Rounded back: bends the hip–shoulder bone on `side` and the neck–pelvis midline by
   * `offset` (image space) at their middle. Hips, shoulders, neck and pelvis stay put.
   */
  backBow?: { side: 'left' | 'right'; offset: { x: number; y: number } };
  /** Back stroke when it should not use the body color (a rounded deadlift back). */
  spineStrokeStyle?: string;
  /**
   * Skip the neck–pelvis midline. Set when a spine-curve overlay is drawing the
   * estimated back, so the straight landmark line is not drawn on top of it.
   */
  hideDerivedSpine?: boolean;
}

/** Points along a→b, bowed by `offset` at the middle. */
function bowedLine(a: Point2D, b: Point2D, offset: Point2D, steps = 6): Point2D[] {
  const points: Point2D[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const scale = spineBowScale(t);
    points.push({ x: a.x + (b.x - a.x) * t + offset.x * scale, y: a.y + (b.y - a.y) * t + offset.y * scale });
  }
  return points;
}

/**
 * The six detail points sit between and around the eyes, roughly a quarter of the eye span
 * apart. Dots of radius r stop overlapping at 2r spacing, so detail needs an eye span of 8r.
 */
const FACE_DETAIL_EYE_SPAN_RADII = 8;

function faceLargeEnoughForDetail(
  landmarks: readonly PoseLandmark[],
  mapper: WireframeMapper,
  jointRadius: number,
  isShown: (landmark: PoseLandmark | undefined, name: PoseLandmarkName) => boolean,
): boolean {
  const le = getLandmark(landmarks, 'leftEye');
  const re = getLandmark(landmarks, 'rightEye');
  if (!isShown(le, 'leftEye') || !isShown(re, 'rightEye')) return false;
  const a = mapper.joint(le!);
  const b = mapper.joint(re!);
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) >= FACE_DETAIL_EYE_SPAN_RADII * jointRadius;
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
  const visibleMask = options?.visibleMask;

  const { width, height } = ctx.canvas;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = jointFillStyle;

  const mapper = createWireframeMapper(width, height, {
    fit,
    sourceWidth,
    sourceHeight,
    mirrorX,
    project: options?.project,
  });
  clipContextToRect(ctx, mapper.frame);

  const shouldDraw = (landmark: PoseLandmark | undefined, name: PoseLandmarkName): boolean => {
    if (!visibleMask) return isLandmarkVisible(landmark, minVisibility, name);
    if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
    return visibleMask[POSE_LANDMARK_INDEX[name]] === true;
  };

  const backBow = options?.backBow;
  const bowHip: PoseLandmarkName = backBow?.side === 'left' ? 'leftHip' : 'rightHip';
  const bowShoulder: PoseLandmarkName = backBow?.side === 'left' ? 'leftShoulder' : 'rightShoulder';
  const isBowedBone = (a: PoseLandmarkName, b: PoseLandmarkName) =>
    backBow !== undefined && ((a === bowHip && b === bowShoulder) || (a === bowShoulder && b === bowHip));
  const strokeChain = (points: readonly Point2D[]) => {
    for (let i = 1; i < points.length; i += 1) {
      const visible = mapper.segment(points[i - 1]!, points[i]!);
      if (!visible) continue;
      ctx.beginPath();
      ctx.moveTo(visible[0].x, visible[0].y);
      ctx.lineTo(visible[1].x, visible[1].y);
      ctx.stroke();
    }
  };

  for (const [fromName, toName] of WIREFRAME_SEGMENTS) {
    if (isBowedBone(fromName, toName)) continue;
    const from = getLandmark(landmarks, fromName);
    const to = getLandmark(landmarks, toName);
    if (!shouldDraw(from, fromName) || !shouldDraw(to, toName)) {
      continue;
    }
    const visible = mapper.segment(from!, to!);
    if (!visible) continue;
    const [a, b] = visible;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  if (options?.spineStrokeStyle) {
    ctx.strokeStyle = options.spineStrokeStyle;
    ctx.lineWidth = lineWidth * 1.6;
  }
  if (backBow) {
    const hip = getLandmark(landmarks, bowHip);
    const shoulder = getLandmark(landmarks, bowShoulder);
    if (shouldDraw(hip, bowHip) && shouldDraw(shoulder, bowShoulder)) {
      strokeChain(bowedLine(hip!, shoulder!, backBow.offset));
    }
  }

  const spine = options?.hideDerivedSpine ? [] : derivedSpinePoints(landmarks, shouldDraw, backBow?.offset);
  const neck = spine.find((point) => point.name === 'neck');
  const pelvis = spine.find((point) => point.name === 'pelvis');
  if (neck && pelvis) strokeChain(bowedLine(neck, pelvis, backBow?.offset ?? { x: 0, y: 0 }, backBow ? 6 : 1));
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = lineWidth;
  for (const point of spine) {
    const mapped = mapper.joint(point);
    if (!mapped) continue;
    ctx.beginPath();
    ctx.arc(mapped.x, mapped.y, jointRadiusForVisibility(jointRadius, point.visibility), 0, Math.PI * 2);
    ctx.fill();
  }

  const faceDetail = options?.faceDetail ?? 'auto';
  const showFaceDetail =
    faceDetail === 'auto' ? faceLargeEnoughForDetail(landmarks, mapper, jointRadius, shouldDraw) : faceDetail;
  const joints = showFaceDetail ? [...WIREFRAME_JOINTS, ...WIREFRAME_FACE_DETAIL_JOINTS] : WIREFRAME_JOINTS;
  for (const name of joints) {
    const landmark = getLandmark(landmarks, name);
    if (!shouldDraw(landmark, name)) continue;
    const point = mapper.joint(landmark!);
    if (!point) continue;
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
  ctx.restore();
}
