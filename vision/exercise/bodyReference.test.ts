import { describe, expect, it } from 'vitest';
import { calculateJointAngles } from '../pose/jointAngles';
import { summarizePosture } from '../pose/postureMetrics';
import { blankLandmarks, poseFromLandmarks, setLandmark } from '../test/fixtures';
import type { PoseLandmark, PoseResult } from '../types';
import { measureLungeForm } from './lungeForm';
import { REP_ANGLE_RANGES, applyRepAngleRanges, repAngleRangesFor } from './repAngleRanges';
import { RepDetector } from './RepDetector';
import { measureSquatForm } from './squatForm';
import { makeExercise, makeTrackingRule, snapshotWithAngles } from './testFixtures';

/** Front-on standing body: left shoulder 5° low, feet level. Image x is the patient's right → left. */
function frontStanding(options: { leftKneeBend?: number } = {}): PoseLandmark[] {
  const lm = blankLandmarks(0);
  const set = (name: Parameters<typeof setLandmark>[1], x: number, y: number) =>
    setLandmark(lm, name, { x, y, z: 0, visibility: 0.95 });
  set('nose', 0.5, 0.12);
  set('leftEye', 0.53, 0.1);
  set('rightEye', 0.47, 0.1);
  set('leftEar', 0.56, 0.11);
  set('rightEar', 0.44, 0.11);
  // Shoulder line 5° off level, left side lower.
  const half = 0.12;
  const drop = Math.tan((5 * Math.PI) / 180) * half;
  set('leftShoulder', 0.5 + half, 0.3 + drop);
  set('rightShoulder', 0.5 - half, 0.3 - drop);
  set('leftElbow', 0.64, 0.45);
  set('rightElbow', 0.36, 0.45);
  set('leftWrist', 0.65, 0.58);
  set('rightWrist', 0.35, 0.58);
  set('leftHip', 0.56, 0.56);
  set('rightHip', 0.44, 0.56);
  // Left knee pushed forward-and-sideways is not possible in 2D; bend it by moving the knee out of line.
  const bend = ((options.leftKneeBend ?? 0) * Math.PI) / 180;
  set('leftKnee', 0.56 + Math.sin(bend / 2) * 0.18, 0.74);
  set('rightKnee', 0.44, 0.74);
  set('leftAnkle', 0.56, 0.92);
  set('rightAnkle', 0.44, 0.92);
  set('leftHeel', 0.56, 0.94);
  set('rightHeel', 0.44, 0.94);
  set('leftFootIndex', 0.57, 0.95);
  set('rightFootIndex', 0.43, 0.95);
  return lm;
}

/** The same body seen by a camera rolled by `deg` (rotation about the image centre). */
function rolled(landmarks: PoseLandmark[], deg: number): PoseLandmark[] {
  const t = (deg * Math.PI) / 180;
  return landmarks.map((lm) => {
    const dx = lm.x - 0.5;
    const dy = lm.y - 0.5;
    return { ...lm, x: 0.5 + dx * Math.cos(t) - dy * Math.sin(t), y: 0.5 + dx * Math.sin(t) + dy * Math.cos(t) };
  });
}

function square(landmarks: PoseLandmark[]): PoseResult {
  return { ...poseFromLandmarks(landmarks), frameAspect: 1 };
}

describe('screen-locked exercise references (camera roll)', () => {
  it('measures squat tilts against the screen edges: a rolled camera adds its roll', () => {
    const upright = measureSquatForm(square(frontStanding()), { frameAspect: 1 });
    const tilted = measureSquatForm(square(rolled(frontStanding(), 20)), { frameAspect: 1 });
    expect(upright?.view).toBe('front');
    expect(tilted?.view).toBe('front');
    expect(upright!.shoulderTilt!.deg).toBeCloseTo(5, 0);
    expect(tilted!.shoulderTilt!.deg).toBeCloseTo(25, 0);
    expect(tilted!.upImage).toEqual({ x: 0, y: -1 });
  });

  it('measures lunge tilts against the screen edges too', () => {
    const tilted = measureLungeForm(square(rolled(frontStanding(), -25)), { frameAspect: 1, leadSide: 'right' });
    expect(tilted.upImage).toEqual({ x: 0, y: -1 });
    expect(tilted.pelvisTilt!.deg).toBeCloseTo(25, 0);
  });

  it('keeps image-space joint angles under camera roll on a non-square frame', () => {
    const base = frontStanding();
    const toWide = (lms: PoseLandmark[]) =>
      // Same physical pose on a 16:9 frame: normalized x shrinks by the aspect.
      lms.map((lm) => ({ ...lm, x: 0.5 + (lm.x - 0.5) / (16 / 9) }));
    const a = calculateJointAngles({ ...poseFromLandmarks(toWide(base)), frameAspect: 16 / 9 });
    const b = calculateJointAngles({ ...poseFromLandmarks(toWide(rolled(base, 30))), frameAspect: 16 / 9 });
    const elbowA = a.joints.left_elbow;
    const elbowB = b.joints.left_elbow;
    expect(elbowA.available && elbowB.available).toBe(true);
    if (elbowA.available && elbowB.available) expect(elbowB.angle).toBeCloseTo(elbowA.angle, 0);
  });
});

