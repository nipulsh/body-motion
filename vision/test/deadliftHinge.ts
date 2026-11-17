/** Side-on deadlift hinge with a body silhouette, shared by the deadlift form and overlay tests. */
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult, PoseSilhouette } from '../types';
export function poseFrom(points: Partial<Record<PoseLandmarkName, [number, number, number?]>>): PoseResult {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, visibility = 0.95]] of Object.entries(points) as [
    PoseLandmarkName,
    [number, number, number?],
  ][]) {
    landmarks[POSE_LANDMARK_INDEX[name]] = { x, y, z: 0, visibility };
  }
  return { landmarks, confidence: 0.95, timestamp: 0, frameAspect: 1 };
}

/** Silhouette size; the camera frame is 16:9 like the real feed. */
export const W = 640;
export const H = 360;

export interface HingeOptions {
  facing?: 'right' | 'left';
  /** Trunk lean from upright, degrees. */
  leanDeg?: number;
  /** Extra back depth at mid-trunk, silhouette pixels: 0 is a flat back. */
  bulgePx?: number;
  /**
   * Rounded back as a total bend from hip to shoulder, in degrees (an arc turning this much);
   * overrides `bulgePx`. Arc sagitta = length · tan(θ/4) / 2.
   */
  bendDeg?: number;
  /** Natural S-curve: low back hollow and upper back rounded by this many pixels each. */
  sCurvePx?: number;
  /** Shoulder landmark moved toward the chest, as when the arms reach down for the bar. */
  shoulderShiftPx?: number;
  /** Knee landmark offset, as when the hands and bar pass in front of the knee. */
  kneeShiftPx?: [number, number];
  /** Head dropped toward the chest (looking down at the bar). */
  headDown?: boolean;
  /** A small object touching the back, as a stray mask blob. */
  blob?: boolean;
  silhouette?: boolean;
  /** Extra back depth around the lower half of the trunk. */
  lumbarBulgePx?: number;
  /** Extra back depth around the upper half of the trunk. */
  thoracicBulgePx?: number;
  /** Knee flexion in degrees. Omit to keep the historical knee placement. */
  kneeBendDeg?: number;
  /** Pixels added to the hip's image y. Negative moves the hip up. */
  hipShiftY?: number;
  /** Draw the body at this multiple of the standard silhouette. */
  scale?: number;
  /** Drop the near knee's visibility. */
  hideKnee?: boolean;
  /** When set, world landmarks place the shoulder this many meters from the hip. */
  worldTorsoM?: number;
}

/**
 * Side-on hinge drawn in silhouette pixels: the trunk is a band around the hip→shoulder line,
 * reaching 35 px toward the chest and `28 + bulge` px out of the back. Arms hang on the chest side.
 */
function regionHump(t: number, center: number, radius: number): number {
  const u = (t - center) / radius;
  if (u <= -1 || u >= 1) return 0;
  return 1 - u * u;
}

