import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import type { PoseLandmark, PoseResult } from '../types';
import { leadSideFromName } from './exerciseForm';
import { LungeFormMonitor, measureLungeForm } from './lungeForm';

type Body = Partial<Record<PoseLandmarkName, [number, number, number]>>;

/** World-space pose (metres, y down, hip-centred) and its image: square frame, half scale, so angles match. */
function poseFrom(body: Body): PoseResult {
  const world: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, z]] of Object.entries(body) as [PoseLandmarkName, [number, number, number]][]) {
    world[POSE_LANDMARK_INDEX[name]] = { x, y, z, visibility: 0.99 };
  }
  const landmarks = world.map((lm) => ({ ...lm, x: lm.x / 2 + 0.5, y: lm.y / 2 + 0.5 }));
  return { landmarks, worldLandmarks: world, confidence: 0.99, timestamp: 0, frameAspect: 1 };
}

/** Front view, right leg forward (toward the camera), front knee straight over its toe. */
const RIGHT_LUNGE: Body = {
  leftShoulder: [0.2, -0.2, 0],
  rightShoulder: [-0.2, -0.2, 0],
  leftHip: [0.12, 0.3, 0],
  rightHip: [-0.12, 0.3, 0],
  rightKnee: [-0.14, 0.55, -0.35],
  rightAnkle: [-0.14, 0.95, -0.4],
  rightFootIndex: [-0.14, 1.0, -0.55],
  leftKnee: [0.13, 0.7, 0.3],
  leftAnkle: [0.13, 0.85, 0.6],
  leftFootIndex: [0.13, 0.95, 0.7],
};

describe('measureLungeForm', () => {
  it('keeps the line green while the lead knee is within 5° of the toe line', () => {
    const frame = measureLungeForm(poseFrom(RIGHT_LUNGE), { leadSide: 'right' });
    expect(frame.engaged).toBe(true);
    // Included angle: 180° straight, smaller as the knee bends.
    expect(frame.kneeAngle!).toBeLessThan(155);
    expect(frame.kneeLine).toMatchObject({ side: 'right', onLine: true });
    expect(frame.kneeLine!.deviationDeg).toBeLessThanOrEqual(5);
    expect(frame.faults).toEqual([]);
  });

  it('turns the line red past 5° and says which way the knee went', () => {
    const inward = measureLungeForm(poseFrom({ ...RIGHT_LUNGE, rightKnee: [-0.065, 0.55, -0.35] }), { leadSide: 'right' });
    expect(inward.kneeLine!.onLine).toBe(false);
    expect(inward.kneeLine!.deviationDeg).toBeGreaterThan(5);
    expect(inward.faults).toEqual(['right_knee_inward']);

    const outward = measureLungeForm(poseFrom({ ...RIGHT_LUNGE, rightKnee: [-0.22, 0.55, -0.35] }), { leadSide: 'right' });
    expect(outward.kneeLine!.onLine).toBe(false);
    expect(outward.faults).toEqual(['right_knee_outward']);
  });

  it('colours the line while standing but only corrects once the knee bends', () => {
    const frame = measureLungeForm(
      poseFrom({ ...RIGHT_LUNGE, rightHip: [-0.12, 0.1, 0], rightKnee: [-0.19, 0.55, -0.02], rightAnkle: [-0.14, 0.95, 0] }),
      { leadSide: 'right' },
    );
    expect(frame.engaged).toBe(false);
    expect(frame.kneeLine!.onLine).toBe(false);
    expect(frame.faults).toEqual([]);
  });

  it('measures shoulder and hip lines against the screen horizontal', () => {
    const frame = measureLungeForm(poseFrom({ ...RIGHT_LUNGE, leftShoulder: [0.2, -0.15, 0] }), { leadSide: 'right' });
    // atan(0.05 / 0.4) = 7.1°, left side low.
    expect(frame.shoulderTilt).toEqual({ deg: 7.1, toward: 'left' });
    expect(frame.pelvisTilt!.deg).toBe(0);
    expect(frame.upImage).toEqual({ x: 0, y: -1 });
  });

  it('keeps the toe reference vertical through a staggered stance', () => {
    // The staggered feet tilt the foot-to-foot line, which used to tilt the reference.
    const frame = measureLungeForm(poseFrom({ ...RIGHT_LUNGE, leftAnkle: [0.13, 0.7, 0.6] }), { leadSide: 'right' });
    expect(frame.upImage).toEqual({ x: 0, y: -1 });
  });

  it('auto-detects the lead leg as the foot lower in the image', () => {
    const leftForward = measureLungeForm(poseFrom({ ...RIGHT_LUNGE, leftFootIndex: [0.13, 1.15, -0.5] }));
    expect(leftForward.leadSide).toBe('left');
    expect(measureLungeForm(poseFrom(RIGHT_LUNGE), { previousLeadSide: 'right' }).leadSide).toBe('right');
  });

  it('reads the lead leg from the exercise name', () => {
    expect(leadSideFromName('Forward lunge (right)')).toBe('right');
    expect(leadSideFromName('Reverse lunge left')).toBe('left');
    expect(leadSideFromName('Walking lunges')).toBeNull();
  });
});

describe('LungeFormMonitor', () => {
  it('holds a knee-line fault only after one second', () => {
    const monitor = new LungeFormMonitor('right');
    const off = poseFrom({ ...RIGHT_LUNGE, rightKnee: [-0.065, 0.55, -0.35] });
    expect(monitor.update(off, 0, 0).faults[0]).toMatchObject({ sustained: false });
    expect(monitor.update(off, 1000, 0).faults[0]).toMatchObject({ code: 'right_knee_inward', sustained: true });
    expect(monitor.update(poseFrom(RIGHT_LUNGE), 1500, 1)).toMatchObject({ correctReps: 0, incorrectReps: 1 });
  });
});
