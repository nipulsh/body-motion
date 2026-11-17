import type { PoseLandmark, PoseResult } from '../../../types';
import { clamp, LM, type P2 } from './geometry';

/**
 * Synthetic skeleton so every game can be developed and tested with no camera
 * and no person. Coordinates come out like MediaPipe: normalized, camera view
 * (not mirrored), the patient's left on the image right when facing the camera.
 */
export interface MockParams {
  /** 0..60, hip drop percent of standing hip height. */
  hipDropPct: number;
  /** Forward trunk lean, degrees from vertical. */
  trunkLeanDeg: number;
  /** Knee cave (valgus), degrees. */
  kneeCaveDeg: number;
  /** Toe-out per foot, degrees. */
  toeOutDeg: number;
  /** Marching foot lift, percent of leg length. */
  leftFootLift: number;
  rightFootLift: number;
  /** Heel lift, percent of leg length. */
  heelLiftPct: number;
  /** Sideways swing of a lifted foot, percent of leg length (positive lateral). */
  leftFootSwing: number;
  rightFootSwing: number;
  /** Heel kick backward instead of a knee lift (foot rises, knee stays down). */
  heelKick: boolean;
  view: 'front' | 'side';
  tracking: boolean;
  secondPerson: boolean;
  /** Dragged wrist / ankle targets in normalized camera coordinates, or null for the natural pose. */
  leftWrist: P2 | null;
  rightWrist: P2 | null;
  leftAnkle: P2 | null;
  rightAnkle: P2 | null;
  /** Hide the index fingertips (the bubble game falls back to the wrists). */
  hideFingertips: boolean;
  /** Body size against the default; above 1 is closer to the camera. */
  distanceScale: number;
  /** Sideways shift of the body, normalized frame widths. */
  bodyShiftX: number;
  /** How far the hips travel back per unit of hip drop (sets the shin angle in a squat). */
  hipBackRatio: number;
}

export const DEFAULT_MOCK_PARAMS: MockParams = {
  hipDropPct: 0,
  trunkLeanDeg: 0,
  kneeCaveDeg: 0,
  toeOutDeg: 10,
  leftFootLift: 0,
  rightFootLift: 0,
  heelLiftPct: 0,
  leftFootSwing: 0,
  rightFootSwing: 0,
  heelKick: false,
  view: 'front',
  tracking: true,
  secondPerson: false,
  leftWrist: null,
  rightWrist: null,
  leftAnkle: null,
  rightAnkle: null,
  hideFingertips: false,
  distanceScale: 1,
  bodyShiftX: 0,
  hipBackRatio: 0.45,
};

export const MOCK_ASPECT = 16 / 9;

/** Body proportions in frame-height units at distance scale 1. */
export const MOCK_BODY = {
  ankleY: 0.86,
  thigh: 0.205,
  shin: 0.195,
  torso: 0.26,
  shoulderHalf: 0.085,
  hipHalf: 0.055,
  stanceHalf: 0.06,
  upperArm: 0.135,
  forearm: 0.12,
  hand: 0.045,
  neckToNose: 0.11,
  footLen: 0.06,
  metresPerUnit: 0.85 / 0.4,
};

const DEG = Math.PI / 180;