export function hinge(options: HingeOptions = {}): PoseResult {
  const { facing = 'right', leanDeg = 50, shoulderShiftPx = 0, kneeShiftPx = [0, 0], sCurvePx = 0 } = options;
  const scale = options.scale ?? 1;
  const dir = facing === 'right' ? 1 : -1;
  const lean = (leanDeg * Math.PI) / 180;
  const length = 110 * scale;
  const unscaledBulge =
    options.bendDeg !== undefined ? (110 * Math.tan((options.bendDeg * Math.PI) / 180 / 4)) / 2 : (options.bulgePx ?? 0);
  const bulgePx = unscaledBulge * scale;
  const hip = { x: 320 * scale, y: (230 + (options.hipShiftY ?? 0)) * scale };
  const u = { x: dir * Math.sin(lean), y: -Math.cos(lean) };
  const chest = { x: dir * Math.cos(lean), y: Math.sin(lean) };
  const at = (t: number, n: number) => ({
    x: hip.x + u.x * length * t + chest.x * n * scale,
    y: hip.y + u.y * length * t + chest.y * n * scale,
  });
  const shoulder = at(1, shoulderShiftPx);
  const ear = options.headDown ? at(1.18, 26) : at(1.3, 0);
  const nose = { x: ear.x + chest.x * 12 * scale + dir * 4 * scale, y: ear.y + chest.y * 12 * scale };
  const bend = options.kneeBendDeg === undefined ? null : (options.kneeBendDeg * Math.PI) / 180;
  const knee =
    bend === null
      ? { x: hip.x + dir * 22 * scale + kneeShiftPx[0] * scale, y: hip.y + 100 * scale + kneeShiftPx[1] * scale }
      : {
          x: hip.x + chest.x * Math.sin(bend) * 100 * scale + kneeShiftPx[0] * scale,
          y: hip.y + Math.cos(bend) * 100 * scale + kneeShiftPx[1] * scale,
        };
  const ankle = { x: hip.x + dir * 8 * scale, y: hip.y + 200 * scale };
  const wrist = at(0.55, 70);

  const side = facing === 'right' ? 'left' : 'right';
  const near = (name: string) => `${side}${name}` as PoseLandmarkName;
  const width = Math.round(W * scale);
  const height = Math.round(H * scale);
  const norm = (p: { x: number; y: number }): [number, number] => [p.x / width, p.y / height];
  const pose = poseFrom({
    [near('Hip')]: norm(hip),
    [near('Shoulder')]: norm(shoulder),
    [near('Ear')]: norm(ear),
    [near('Knee')]: norm(knee),
    [near('Ankle')]: norm(ankle),
    [near('Wrist')]: norm(wrist),
    nose: norm(nose),
  });
  pose.frameAspect = W / H;
  if (options.hideKnee) {
    const kneeMark = pose.landmarks[POSE_LANDMARK_INDEX[near('Knee')]]!;
    kneeMark.visibility = 0;
  }
  if (options.worldTorsoM !== undefined) {
    const world = pose.landmarks.map(() => ({ x: 0, y: 0, z: 0, visibility: 0.95 }));
    world[POSE_LANDMARK_INDEX[near('Hip')]] = { x: 0, y: 0, z: 0, visibility: 0.95 };
    world[POSE_LANDMARK_INDEX[near('Shoulder')]] = { x: options.worldTorsoM, y: 0, z: 0, visibility: 0.95 };
    world[POSE_LANDMARK_INDEX[near('Knee')]] = { x: 0, y: 0.45, z: 0, visibility: 0.95 };
    pose.worldLandmarks = world;
  }

  if (options.silhouette !== false) {
    const data = new Uint8Array(width * height);
    const lumbarBulge = (options.lumbarBulgePx ?? 0) * scale;
    const thoracicBulge = (options.thoracicBulgePx ?? 0) * scale;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const vx = x + 0.5 - hip.x;
        const vy = y + 0.5 - hip.y;
        const t = (vx * u.x + vy * u.y) / length;
        const out = -(vx * chest.x + vy * chest.y);
        const mid = Math.max(0, 1 - ((t - 0.5) / 0.5) ** 2);
        let backDepth = 28 * scale + bulgePx * mid - (t >= 0 && t <= 1 ? sCurvePx * scale * Math.sin(2 * Math.PI * t) : 0);
        backDepth += lumbarBulge * regionHump(t, 0.35, 0.18);
        backDepth += thoracicBulge * regionHump(t, 0.68, 0.18);
        if (options.blob && Math.abs(t - 0.65) * length < 3 * scale) backDepth += 12 * scale;
        const trunk = t >= -0.2 && t <= 1.15 && out >= -35 * scale && out <= backDepth;
        // Arm: hangs from the shoulder on the chest side, toward the floor.
        const ax = x + 0.5 - shoulder.x;
        const ay = y + 0.5 - shoulder.y;
        const arm = ay >= 0 && ay <= 120 * scale && Math.abs(ax - dir * 0.15 * ay) <= 9 * scale;
        if (trunk || arm) data[y * width + x] = 255;
      }
    }
    pose.silhouette = { width, height, data } satisfies PoseSilhouette;
  }
  return pose;
}
