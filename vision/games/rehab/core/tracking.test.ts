import { describe, expect, it } from 'vitest';
import type { PoseResult } from '../../../types';
import { FPS, Rig } from '../testing/rig';
import coreConfig from './config.json';
import { LM, type P2, type V3 } from './geometry';
import { MOCK_BODY, mockPose, DEFAULT_MOCK_PARAMS } from './mockSkeleton';
import { Debounced, detectView, hysteresisAbove, liveScale, toeOutFromWorld } from './tracking';

const SQUAT_LANDMARKS = [11, 12, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const MSG = coreConfig.trackingMessages;

function withVisibility(pose: PoseResult, ids: readonly number[], v: number): PoseResult {
  return { ...pose, landmarks: pose.landmarks.map((l, i) => (ids.includes(i) ? { ...l, visibility: v } : l)) };
}

/** Scale a pose about the frame centre (closer or further from the camera). */
function scalePose(pose: PoseResult, k: number): PoseResult {
  return { ...pose, landmarks: pose.landmarks.map((l) => ({ ...l, x: 0.5 + (l.x - 0.5) * k, y: 0.5 + (l.y - 0.5) * k })) };
}

function points(entries: Record<number, P2>): P2[] {
  const pts: P2[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0 }));
  for (const [i, p] of Object.entries(entries)) pts[Number(i)] = p;
  return pts;
}

describe('view detection', () => {
  const cfg = coreConfig.view;
  const body = (shoulderWidth: number) =>
    points({
      [LM.lShoulder]: { x: 1 + shoulderWidth / 2, y: 0.3 },
      [LM.rShoulder]: { x: 1 - shoulderWidth / 2, y: 0.3 },
      [LM.lHip]: { x: 1.05, y: 0.6 },
      [LM.rHip]: { x: 0.95, y: 0.6 },
    });

  it('is front when shoulder width over torso length is above 0.55', () => {
    expect(detectView(body(0.3 * 0.6), 'unknown', cfg)).toBe('front');
  });

  it('is side when the ratio is below 0.30', () => {
    expect(detectView(body(0.3 * 0.2), 'unknown', cfg)).toBe('side');
  });

  it('keeps the previous view between the two thresholds (hysteresis)', () => {
    expect(detectView(body(0.3 * 0.42), 'front', cfg)).toBe('front');
    expect(detectView(body(0.3 * 0.42), 'side', cfg)).toBe('side');
  });

  it('confirms a view change only after 3 consecutive frames', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    expect(rig.status!.view).toBe('front');
    // Count from the first smoothed frame that reads side on its own.
    let firstRaw: number | null = null;
    let switched: number | null = null;
    for (let i = 0; i < FPS && switched === null; i += 1) {
      const s = rig.step({ view: 'side' });
      if (firstRaw === null && s.frame && detectView(s.frame.pts, 'front', coreConfig.view) === 'side') firstRaw = i;
      if (s.view === 'side') switched = i;
    }
    expect(firstRaw).not.toBeNull();
    expect(switched! - firstRaw!).toBe(coreConfig.tracking.confirmFrames - 1);
  });
});

describe('threshold helpers', () => {
  it('hysteresisAbove holds its state inside a 5% band', () => {
    expect(hysteresisAbove(1.02, 1, false, 0.05)).toBe(false);
    expect(hysteresisAbove(1.06, 1, false, 0.05)).toBe(true);
    expect(hysteresisAbove(0.97, 1, true, 0.05)).toBe(true);
    expect(hysteresisAbove(0.94, 1, true, 0.05)).toBe(false);
  });

  it('Debounced flips only after N disagreeing frames in a row', () => {
    const d = new Debounced(false, 3);
    expect(d.update(true)).toBe(false);
    expect(d.update(true)).toBe(false);
    expect(d.update(false)).toBe(false);
    expect(d.update(true)).toBe(false);
    expect(d.update(true)).toBe(false);
    expect(d.update(true)).toBe(true);
  });
});

