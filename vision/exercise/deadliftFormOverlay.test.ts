import { beforeEach, describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX } from '../pose/landmarks';
import { resetNeutralSpineProfile } from '../posture/NeutralSpineCalibrator';
import { hinge } from '../test/deadliftHinge';
import { recordingContext } from '../test/recordingContext';
import type { PoseResult } from '../types';
import { DeadliftFormMonitor } from './deadliftForm';
import { drawDeadliftFormOverlay } from './deadliftFormOverlay';

beforeEach(() => {
  resetNeutralSpineProfile();
});

function labelsFor(frames: Array<{ pose: PoseResult; t: number }>): string[] {
  const monitor = new DeadliftFormMonitor();
  let result = monitor.update(frames[0]!.pose, frames[0]!.t, 0);
  for (const { pose, t } of frames.slice(1)) result = monitor.update(pose, t, 0);
  const rec = recordingContext(640, 360);
  const labels: string[] = [];
  Object.assign(rec.ctx, { measureText: () => ({ width: 10 }), setLineDash() {}, roundRect() {}, fillText: (text: string) => labels.push(text) });
  drawDeadliftFormOverlay(rec.ctx, frames[frames.length - 1]!.pose.landmarks, result);
  return labels;
}

const hold = (make: () => PoseResult, fromMs: number, toMs: number) => {
  const out: Array<{ pose: PoseResult; t: number }> = [];
  for (let t = fromMs; t <= toMs; t += 66) out.push({ pose: make(), t });
  return out;
};

const standThen = (make: () => PoseResult, fromMs: number, toMs: number) => [
  ...hold(() => hinge({ leanDeg: 6 }), 0, 700),
  ...hold(make, fromMs, toMs),
];

describe('drawDeadliftFormOverlay back read-out', () => {
  it('shows upper and lower estimates while the outline is judged', () => {
    const labels = labelsFor(standThen(() => hinge(), 800, 1100));
    expect(labels.join(' | '), labels.join(' | ')).toMatch(/Upper -?\d+% \(\d\.\d\) · Lower -?\d+% \(\d\.\d\)/);
  });

  it('names possible rounding once it has held, without calling it an injury', () => {
    const labels = labelsFor(standThen(() => hinge({ bendDeg: 45 }), 800, 2800));
    expect(labels).toContain('Possible upper- and lower-back rounding');
    expect(labels.some((label) => /injur|dangerous/i.test(label))).toBe(false);
  });

  it('says when the outline is not available instead of drawing nothing', () => {
    expect(labelsFor(hold(() => hinge({ silhouette: false }), 0, 200))).toContain('Back check unavailable on this device');
  });

  it('asks the patient to turn side-on when hinged facing the camera', () => {
    const faceOn = () => {
      const pose = hinge({ bendDeg: 40 });
      const lm = pose.landmarks;
      const ls = lm[POSE_LANDMARK_INDEX.leftShoulder]!;
      const lh = lm[POSE_LANDMARK_INDEX.leftHip]!;
      lm[POSE_LANDMARK_INDEX.rightShoulder] = { ...ls, x: ls.x + 0.2 };
      lm[POSE_LANDMARK_INDEX.rightHip] = { ...lh, x: lh.x + 0.2 };
      return pose;
    };
    expect(labelsFor(hold(faceOn, 0, 200))).toContain('Turn side-on so your back can be checked');
  });

  it('shows no back hint while standing upright', () => {
    const labels = labelsFor(hold(() => hinge({ leanDeg: 5, silhouette: false }), 0, 200));
    expect(labels.some((label) => /back/i.test(label))).toBe(false);
  });

  it('does not call a hinged side view out of frame when the outline cannot be traced', () => {
    const empty = () => {
      const pose = hinge({ leanDeg: 60 });
      pose.silhouette = { ...pose.silhouette!, data: new Uint8Array(pose.silhouette!.data.length) };
      return pose;
    };
    const labels = labelsFor(hold(empty, 0, 400));
    expect(labels).not.toContain('Move so your whole back is in view');
    expect(labels.some((label) => label.includes('°'))).toBe(true);
    expect(labels).not.toContain('Move so your shoulders, hips, and knees stay in view');
  });

  it('warns about missing landmarks only after they stay missing', () => {
    const hidden = () => hinge({ hideKnee: true, leanDeg: 50 });
    const brief = labelsFor(hold(hidden, 0, 120));
    expect(brief).not.toContain('Move so your shoulders, hips, and knees stay in view');
    const held = labelsFor(hold(hidden, 0, 500));
    expect(held).toContain('Move so your shoulders, hips, and knees stay in view');
    expect(held).not.toContain('Move so your whole back is in view');
  });
});
