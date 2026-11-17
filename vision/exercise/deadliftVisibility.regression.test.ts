/**
 * Regression for the 2026-11-02 deadlift recording (screen capture of a side-view set).
 * The hip angle kept updating while the banner said "Move so your whole back is in view",
 * and the rep counter stayed at 0. The outline trace had failed; the landmarks had not.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX } from '../pose/landmarks';
import { resetNeutralSpineProfile } from '../posture/NeutralSpineCalibrator';
import { recordingContext } from '../test/recordingContext';
import { hinge } from '../test/deadliftHinge';
import type { PoseResult } from '../types';
import { DeadliftFormMonitor } from './deadliftForm';
import { drawDeadliftFormOverlay } from './deadliftFormOverlay';
import { applyRepAngleRanges } from './repAngleRanges';
import { makeExercise, makeTrackingRule } from './testFixtures';
import { MotionTracker } from '../motion/MotionTracker';

const WHOLE_BACK = 'Move so your whole back is in view';
const LANDMARKS = 'Move so your shoulders, hips, and knees stay in view';
const SIDE_ON = 'Turn side-on so your back can be checked';

beforeEach(() => {
  resetNeutralSpineProfile();
});

function emptyMask(pose: PoseResult): PoseResult {
  if (pose.silhouette) {
    pose.silhouette = { ...pose.silhouette, data: new Uint8Array(pose.silhouette.data.length) };
  }
  return pose;
}

function poseAt(leanDeg: number, timestamp: number): PoseResult {
  const pose = emptyMask(hinge({ leanDeg }));
  pose.timestamp = timestamp;
  return pose;
}

function labelsFrom(pose: PoseResult, result: ReturnType<DeadliftFormMonitor['update']>): string[] {
  const rec = recordingContext(640, 360);
  const labels: string[] = [];
  Object.assign(rec.ctx, {
    measureText: () => ({ width: 10 }),
    setLineDash() {},
    roundRect() {},
    fillText: (text: string) => labels.push(text),
  });
  drawDeadliftFormOverlay(rec.ctx, pose.landmarks, result);
  return labels;
}

const deadlift = applyRepAngleRanges(
  makeExercise({
    id: 'library_deadlift',
    name: 'Deadlift',
    recommendedReps: 8,
    formCheck: 'deadlift',
    trackingRules: [
      makeTrackingRule({
        joint: 'spine',
        movement: 'flexion',
        startAngle: 170,
        requiredAngle: 100,
        minimumAngle: 60,
        maximumAngle: 180,
        tolerance: 20,
        startingPosition: 'Standing tall',
        targetPosition: 'Hips hinged, chest lowered',
      }),
    ],
  }),
);

describe('deadlift recording regression', () => {
  it('accepts the side view, keeps the hip angle, and does not warn while the trunk hinges', () => {
    const monitor = new DeadliftFormMonitor();
    const tracker = new MotionTracker();
    tracker.startExercise(deadlift);

    let t = 0;
    const stand = poseAt(6, t);
    const standResult = monitor.update(stand, t, 0);
    const standFrame = standResult.frame!;
    const standLabels = labelsFrom(stand, standResult);
    expect(standFrame.view.cameraSideOn).toBe(true);
    expect(standFrame.view.landmarksVisible).toBe(true);
    expect(standFrame.backAngleDeg).toBeLessThan(20);
    expect(standLabels).not.toContain(WHOLE_BACK);

    const leans: number[] = [];
    for (let lean = 6; lean <= 70; lean += 8) leans.push(lean);
    for (let lean = 70; lean >= 6; lean -= 8) leans.push(lean);

    let deepestAngle = standFrame.backAngleDeg;
    let sawOutlineFailure = false;
    let repCount = 0;
    for (const lean of leans) {
      t += 80;
      const pose = poseAt(lean, t);
      const result = tracker.update(pose);
      const form = monitor.update(pose, t, result?.repCount ?? 0);
      const frame = form.frame!;
      const labels = labelsFrom(pose, form);
      expect(frame.view.cameraSideOn, `lean ${lean}`).toBe(true);
      expect(frame.view.landmarksVisible, `lean ${lean}`).toBe(true);
      expect(labels, `lean ${lean}`).not.toContain(WHOLE_BACK);
      expect(labels, `lean ${lean}`).not.toContain(LANDMARKS);
      expect(labels, `lean ${lean}`).not.toContain(SIDE_ON);
      expect(labels.some((label) => label.includes('°')), `lean ${lean}`).toBe(true);
      if (frame.backAngleDeg > deepestAngle) deepestAngle = frame.backAngleDeg;
      if (frame.backCheck === 'outline_unavailable') sawOutlineFailure = true;
      expect(result?.rules.spine?.available, `lean ${lean}`).toBe(true);
      repCount = result?.repCount ?? repCount;
    }

    expect(sawOutlineFailure).toBe(true);
    expect(deepestAngle).toBeGreaterThan(50);
    expect(repCount).toBe(1);
  });

  it('still warns when the camera is face-on', () => {
    const monitor = new DeadliftFormMonitor();
    const pose = hinge({ leanDeg: 6 });
    const lm = pose.landmarks;
    const shoulder = lm[POSE_LANDMARK_INDEX.leftShoulder]!;
    const hip = lm[POSE_LANDMARK_INDEX.leftHip]!;
    const knee = lm[POSE_LANDMARK_INDEX.leftKnee]!;
    lm[POSE_LANDMARK_INDEX.rightShoulder] = { ...shoulder, x: shoulder.x + 0.22, visibility: 0.95 };
    lm[POSE_LANDMARK_INDEX.rightHip] = { ...hip, x: hip.x + 0.18, visibility: 0.95 };
    lm[POSE_LANDMARK_INDEX.rightKnee] = { ...knee, x: knee.x + 0.16, visibility: 0.95 };
    const labels = labelsFrom(pose, monitor.update(pose, 0, 0));
    expect(labels).toContain(SIDE_ON);
    expect(labels).not.toContain(WHOLE_BACK);
  });

  it('warns when the shoulder, hip, and knee stay unseen, and not for one missed frame', () => {
    const monitor = new DeadliftFormMonitor();
    const seen = poseAt(40, 0);
    labelsFrom(seen, monitor.update(seen, 0, 0));

    const hidden = poseAt(48, 80);
    hidden.landmarks[POSE_LANDMARK_INDEX.leftKnee]!.visibility = 0;
    const brief = labelsFrom(hidden, monitor.update(hidden, 80, 0));
    expect(brief).not.toContain(LANDMARKS);
    expect(brief).not.toContain(WHOLE_BACK);

    const stillHidden = poseAt(48, 500);
    stillHidden.landmarks[POSE_LANDMARK_INDEX.leftKnee]!.visibility = 0;
    const held = labelsFrom(stillHidden, monitor.update(stillHidden, 500, 0));
    expect(held).toContain(LANDMARKS);
    expect(held).not.toContain(WHOLE_BACK);
  });
});