describe('automatic base pose', () => {
  it('locks after the patient stands still for 2 s, with no tap', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    let lockedAt: number | null = null;
    let lastProgress = 0;
    for (let i = 0; i < 4 * FPS && lockedAt === null; i += 1) {
      const s = rig.step();
      expect(s.baseProgress).toBeGreaterThanOrEqual(lastProgress);
      lastProgress = s.baseProgress;
      if (s.base) lockedAt = rig.t;
    }
    expect(lockedAt).not.toBeNull();
    expect(lockedAt!).toBeGreaterThanOrEqual(coreConfig.base.stillSeconds);
    expect(lockedAt!).toBeLessThan(coreConfig.base.stillSeconds + 0.6);
  });

  it('does not lock while the hips keep moving', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    for (let i = 0; i < 5 * FPS; i += 1) rig.step({ hipDropPct: 10 + 8 * Math.sin(rig.t * 3) });
    expect(rig.tracker.getBase()).toBeNull();
  });

  it('does not lock unless head to toe is in the picture', () => {
    const rig = new Rig([11, 12, 23, 24]);
    for (let i = 0; i < 4 * FPS; i += 1) {
      const pose = mockPose(rig.params, rig.t + 1 / FPS)!;
      rig.step(undefined, withVisibility(pose, [LM.lHeel, LM.rHeel], 0.1));
    }
    expect(rig.tracker.getBase()).toBeNull();
  });

  it('stores lengths as ratios of the picture that match the body', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    const base = rig.lockBase();
    const leg = MOCK_BODY.thigh + MOCK_BODY.shin;
    expect(base.legLength).toBeCloseTo(leg, 3);
    expect(base.hipHeight).toBeCloseTo(leg, 3);
    expect(base.torsoLength).toBeCloseTo(MOCK_BODY.torso, 3);
    expect(base.shoulderWidth).toBeCloseTo(MOCK_BODY.shoulderHalf * 2, 3);
    expect(base.hipWidth).toBeCloseTo(MOCK_BODY.hipHalf * 2, 3);
    // Arm length from world landmarks, in picture units.
    expect(base.armLength).toBeGreaterThan((MOCK_BODY.upperArm + MOCK_BODY.forearm) * 0.95);
    expect(base.armLength).toBeLessThan((MOCK_BODY.upperArm + MOCK_BODY.forearm) * 1.05);
    expect(base.view).toBe('front');
    expect(base.trunkAngleDeg).toBeLessThan(1);
  });

  it('re-bases slowly for a small change while still and tall, but ignores a large one', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    const leg0 = rig.lockBase().legLength;
    for (let i = 0; i < 8 * FPS; i += 1) rig.step({ distanceScale: 1.03 });
    const small = rig.base.legLength;
    expect(small).toBeGreaterThan(leg0 * 1.005);
    expect(small).toBeLessThan(leg0 * 1.03 + 1e-6);

    const rig2 = new Rig(SQUAT_LANDMARKS);
    const leg2 = rig2.lockBase().legLength;
    for (let i = 0; i < 8 * FPS; i += 1) rig2.step({ distanceScale: 1.1 });
    // A few frames leak in while the smoothing settles (well under 0.5%); the 10% jump itself is ignored.
    expect(Math.abs(rig2.base.legLength - leg2) / leg2).toBeLessThan(0.005);
  });
});

describe('slow re-base never absorbs a held fault', () => {
  const holds: [string, Parameters<Rig['set']>[0]][] = [
    ['a bow (shoulder-hip distance)', { trunkLeanDeg: 30 }],
    ['lifted heels', { heelLiftPct: 6 }],
    ['a foot held off the floor', { leftFootLift: 8 }],
  ];
  for (const [name, patch] of holds) {
    it(`keeps the standing base while the patient holds ${name} still`, () => {
      const rig = new Rig(SQUAT_LANDMARKS);
      const before = rig.lockBase();
      for (let i = 0; i < 10 * FPS; i += 1) rig.step(patch);
      const after = rig.base;
      expect(after.shoulderHipDist).toBeCloseTo(before.shoulderHipDist, 3);
      expect(after.heelToeDiff.left).toBeCloseTo(before.heelToeDiff.left, 3);
      expect(after.floorY.left).toBeCloseTo(before.floorY.left, 3);
      expect(after.kneeY.left).toBeCloseTo(before.kneeY.left, 3);
    });
  }
});

