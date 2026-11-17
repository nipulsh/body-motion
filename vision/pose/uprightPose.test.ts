import { describe, expect, it } from 'vitest';
import type { PoseLandmark, PoseResult } from '../types';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from './landmarks';
import {
  CAMERA_TURN_FIRST_LOCK_MS,
  CAMERA_TURN_SWITCH_MS,
  CameraTurnTracker,
  detectCameraTurn,
  turnFrameSize,
  turnPose,
  type CameraTurn,
} from './uprightPose';

/** A person standing upright in a 9:16 portrait picture, camera view (their left on the image right). */
const UPRIGHT: Partial<Record<PoseLandmarkName, [number, number]>> = {
  nose: [0.5, 0.12],
  leftShoulder: [0.6, 0.25],
  rightShoulder: [0.4, 0.25],
  leftHip: [0.57, 0.5],
  rightHip: [0.43, 0.5],
  leftKnee: [0.57, 0.7],
  rightKnee: [0.43, 0.7],
  leftAnkle: [0.57, 0.9],
  rightAnkle: [0.43, 0.9],
};

function poseFrom(points: Partial<Record<PoseLandmarkName, [number, number]>>, frameAspect: number): PoseResult {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [name, xy] of Object.entries(points) as [PoseLandmarkName, [number, number]][]) {
    landmarks[POSE_LANDMARK_INDEX[name]] = { x: xy[0], y: xy[1], z: -0.1, visibility: 0.95, presence: 0.9 };
  }
  return { landmarks, confidence: 0.9, timestamp: 1, frameAspect };
}

/** The same person as a camera turned on its side sees them: head toward the picture's right edge. */
function headRight(): PoseResult {
  const raw: Partial<Record<PoseLandmarkName, [number, number]>> = {};
  for (const [name, [x, y]] of Object.entries(UPRIGHT) as [PoseLandmarkName, [number, number]][]) {
    // Upright (x, y) seen by a camera turned so that up points along its +x.
    raw[name] = [1 - y, x];
  }
  return poseFrom(raw, 16 / 9);
}

/** Head toward the picture's left edge (camera turned the other way). */
function headLeft(): PoseResult {
  const raw: Partial<Record<PoseLandmarkName, [number, number]>> = {};
  for (const [name, [x, y]] of Object.entries(UPRIGHT) as [PoseLandmarkName, [number, number]][]) {
    raw[name] = [y, 1 - x];
  }
  return poseFrom(raw, 16 / 9);
}

function at(pose: PoseResult, name: PoseLandmarkName): PoseLandmark {
  return pose.landmarks[POSE_LANDMARK_INDEX[name]]!;
}

function expectUpright(pose: PoseResult) {
  for (const [name, [x, y]] of Object.entries(UPRIGHT) as [PoseLandmarkName, [number, number]][]) {
    expect(at(pose, name).x).toBeCloseTo(x, 9);
    expect(at(pose, name).y).toBeCloseTo(y, 9);
  }
}

const RAW_FRAME = { width: 1920, height: 1080 };

