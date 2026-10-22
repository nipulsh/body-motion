import type { PoseLandmark } from '../types';
import { getLandmark } from '../pose/landmarks';
import {
  HAND_LANDMARK_COUNT,
  handLandmarkVisibility,
  type HandLandmarkPoint,
  type TrackedHand,
} from './handLandmarksBus';
import {
  jointRadiusForVisibility,
  toWireframePoint,
  WIREFRAME_MIN_VISIBILITY,
  type WireframeDrawOptions,
} from '../pose/wireframe';

export type HandWireframeSegment = readonly [number, number];

/**
 * MediaPipe hand bones. Indices match HandLandmarker:
 * wrist, thumb CMC/MCP/IP/tip, then index/middle/ring/pinky MCP/PIP/DIP/tip.
 * Palm links keep each finger attached to the wrist.
 */
export const HAND_WIREFRAME_SEGMENTS: readonly HandWireframeSegment[] = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [0, 17],
  [17, 18],
  [18, 19],
  [19, 20],
];

const PIXEL_COORDINATE_LIMIT = 1.5;

type PoseWristSide = 'Left' | 'Right';

function poseWristUsable(landmark: PoseLandmark | undefined): landmark is PoseLandmark {
  if (!landmark || !Number.isFinite(landmark.x) || !Number.isFinite(landmark.y)) return false;
  const presence = landmark.presence;
  const score = Math.max(landmark.visibility, typeof presence === 'number' ? presence : 0);
  return score > 0;
}

/** Pixel-space joints (values well above 1) are scaled into the camera frame before drawing. */
function normalizeHandToImage(
  hand: TrackedHand,
  sourceWidth: number,
  sourceHeight: number,
): TrackedHand {
  let maxAbs = 0;
  for (const landmark of hand.landmarks) {
    if (!landmark) continue;
    maxAbs = Math.max(maxAbs, Math.abs(landmark.x), Math.abs(landmark.y));
  }
  if (maxAbs <= PIXEL_COORDINATE_LIMIT || sourceWidth < 2 || sourceHeight < 2) return hand;
  return {
    ...hand,
    landmarks: hand.landmarks.map((landmark) =>
      landmark
        ? { ...landmark, x: landmark.x / sourceWidth, y: landmark.y / sourceHeight }
        : landmark,
    ),
  };
}

function shiftHand(hand: TrackedHand, dx: number, dy: number): TrackedHand {
  return {
    ...hand,
    landmarks: hand.landmarks.map((landmark) =>
      landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y)
        ? { ...landmark, x: landmark.x + dx, y: landmark.y + dy }
        : landmark,
    ),
  };
}

/**
 * Move each detected hand so its wrist sits on the pose arm wrist.
 * Left/Right handedness picks the arm. A hand with no label uses the nearest
 * unused wrist. A hand that was not detected is not invented.
 */
export function alignHandsToPoseWrists(
  hands: readonly TrackedHand[],
  poseLandmarks: readonly PoseLandmark[] | undefined,
  sourceWidth = 0,
  sourceHeight = 0,
): TrackedHand[] {
  const normalized = hands.map((hand) => normalizeHandToImage(hand, sourceWidth, sourceHeight));
  if (!poseLandmarks?.length) return normalized;

  const anchors: Array<{ side: PoseWristSide; x: number; y: number }> = [];
  const left = getLandmark(poseLandmarks, 'leftWrist');
  const right = getLandmark(poseLandmarks, 'rightWrist');
  if (poseWristUsable(left)) anchors.push({ side: 'Left', x: left.x, y: left.y });
  if (poseWristUsable(right)) anchors.push({ side: 'Right', x: right.x, y: right.y });
  if (anchors.length === 0) return normalized;

  const used = new Set<PoseWristSide>();
  return normalized.map((hand) => {
    const wrist = hand.landmarks[0];
    if (!wrist || !Number.isFinite(wrist.x) || !Number.isFinite(wrist.y)) return hand;
    const preferred = hand.handedness === 'Left' || hand.handedness === 'Right' ? hand.handedness : null;
    let anchor = preferred
      ? anchors.find((item) => item.side === preferred && !used.has(item.side))
      : undefined;
    if (!anchor) {
      let best: (typeof anchors)[number] | undefined;
      let bestDistance = Infinity;
      for (const candidate of anchors) {
        if (used.has(candidate.side)) continue;
        const distance = (candidate.x - wrist.x) ** 2 + (candidate.y - wrist.y) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = candidate;
        }
      }
      anchor = best;
    }
    if (!anchor) return hand;
    used.add(anchor.side);
    return shiftHand(hand, anchor.x - wrist.x, anchor.y - wrist.y);
  });
}

/**
 * A detected hand joint is drawn even when MediaPipe reports visibility 0 or a
 * score under the body wireframe floor. Missing coordinates are skipped.
 */
function isHandPointVisible(landmark: HandLandmarkPoint | undefined): boolean {
  return Boolean(landmark && Number.isFinite(landmark.x) && Number.isFinite(landmark.y));
}

function handJointScore(landmark: HandLandmarkPoint | undefined): number {
  const score = handLandmarkVisibility(landmark);
  return score >= WIREFRAME_MIN_VISIBILITY ? score : 1;
}

/** Draw detected hands with the same stroke and joint marks as the body wireframe. */
export function drawHandWireframes(
  ctx: CanvasRenderingContext2D,
  hands: readonly TrackedHand[],
  options?: WireframeDrawOptions,
): void {
  const jointRadius = options?.jointRadius ?? 4;
  const lineWidth = options?.lineWidth ?? 3;
  const strokeStyle = options?.strokeStyle ?? 'rgba(96, 210, 255, 0.92)';
  const jointFillStyle = options?.jointFillStyle ?? 'rgba(255, 255, 255, 0.95)';

  const { width, height } = ctx.canvas;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = strokeStyle;
  ctx.fillStyle = jointFillStyle;

  const pointOptions: WireframeDrawOptions = {
    fit: options?.fit,
    sourceWidth: options?.sourceWidth,
    sourceHeight: options?.sourceHeight,
    mirrorX: options?.mirrorX,
  };
  const drawableHands = alignHandsToPoseWrists(
    hands,
    options?.poseLandmarks,
    pointOptions.sourceWidth ?? 0,
    pointOptions.sourceHeight ?? 0,
  );

  for (const hand of drawableHands) {
    for (const [fromIndex, toIndex] of HAND_WIREFRAME_SEGMENTS) {
      const from = hand.landmarks[fromIndex];
      const to = hand.landmarks[toIndex];
      if (!isHandPointVisible(from) || !isHandPointVisible(to)) {
        continue;
      }
      const a = toWireframePoint(from!, width, height, pointOptions);
      const b = toWireframePoint(to!, width, height, pointOptions);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    for (let index = 0; index < HAND_LANDMARK_COUNT; index += 1) {
      const landmark = hand.landmarks[index];
      if (!isHandPointVisible(landmark)) continue;
      const point = toWireframePoint(landmark!, width, height, pointOptions);
      ctx.beginPath();
      ctx.arc(
        point.x,
        point.y,
        jointRadiusForVisibility(jointRadius, handJointScore(landmark)),
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
  }
}