describe('tracking health', () => {
  it('goes unhealthy after 3 frames without a person and recovers after 3 good frames', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    rig.step({ tracking: false });
    rig.step();
    expect(rig.status!.healthy).toBe(true);
    rig.step();
    expect(rig.status!.healthy).toBe(false);
    expect(rig.status!.message).toBe(MSG.body);
    rig.step({ tracking: true });
    rig.step();
    expect(rig.status!.healthy).toBe(false);
    rig.step();
    expect(rig.status!.healthy).toBe(true);
    expect(rig.status!.message).toBeNull();
  });

  it('asks to step back when the feet are not visible', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    for (let i = 0; i < 4; i += 1) rig.step(undefined, withVisibility(mockPose(rig.params, rig.t + 1 / FPS)!, [LM.lFoot, LM.rFoot], 0.2));
    expect(rig.status!.healthy).toBe(false);
    expect(rig.status!.message).toBe(MSG.feet);
  });

  it('asks to come closer when the legs fill less than 25% of the frame height', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    for (let i = 0; i < 6; i += 1) rig.step(undefined, scalePose(mockPose(rig.params, rig.t + 1 / FPS)!, 0.5));
    expect(rig.status!.healthy).toBe(false);
    expect(rig.status!.message).toBe(MSG.closer);
  });

  it('asks to step back when the legs fill more than 55% of the frame height', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    for (let i = 0; i < 6; i += 1) rig.step(undefined, scalePose(mockPose(rig.params, rig.t + 1 / FPS)!, 1.6));
    expect(rig.status!.healthy).toBe(false);
    expect(rig.status!.message).toBe(MSG.feet);
  });

  it('stays healthy through a deep squat (base leg length, not the shortened live one)', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    for (let i = 0; i < FPS; i += 1) rig.step({ hipDropPct: 58 });
    expect(rig.status!.healthy).toBe(true);
  });

  it('does not require the legs for seated play', () => {
    const rig = new Rig([11, 12, 23, 24], { seated: true });
    for (let i = 0; i < 6; i += 1) rig.step(undefined, withVisibility(mockPose(rig.params, rig.t + 1 / FPS)!, [27, 28, 29, 30, 31, 32], 0.1));
    expect(rig.status!.healthy).toBe(true);
  });
});