describe('turnPose', () => {
  it('leaves an upright picture as it is', () => {
    const upright = poseFrom(UPRIGHT, 9 / 16);
    const turned = turnPose(upright, 0);
    expectUpright(turned);
    expect(turned.frameAspect).toBeCloseTo(9 / 16);
  });

  it('stands up a person whose head points to the picture right (a quarter turn left)', () => {
    const turned = turnPose(headRight(), 270);
    expectUpright(turned);
    expect(turned.frameAspect).toBeCloseTo(9 / 16);
  });

  it('stands up a person whose head points to the picture left (a quarter turn right)', () => {
    const turned = turnPose(headLeft(), 90);
    expectUpright(turned);
    expect(turned.frameAspect).toBeCloseTo(9 / 16);
  });

  it('turns an upside-down picture half way round', () => {
    const raw: Partial<Record<PoseLandmarkName, [number, number]>> = {};
    for (const [name, [x, y]] of Object.entries(UPRIGHT) as [PoseLandmarkName, [number, number]][]) raw[name] = [1 - x, 1 - y];
    const turned = turnPose(poseFrom(raw, 9 / 16), 180);
    expectUpright(turned);
    expect(turned.frameAspect).toBeCloseTo(9 / 16);
  });

  it('keeps the camera view: the patient’s left shoulder stays on the picture right, never mirrored', () => {
    for (const [pose, turn] of [[headRight(), 270], [headLeft(), 90]] as const) {
      const turned = turnPose(pose, turn);
      expect(at(turned, 'leftShoulder').x).toBeGreaterThan(at(turned, 'rightShoulder').x);
    }
  });

  it('keeps depth, visibility and presence of every landmark', () => {
    const turned = turnPose(headRight(), 270);
    expect(at(turned, 'nose')).toMatchObject({ z: -0.1, visibility: 0.95, presence: 0.9 });
    expect(at(turned, 'leftEar').visibility).toBe(0);
  });

  it('turns the 3D world landmarks the same way, leaving depth alone', () => {
    const pose = headRight();
    pose.worldLandmarks = [{ x: 0.2, y: -0.4, z: 0.3, visibility: 0.8 }];
    expect(turnPose(pose, 270).worldLandmarks?.[0]).toEqual({ x: -0.4, y: -0.2, z: 0.3, visibility: 0.8 });
    expect(turnPose(pose, 90).worldLandmarks?.[0]).toEqual({ x: 0.4, y: 0.2, z: 0.3, visibility: 0.8 });
    expect(turnPose(pose, 180).worldLandmarks?.[0]).toEqual({ x: -0.2, y: 0.4, z: 0.3, visibility: 0.8 });
  });

  it('drops the outline and spine, which are still in the unturned picture', () => {
    const pose = headRight();
    pose.silhouette = { width: 2, height: 2, mask: new Uint8Array(4) } as unknown as PoseResult['silhouette'];
    pose.spine = { points: [] } as unknown as PoseResult['spine'];
    const turned = turnPose(pose, 270);
    expect(turned.silhouette).toBeUndefined();
    expect(turned.spine).toBeUndefined();
    expect(turnPose(pose, 0).silhouette).toBe(pose.silhouette);
  });

  it('does not change the pose it was given', () => {
    const pose = headRight();
    const before = JSON.stringify(pose);
    turnPose(pose, 90);
    expect(JSON.stringify(pose)).toBe(before);
  });
});

describe('turnFrameSize', () => {
  it('swaps width and height for a quarter turn only', () => {
    expect(turnFrameSize(RAW_FRAME, 90)).toEqual({ width: 1080, height: 1920 });
    expect(turnFrameSize(RAW_FRAME, 270)).toEqual({ width: 1080, height: 1920 });
    expect(turnFrameSize(RAW_FRAME, 0)).toEqual(RAW_FRAME);
    expect(turnFrameSize(RAW_FRAME, 180)).toEqual(RAW_FRAME);
  });
});

describe('detectCameraTurn', () => {
  it('reads the turn that stands the body up', () => {
    expect(detectCameraTurn(poseFrom(UPRIGHT, 9 / 16).landmarks, { width: 1080, height: 1920 })).toBe(0);
    expect(detectCameraTurn(headRight().landmarks, RAW_FRAME)).toBe(270);
    expect(detectCameraTurn(headLeft().landmarks, RAW_FRAME)).toBe(90);
  });

  it('reads an upside-down camera', () => {
    const raw: Partial<Record<PoseLandmarkName, [number, number]>> = {};
    for (const [name, [x, y]] of Object.entries(UPRIGHT) as [PoseLandmarkName, [number, number]][]) raw[name] = [1 - x, 1 - y];
    expect(detectCameraTurn(poseFrom(raw, 9 / 16).landmarks, { width: 1080, height: 1920 })).toBe(180);
  });

  it('has no answer without a body', () => {
    expect(detectCameraTurn(null, RAW_FRAME)).toBeNull();
    expect(detectCameraTurn([], RAW_FRAME)).toBeNull();
    expect(detectCameraTurn(poseFrom({ nose: [0.5, 0.5] }, 16 / 9).landmarks, RAW_FRAME)).toBeNull();
  });

  it('turns the picture correctly when it is then applied', () => {
    for (const pose of [headRight(), headLeft()]) {
      const turn = detectCameraTurn(pose.landmarks, RAW_FRAME)!;
      expectUpright(turnPose(pose, turn));
    }
  });
});