describe('knee side-consistency in metric space', () => {
  it('does not reject a normal knee as left/right confusion', () => {
    const world = blankLandmarks(0.95);
    // Metres: hips 0.2 m apart, thigh 0.42 m.
    setLandmark(world, 'leftShoulder', { x: 0.2, y: -0.5, z: 0 });
    setLandmark(world, 'rightShoulder', { x: -0.2, y: -0.5, z: 0 });
    setLandmark(world, 'leftHip', { x: 0.1, y: 0, z: 0 });
    setLandmark(world, 'rightHip', { x: -0.1, y: 0, z: 0 });
    setLandmark(world, 'leftKnee', { x: 0.1, y: 0.42, z: -0.05 });
    setLandmark(world, 'rightKnee', { x: -0.1, y: 0.42, z: -0.05 });
    setLandmark(world, 'leftAnkle', { x: 0.1, y: 0.82, z: 0 });
    setLandmark(world, 'rightAnkle', { x: -0.1, y: 0.82, z: 0 });
    const pose = poseFromLandmarks(blankLandmarks(0.95), 0, world);
    const snapshot = calculateJointAngles(pose);
    expect(snapshot.joints.left_knee.available).toBe(true);
    expect(snapshot.joints.right_knee.available).toBe(true);
  });
});

describe('rep angle ranges', () => {
  function squatExercise() {
    return applyRepAngleRanges(
      makeExercise({
        id: 'library_squat',
        name: 'Squat',
        recommendedReps: 10,
        trackingRules: [
          makeTrackingRule({ joint: 'left_knee', startAngle: 170, requiredAngle: 95 }),
          makeTrackingRule({ joint: 'right_knee', startAngle: 170, requiredAngle: 95 }),
        ],
      }),
    );
  }

  function run(detector: RepDetector, angles: number[]): number {
    let t = 0;
    for (const angle of angles) {
      t += 400;
      detector.update(snapshotWithAngles({ left_knee: angle, right_knee: angle }, t));
    }
    return detector.getRepCount();
  }

  it('applies the configured squat knee window', () => {
    const rule = squatExercise().trackingRules[0]!;
    expect(rule.targetRange).toEqual(REP_ANGLE_RANGES.squat.left_knee!.target);
    expect(rule.targetRange).toEqual({ min: 80, max: 100 });
    expect(rule.startRange).toEqual({ min: 145, max: 180 });
  });

  it('counts a squat that reaches 80–100° and returns to standing', () => {
    expect(run(new RepDetector(squatExercise()), [175, 150, 120, 95, 120, 150, 175])).toBe(1);
  });

  it('does not count a squat that stops above 100°', () => {
    expect(run(new RepDetector(squatExercise()), [175, 150, 110, 150, 175])).toBe(0);
  });

  it('counts a squat that goes through the window and deeper', () => {
    expect(run(new RepDetector(squatExercise()), [175, 140, 70, 140, 175])).toBe(1);
  });

  it('matches generated exercises by name', () => {
    expect(repAngleRangesFor({ id: 'x', name: 'Bodyweight Squat' })).toBe(REP_ANGLE_RANGES.squat);
    expect(repAngleRangesFor({ id: 'x', name: 'Reverse Lunge (left)' })).toBe(REP_ANGLE_RANGES.lunge_left);
    expect(repAngleRangesFor({ id: 'x', name: 'Seated Biceps Curl' })).toBe(REP_ANGLE_RANGES.elbow_flexion);
    expect(repAngleRangesFor({ id: 'x', name: 'Neck stretch' })).toBeNull();
  });
});

describe('posture summary', () => {
  it('ranks a bent left knee as a knee finding, not a shoulder one', () => {
    const frames = Array.from({ length: 6 }, () => {
      const lm = frontStanding({ leftKneeBend: 40 });
      // Level shoulders so only the knee deviates.
      setLandmark(lm, 'leftShoulder', { x: 0.62, y: 0.3, z: 0, visibility: 0.95 });
      setLandmark(lm, 'rightShoulder', { x: 0.38, y: 0.3, z: 0, visibility: 0.95 });
      return square(lm);
    });
    const summary = summarizePosture(frames)!;
    expect(summary.frameCount).toBe(6);
    expect(summary.findings[0]?.region).toBe('knee');
    expect(summary.findings.some((f) => f.region === 'shoulder')).toBe(false);
    expect(summary.metrics.leftKneeFlexionDeg).toBeGreaterThan(15);
  });

  it('is unaffected by camera roll', () => {
    const upright = summarizePosture(Array.from({ length: 4 }, () => square(frontStanding())))!;
    const tilted = summarizePosture(Array.from({ length: 4 }, () => square(rolled(frontStanding(), 15))))!;
    expect(tilted.metrics.shoulderTiltDeg).toBeCloseTo(upright.metrics.shoulderTiltDeg!, 0);
    expect(upright.metrics.shoulderTiltDeg).toBeGreaterThan(0);
  });
});