/** Two-bone IK in 2D: joint position given root, target and bone lengths; `bend` picks the side. */
export function solveTwoBone(root: P2, target: P2, a: number, b: number, bend: P2): P2 {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  let d = Math.hypot(dx, dy);
  const maxD = a + b - 1e-6;
  const minD = Math.abs(a - b) + 1e-6;
  d = clamp(d, minD, maxD);
  const ux = dx / (Math.hypot(dx, dy) || 1);
  const uy = dy / (Math.hypot(dx, dy) || 1);
  const along = (a * a - b * b + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  // Perpendicular pointing toward the bend hint.
  let px = -uy;
  let py = ux;
  if (px * bend.x + py * bend.y < 0) {
    px = -px;
    py = -py;
  }
  return { x: root.x + ux * along + px * h, y: root.y + uy * along + py * h };
}

interface Built {
  /** Image units (x already multiplied by aspect). */
  pts: P2[];
  /** Forward depth toward the camera, image units (for world landmarks). */
  depth: number[];
  vis: number[];
}

function emptyBuilt(): Built {
  return {
    pts: Array.from({ length: 33 }, () => ({ x: 0, y: 0 })),
    depth: new Array(33).fill(0),
    vis: new Array(33).fill(0.98),
  };
}

/** Sagittal knee position (forward, up) for a hip at (back, height) over an ankle at the origin. */
function sagittalKnee(hipForward: number, hipUp: number): { f: number; u: number } {
  const k = solveTwoBone({ x: 0, y: 0 }, { x: hipForward, y: hipUp }, MOCK_BODY.shin, MOCK_BODY.thigh, { x: 1, y: 0 });
  return { f: k.x, u: k.y };
}

function buildBody(p: MockParams, centreX: number): Built {
  const b = emptyBuilt();
  const side = p.view === 'side';
  const legLen = MOCK_BODY.thigh + MOCK_BODY.shin;
  const hipUp = legLen * (1 - clamp(p.hipDropPct, 0, 80) / 100);
  const hipBack = clamp(p.hipBackRatio, -0.5, 2) * (legLen - hipUp);
  const knee = sagittalKnee(-hipBack, hipUp);
  const lean = clamp(p.trunkLeanDeg, -30, 90) * DEG;
  const ankleY = MOCK_BODY.ankleY;

  // Facing the camera: patient's left = +x. Side on: patient faces -x, left side to the camera.
  const lat = (s: 'left' | 'right') => (s === 'left' ? 1 : -1);
  const fwdX = (f: number) => (side ? -f : 0);

  const setPt = (i: number, x: number, y: number, depth: number, vis = 0.98) => {
    b.pts[i] = { x, y };
    b.depth[i] = depth;
    b.vis[i] = vis;
  };

  const hipY = ankleY - hipUp;
  const hipCx = centreX + fwdX(-hipBack);
  for (const s of ['left', 'right'] as const) {
    const L = lat(s);
    const far = side && s === 'right';
    const v = far ? 0.75 : 0.98;
    const idx =
      s === 'left'
        ? { hip: LM.lHip, knee: LM.lKnee, ankle: LM.lAnkle, heel: LM.lHeel, foot: LM.lFoot }
        : { hip: LM.rHip, knee: LM.rKnee, ankle: LM.rAnkle, heel: LM.rHeel, foot: LM.rFoot };
    const hipX = side ? hipCx : centreX + L * MOCK_BODY.hipHalf;
    const ankleX0 = side ? centreX : centreX + L * MOCK_BODY.stanceHalf;
    setPt(idx.hip, hipX, hipY, -hipBack, v);

    const lift = clamp(s === 'left' ? p.leftFootLift : p.rightFootLift, 0, 60) / 100 * legLen;
    const swing = (s === 'left' ? p.leftFootSwing : p.rightFootSwing) / 100 * legLen;
    const drag = s === 'left' ? p.leftAnkle : p.rightAnkle;

    let kneeX: number;
    let kneeY: number;
    let kneeDepth: number;
    let ankleX: number;
    let ankleYs: number;
    let ankleDepth = 0;
    if (drag) {
      const target = { x: drag.x * MOCK_ASPECT, y: drag.y };
      const k = solveTwoBone({ x: hipX, y: hipY }, target, MOCK_BODY.thigh, MOCK_BODY.shin, { x: side ? -1 : L, y: 0 });
      const reach = Math.min(Math.hypot(target.x - hipX, target.y - hipY), legLen - 1e-6);
      const dir = Math.atan2(target.y - hipY, target.x - hipX);
      kneeX = k.x;
      kneeY = k.y;
      kneeDepth = 0;
      ankleX = hipX + Math.cos(dir) * reach;
      ankleYs = hipY + Math.sin(dir) * reach;
    } else if (lift > 0 && !p.heelKick) {
      // March: thigh swings forward, shin hangs vertical.
      const cos = clamp(1 - lift / MOCK_BODY.thigh, 0, 1);
      const sin = Math.sqrt(1 - cos * cos);
      kneeY = hipY + MOCK_BODY.thigh * cos;
      kneeDepth = MOCK_BODY.thigh * sin;
      kneeX = (side ? hipX + fwdX(kneeDepth) : hipX) + L * swing * 0.5 * (side ? 0 : 1);
      ankleX = (side ? kneeX : ankleX0) + (side ? 0 : L * swing);
      ankleYs = kneeY + MOCK_BODY.shin;
      ankleDepth = kneeDepth;
    } else if (lift > 0 && p.heelKick) {
      // Heel kick: thigh stays down, shin swings back so the foot rises.
      const cos = clamp(1 - lift / MOCK_BODY.shin, -1, 1);
      const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
      kneeX = side ? hipX : hipX;
      kneeY = hipY + MOCK_BODY.thigh;
      kneeDepth = 0;
      ankleX = side ? kneeX - fwdX(MOCK_BODY.shin * sin) : ankleX0;
      ankleYs = kneeY + MOCK_BODY.shin * cos;
      ankleDepth = -MOCK_BODY.shin * sin;
    } else {
      const toe = clamp(p.toeOutDeg, 0, 45);
      const depthFactor = clamp(p.hipDropPct / 30, 0, 1);
      const tibiaDeg = (3 + 0.35 * toe) * depthFactor - p.kneeCaveDeg;
      kneeY = ankleY - knee.u;
      kneeDepth = knee.f;
      kneeX = side ? centreX + fwdX(knee.f) : ankleX0 + L * Math.tan(tibiaDeg * DEG) * knee.u;
      ankleX = ankleX0;
      ankleYs = ankleY;
    }
    setPt(idx.knee, kneeX, kneeY, kneeDepth, v);
    setPt(idx.ankle, ankleX, ankleYs, ankleDepth, v);

    const toe = clamp(p.toeOutDeg, 0, 45) * DEG;
    const heelLift = (clamp(p.heelLiftPct, 0, 30) / 100) * legLen;
    const footUp = ankleY - ankleYs; // how far the whole foot is off the floor
    const heelY = ankleYs + 0.02 - (footUp > 0.001 ? 0 : heelLift);
    const toeY = ankleYs + 0.028;
    if (side) {
      setPt(idx.heel, ankleX + 0.02, heelY, ankleDepth - 0.02, v);
      setPt(idx.foot, ankleX - MOCK_BODY.footLen, toeY, ankleDepth + MOCK_BODY.footLen, v);
    } else {
      setPt(idx.heel, ankleX, heelY, ankleDepth - 0.015, v);
      setPt(idx.foot, ankleX + L * Math.sin(toe) * MOCK_BODY.footLen, toeY, ankleDepth + Math.cos(toe) * MOCK_BODY.footLen, v);
    }
  }

  // Trunk, head and arms.
  const shoulderY = hipY - MOCK_BODY.torso * Math.cos(lean);
  const shoulderF = MOCK_BODY.torso * Math.sin(lean) - hipBack;
  const shoulderCx = side ? centreX + fwdX(shoulderF) : centreX;
  for (const s of ['left', 'right'] as const) {
    const L = lat(s);
    const far = side && s === 'right';
    const v = far ? 0.75 : 0.98;
    const sh = s === 'left' ? LM.lShoulder : LM.rShoulder;
    const el = s === 'left' ? LM.lElbow : LM.rElbow;
    const wr = s === 'left' ? LM.lWrist : LM.rWrist;
    const ix = s === 'left' ? LM.lIndex : LM.rIndex;
    const pk = s === 'left' ? 17 : 18;
    const th = s === 'left' ? 21 : 22;
    const shX = side ? shoulderCx + L * 0.008 : centreX + L * MOCK_BODY.shoulderHalf;
    setPt(sh, shX, shoulderY, shoulderF, v);
    const dragged = s === 'left' ? p.leftWrist : p.rightWrist;
    let elbow: P2;
    let wrist: P2;
    if (dragged) {
      const target = { x: dragged.x * MOCK_ASPECT, y: dragged.y };
      const armLen = MOCK_BODY.upperArm + MOCK_BODY.forearm;
      const dx = target.x - shX;
      const dy = target.y - shoulderY;
      const d = Math.hypot(dx, dy);
      const reach = Math.min(d, armLen - 1e-6);
      wrist = d > 1e-6 ? { x: shX + (dx / d) * reach, y: shoulderY + (dy / d) * reach } : target;
      elbow = solveTwoBone({ x: shX, y: shoulderY }, wrist, MOCK_BODY.upperArm, MOCK_BODY.forearm, { x: L, y: 1 });
    } else {
      elbow = { x: shX + L * 0.015, y: shoulderY + MOCK_BODY.upperArm };
      wrist = { x: shX + L * 0.025, y: shoulderY + MOCK_BODY.upperArm + MOCK_BODY.forearm };
    }
    setPt(el, elbow.x, elbow.y, shoulderF, v);
    setPt(wr, wrist.x, wrist.y, shoulderF, v);
    const fx = wrist.x - elbow.x;
    const fy = wrist.y - elbow.y;
    const fl = Math.hypot(fx, fy) || 1;
    const tip = { x: wrist.x + (fx / fl) * MOCK_BODY.hand, y: wrist.y + (fy / fl) * MOCK_BODY.hand };
    setPt(ix, tip.x, tip.y, shoulderF, p.hideFingertips ? 0.1 : v);
    setPt(pk, tip.x - L * 0.01, tip.y - 0.005, shoulderF, v);
    setPt(th, tip.x + L * 0.012, tip.y - 0.015, shoulderF, v);
  }

  // Face points clustered above the shoulders.
  const headY = shoulderY - MOCK_BODY.neckToNose * Math.cos(lean);
  const headX = side ? shoulderCx + fwdX(MOCK_BODY.neckToNose * Math.sin(lean) + 0.03) : centreX;
  for (let i = 0; i <= 10; i += 1) {
    const offX = side ? 0 : (i % 2 === 0 ? 1 : -1) * Math.min(i, 4) * 0.008;
    setPt(i, headX + offX, headY - (i > 0 && i < 7 ? 0.015 : i >= 9 ? -0.02 : 0), shoulderF + 0.05);
  }
  return b;
}

function scaleAbout(b: Built, scale: number): Built {
  const cx = MOCK_ASPECT / 2;
  const cy = 0.5;
  return {
    ...b,
    pts: b.pts.map((p) => ({ x: cx + (p.x - cx) * scale, y: cy + (p.y - cy) * scale })),
    depth: b.depth.map((d) => d * scale),
  };
}

function toPose(b: Built, t: number, scale: number): PoseResult {
  const hipMid = { x: (b.pts[LM.lHip].x + b.pts[LM.rHip].x) / 2, y: (b.pts[LM.lHip].y + b.pts[LM.rHip].y) / 2 };
  const m = MOCK_BODY.metresPerUnit / scale;
  const landmarks: PoseLandmark[] = b.pts.map((p, i) => ({
    x: p.x / MOCK_ASPECT,
    y: p.y,
    z: -b.depth[i],
    visibility: b.vis[i],
  }));
  const worldLandmarks: PoseLandmark[] = b.pts.map((p, i) => ({
    x: (p.x - hipMid.x) * m,
    y: (p.y - hipMid.y) * m,
    z: -b.depth[i] * m,
    visibility: b.vis[i],
  }));
  return { landmarks, worldLandmarks, confidence: 0.95, timestamp: t * 1000, frameAspect: MOCK_ASPECT };
}

/** The mock pose at time `t` (seconds), or null when tracking is switched off. */
export function mockPose(params: MockParams, t: number): PoseResult | null {
  if (!params.tracking) return null;
  // Second person: for one second in every four the detector latches onto someone else.
  if (params.secondPerson && t % 4 >= 3) {
    const other = buildBody({ ...DEFAULT_MOCK_PARAMS, toeOutDeg: 5 }, MOCK_ASPECT * 0.82);
    return toPose(scaleAbout(other, 0.8), t, 0.8);
  }
  const centre = MOCK_ASPECT / 2 + params.bodyShiftX * MOCK_ASPECT;
  const built = buildBody(params, centre);
  const scale = clamp(params.distanceScale, 0.6, 1.4);
  return toPose(scaleAbout(built, scale), t, scale);
}