describe('one-person lock', () => {
  it('ignores a second person and keeps the base, then picks the patient back up', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    const base = rig.lockBase();
    // The mock's detector latches onto someone else for 1 s in every 4 (t % 4 >= 3).
    while (rig.t % 4 < 2.9) rig.step();
    rig.set({ secondPerson: true });
    let sawOther = false;
    for (let i = 0; i < 1.2 * FPS; i += 1) {
      const s = rig.step();
      if (rig.t % 4 >= 3) {
        sawOther = true;
        expect(s.frame).toBeNull();
        expect(s.personLocked).toBe(false);
      }
    }
    expect(sawOther).toBe(true);
    expect(rig.base.legLength).toBeCloseTo(base.legLength, 4);
    expect(rig.base.hipMid.x).toBeCloseTo(base.hipMid.x, 4);
    for (let i = 0; i < 5; i += 1) rig.step();
    expect(rig.status!.personLocked).toBe(true);
    expect(rig.status!.healthy).toBe(true);
  });

  it('does not mistake the patient for someone else when they turn sideways or back', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    for (let i = 0; i < FPS; i += 1) {
      const s = rig.step({ view: 'side' });
      expect(s.personLocked).toBe(true);
    }
    expect(rig.status!.view).toBe('side');
    for (let i = 0; i < FPS; i += 1) {
      const s = rig.step({ view: 'front' });
      expect(s.personLocked).toBe(true);
    }
    expect(rig.status!.view).toBe('front');
  });

  it('does not mistake a side-on patient for someone else when they face the mirror', () => {
    const rig = new Rig(SQUAT_LANDMARKS, { params: { view: 'side' } });
    rig.lockBase();
    for (let i = 0; i < FPS; i += 1) expect(rig.step({ view: 'front' }).personLocked).toBe(true);
    expect(rig.status!.view).toBe('front');
  });

  it('keeps the patient through a deep squat and a deep bow facing the mirror', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    const n = 1.5 * FPS;
    for (let i = 1; i <= n; i += 1) expect(rig.step({ hipDropPct: (60 * i) / n, hipBackRatio: 0.2 }).personLocked).toBe(true);
    for (let i = 1; i <= n; i += 1) expect(rig.step({ hipDropPct: 60 - (60 * i) / n, trunkLeanDeg: (45 * i) / n }).personLocked).toBe(true);
  });

  it('rejects someone else standing where the patient was, at a different size', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    for (let i = 0; i < 5; i += 1) rig.step({ distanceScale: 0.6 });
    expect(rig.status!.personLocked).toBe(false);
    expect(rig.status!.frame).toBeNull();
  });

  it('re-locks and takes a new base after the patient is gone for 3 s', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    for (let i = 0; i < 2.5 * FPS; i += 1) rig.step({ tracking: false });
    expect(rig.tracker.getBase()).not.toBeNull();
    for (let i = 0; i < 0.6 * FPS; i += 1) rig.step();
    expect(rig.tracker.getBase()).toBeNull();
    // Someone new (smaller, elsewhere) is now accepted and gets their own base.
    rig.set({ tracking: true, distanceScale: 0.9, bodyShiftX: 0.15 });
    const base = rig.lockBase();
    expect(base.legLength).toBeCloseTo((MOCK_BODY.thigh + MOCK_BODY.shin) * 0.9, 3);
  });

  it('keeps depth ratios when the patient drifts closer (live scale)', () => {
    const rig = new Rig(SQUAT_LANDMARKS);
    rig.lockBase();
    for (let i = 0; i < 2 * FPS; i += 1) rig.step({ distanceScale: 1 + (0.15 * i) / (2 * FPS) });
    for (let i = 0; i < FPS; i += 1) rig.step();
    expect(rig.status!.personLocked).toBe(true);
    // The slow re-base may follow part of the drift; base × live scale must still be the live size.
    const live = (MOCK_BODY.thigh + MOCK_BODY.shin) * 1.15;
    const frame = rig.status!.frame!;
    expect(liveScale(frame.pts, rig.base, 'front') * rig.base.legLength).toBeCloseTo(live, 2);
    expect(Math.abs(frame.scale * rig.base.legLength - live) / live).toBeLessThan(0.01);
  });
});

describe('toe-out from world landmarks', () => {
  function world(toeOutDeg: number): V3[] {
    const w: V3[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
    const a = (toeOutDeg * Math.PI) / 180;
    for (const [heel, foot, sign] of [
      [LM.lHeel, LM.lFoot, 1],
      [LM.rHeel, LM.rFoot, -1],
    ] as const) {
      w[heel] = { x: sign * 0.1, y: 0.9, z: 0 };
      // Toward the camera is smaller z; outward is the side's own lateral direction.
      w[foot] = { x: sign * 0.1 + sign * 0.2 * Math.sin(a), y: 0.9, z: -0.2 * Math.cos(a) };
    }
    return w;
  }
  const pts = mockPose(DEFAULT_MOCK_PARAMS, 0)!.landmarks.map((l) => ({ x: l.x * (16 / 9), y: l.y }));

  for (const deg of [0, 10, 25, 40]) {
    it(`reads ${deg} deg on both feet`, () => {
      expect(toeOutFromWorld(world(deg), pts, 'left')).toBeCloseTo(deg, 5);
      expect(toeOutFromWorld(world(deg), pts, 'right')).toBeCloseTo(deg, 5);
    });
  }

  it('is 0 without world landmarks', () => {
    expect(toeOutFromWorld(null, pts, 'left')).toBe(0);
  });
});