describe('CameraTurnTracker', () => {
  const step = (tracker: CameraTurnTracker, pose: PoseResult | null, from: number, to: number, every = 33) => {
    let turn: CameraTurn = tracker.turn;
    for (let t = from; t <= to; t += every) turn = tracker.update(pose?.landmarks ?? null, RAW_FRAME, t);
    return turn;
  };

  it('starts from the given turn before anyone is seen', () => {
    const tracker = new CameraTurnTracker(270);
    expect(tracker.turn).toBe(270);
    expect(tracker.locked).toBe(false);
    expect(step(tracker, null, 0, 5000)).toBe(270);
  });

  it('locks onto the first body seen once it has held for a moment', () => {
    const tracker = new CameraTurnTracker(270);
    expect(step(tracker, headLeft(), 0, CAMERA_TURN_FIRST_LOCK_MS - 50)).toBe(270);
    expect(step(tracker, headLeft(), CAMERA_TURN_FIRST_LOCK_MS, CAMERA_TURN_FIRST_LOCK_MS + 40)).toBe(90);
    expect(tracker.locked).toBe(true);
  });

  it('confirms the starting turn straight away when the body agrees', () => {
    const tracker = new CameraTurnTracker(270);
    step(tracker, headRight(), 0, CAMERA_TURN_FIRST_LOCK_MS + 40);
    expect(tracker.turn).toBe(270);
    expect(tracker.locked).toBe(true);
  });

  it('ignores a short contrary reading once locked (a lean, a bad frame)', () => {
    const tracker = new CameraTurnTracker(270);
    step(tracker, headRight(), 0, 1000);
    const flicker = step(tracker, headLeft(), 1033, 1033 + CAMERA_TURN_SWITCH_MS - 100);
    expect(flicker).toBe(270);
    // Back to normal: the half-built switch is forgotten.
    step(tracker, headRight(), 3000, 3100);
    expect(step(tracker, headLeft(), 3133, 3133 + CAMERA_TURN_SWITCH_MS - 100)).toBe(270);
  });

  it('switches when a different turn holds for long enough', () => {
    const tracker = new CameraTurnTracker(270);
    step(tracker, headRight(), 0, 1000);
    expect(step(tracker, headLeft(), 1033, 1033 + CAMERA_TURN_SWITCH_MS + 40)).toBe(90);
  });

  it('a lost body interrupts a pending switch', () => {
    const tracker = new CameraTurnTracker(270);
    step(tracker, headRight(), 0, 1000);
    step(tracker, headLeft(), 1033, 1033 + CAMERA_TURN_SWITCH_MS / 2);
    step(tracker, null, 2000, 2200);
    expect(step(tracker, headLeft(), 2233, 2233 + CAMERA_TURN_SWITCH_MS - 100)).toBe(270);
  });

  it('survives time going backwards (a new camera clock) without switching early', () => {
    const tracker = new CameraTurnTracker(270);
    step(tracker, headRight(), 5000, 6000);
    tracker.update(headLeft().landmarks, RAW_FRAME, 6100);
    expect(tracker.update(headLeft().landmarks, RAW_FRAME, 10)).toBe(270);
  });
});
