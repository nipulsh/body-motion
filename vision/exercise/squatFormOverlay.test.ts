import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import { recordingContext } from '../test/recordingContext';
import type { PoseLandmark, PoseResult } from '../types';
import { SquatFormMonitor } from './squatForm';
import { drawSquatFormOverlay } from './squatFormOverlay';

type Body = Partial<Record<PoseLandmarkName, [number, number, number]>>;

function poseFrom(body: Body): PoseResult {
  const world: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, z]] of Object.entries(body) as [PoseLandmarkName, [number, number, number]][]) {
    world[POSE_LANDMARK_INDEX[name]] = { x, y, z, visibility: 0.99 };
  }
  const landmarks = world.map((lm) => ({ ...lm, x: lm.x / 2 + 0.5, y: (lm.y + 1) / 2 }));
  return { landmarks, worldLandmarks: world, confidence: 0.99, timestamp: 0 };
}

const FRONT_SQUAT: Body = {
  leftEye: [0.03, -0.35, 0],
  rightEye: [-0.03, -0.35, 0],
  leftShoulder: [0.2, -0.15, 0.1],
  rightShoulder: [-0.2, -0.15, 0.1],
  leftHip: [0.12, 0.35, 0.3],
  rightHip: [-0.12, 0.35, 0.3],
  leftKnee: [0.14, 0.5, -0.15],
  rightKnee: [-0.14, 0.5, -0.15],
  leftAnkle: [0.13, 0.9, 0],
  rightAnkle: [-0.13, 0.9, 0],
  leftHeel: [0.13, 0.95, 0.05],
  rightHeel: [-0.13, 0.95, 0.05],
  leftFootIndex: [0.15, 0.95, -0.12],
  rightFootIndex: [-0.15, 0.95, -0.12],
};

function draw(body: Body) {
  const recording = recordingContext(400, 600);
  const labels: string[] = [];
  Object.assign(recording.ctx, {
    measureText: () => ({ width: 10 }),
    setLineDash() {},
    roundRect() {},
    fillText: (text: string) => labels.push(text),
  });
  const pose = poseFrom(body);
  drawSquatFormOverlay(recording.ctx, pose.landmarks, new SquatFormMonitor().update(pose, 0, 0));
  return { lines: recording.lines, labels };
}

const horizontal = (line: { y1: number; y2: number }) => Math.abs(line.y1 - line.y2) < 1;
const vertical = (line: { x1: number; x2: number }) => Math.abs(line.x1 - line.x2) < 1;

describe('drawSquatFormOverlay', () => {
  it('draws a vertical line from each heel in front view, not from the toes', () => {
    const { lines } = draw(FRONT_SQUAT);
    const canvas = (x: number, y: number) => ({ x: (x / 2 + 0.5) * 400, y: ((y + 1) / 2) * 600 });
    for (const heel of [canvas(0.13, 0.95), canvas(-0.13, 0.95)]) {
      const fromHeel = lines.filter((l) => Math.abs(l.x1 - heel.x) < 0.5 && Math.abs(l.y1 - heel.y) < 0.5);
      expect(fromHeel.some((l) => Math.abs(l.x2 - heel.x) < 1e-6 && l.y2 < heel.y)).toBe(true);
    }
    for (const toe of [canvas(0.15, 0.95), canvas(-0.15, 0.95)]) {
      expect(lines.filter((l) => Math.abs(l.x1 - toe.x) < 0.5 && Math.abs(l.y1 - toe.y) < 0.5)).toHaveLength(0);
    }
  });

  it('draws the central lines in front view: eyes, shoulders, trunk midline, hips', () => {
    const { lines, labels } = draw(FRONT_SQUAT);
    const at = (y: number) => lines.find((line) => horizontal(line) && Math.abs(line.y1 - y) < 1);
    expect(at(((-0.35 + 1) / 2) * 600)).toBeDefined(); // eye line
    expect(at(((-0.15 + 1) / 2) * 600)).toBeDefined(); // shoulder line
    expect(at(((0.35 + 1) / 2) * 600)).toBeDefined(); // hip line
    // Trunk midline: hip centre up to shoulder centre.
    expect(lines.find((line) => vertical(line) && Math.abs(line.x1 - 200) < 1 && line.y1 > line.y2 && line.y2 > 0)).toBeDefined();
    expect(labels.filter((label) => label === '0° R')).toHaveLength(4);
  });
});

/** Side-on squat facing image-right, on a square 600×600 frame at half scale (isotropic). */
function sidePose(feetLift = 0): PoseResult {
  const body: Body = {};
  for (const [side, z] of [['left', 0.1], ['right', -0.1]] as const) {
    body[`${side}Shoulder`] = [-0.05, -0.15, z * 2];
    body[`${side}Hip`] = [-0.25, 0.35, z];
    body[`${side}Knee`] = [0.2, 0.5, z];
    body[`${side}Ankle`] = [0, 0.9, z];
    body[`${side}Heel`] = [-0.05, 0.95 - feetLift, z];
    body[`${side}FootIndex`] = [0.15, 0.95 + feetLift, z];
  }
  const world: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, z]] of Object.entries(body) as [PoseLandmarkName, [number, number, number]][]) {
    world[POSE_LANDMARK_INDEX[name]] = { x, y, z, visibility: 0.99 };
  }
  const landmarks = world.map((lm) => ({ ...lm, x: lm.x / 2 + 0.5, y: lm.y / 2 + 0.5 }));
  return { landmarks, worldLandmarks: world, confidence: 0.99, timestamp: 0, frameAspect: 1 };
}

function drawSide(monitor: SquatFormMonitor, pose: PoseResult, timestamp = 0) {
  const recording = recordingContext(600, 600);
  const labels: string[] = [];
  Object.assign(recording.ctx, {
    measureText: () => ({ width: 10 }),
    setLineDash() {},
    roundRect() {},
    fillText: (text: string) => labels.push(text),
  });
  const form = monitor.update(pose, timestamp, 0, 1);
  drawSquatFormOverlay(recording.ctx, pose.landmarks, form);
  return { ...recording, labels, form };
}

const canvasPoint = (pose: PoseResult, name: PoseLandmarkName) => {
  const lm = pose.landmarks[POSE_LANDMARK_INDEX[name]]!;
  return { x: lm.x * 600, y: lm.y * 600 };
};
const startsAt = (p: { x: number; y: number }) => (line: { x1: number; y1: number }) =>
  Math.abs(line.x1 - p.x) < 0.5 && Math.abs(line.y1 - p.y) < 0.5;

const arcAt = (arcs: Array<{ x: number; y: number }>, p: { x: number; y: number }) =>
  arcs.some((arc) => Math.abs(arc.x - p.x) < 0.5 && Math.abs(arc.y - p.y) < 0.5);

describe('side-view squat reference lines', () => {
  it('draws the back reference exactly vertical at the hip, rising from it', () => {
    const pose = sidePose();
    const { lines, arcs } = drawSide(new SquatFormMonitor(), pose);
    const hip = canvasPoint(pose, 'leftHip');
    const ref = lines.filter(startsAt(hip));
    expect(ref).toHaveLength(1);
    expect(ref[0]!.x2).toBeCloseTo(hip.x, 6);
    expect(ref[0]!.y2).toBeLessThan(hip.y);
    expect(arcAt(arcs, hip)).toBe(true);
  });

  it('no longer draws anything at the ankle, but keeps measuring the shin', () => {
    const pose = sidePose();
    const { lines, arcs, labels, form } = drawSide(new SquatFormMonitor(), pose);
    const ankle = canvasPoint(pose, 'leftAnkle');
    expect(lines.filter(startsAt(ankle))).toHaveLength(0);
    expect(arcAt(arcs, ankle)).toBe(false);
    expect(form.frame!.ankleAngle.left).toBeGreaterThan(0);
    expect(labels).not.toContain(`${Math.round(form.frame!.ankleAngle.left!)}°`);
  });

  it('draws the vertical line from the heel, and nothing from the toe', () => {
    const pose = sidePose();
    const { lines } = drawSide(new SquatFormMonitor(), pose);
    const heel = canvasPoint(pose, 'leftHeel');
    const toe = canvasPoint(pose, 'leftFootIndex');
    const vertical = lines.filter(startsAt(heel)).filter((line) => Math.abs(line.x2 - heel.x) < 1e-6);
    expect(vertical).toHaveLength(1);
    expect(vertical[0]!.y2).toBeLessThan(heel.y);
    expect(lines.filter(startsAt(toe))).toHaveLength(0);
  });

  it('shows the knee against the heel line: a segment from heel to knee, an arc and a number', () => {
    const pose = sidePose();
    const { lines, arcs, labels, form } = drawSide(new SquatFormMonitor(), pose);
    const heel = canvasPoint(pose, 'leftHeel');
    const knee = canvasPoint(pose, 'leftKnee');
    const segment = lines
      .filter(startsAt(heel))
      .find((line) => Math.abs(line.x2 - knee.x) < 0.5 && Math.abs(line.y2 - knee.y) < 0.5);
    expect(segment).toBeDefined();
    expect(arcAt(arcs, heel)).toBe(true);
    expect(labels).toContain(`${Math.round(form.frame!.kneeHeelAngle.left!)}°`);
  });

  it('shows the knee as femur-to-tibia flexion: the femur carried past the knee, then an arc to the tibia', () => {
    const pose = sidePose();
    const { lines, arcs, labels, form } = drawSide(new SquatFormMonitor(), pose);
    const hip = canvasPoint(pose, 'leftHip');
    const knee = canvasPoint(pose, 'leftKnee');
    const ankle = canvasPoint(pose, 'leftAnkle');
    const extension = lines.filter(startsAt(knee));
    expect(extension).toHaveLength(1);
    // Carries straight on from the femur, away from the hip, for the length of the shin.
    const femur = Math.atan2(knee.y - hip.y, knee.x - hip.x);
    expect(Math.atan2(extension[0]!.y2 - knee.y, extension[0]!.x2 - knee.x)).toBeCloseTo(femur, 6);
    expect(Math.hypot(extension[0]!.x2 - knee.x, extension[0]!.y2 - knee.y)).toBeCloseTo(
      Math.hypot(ankle.x - knee.x, ankle.y - knee.y),
      6,
    );
    expect(arcAt(arcs, knee)).toBe(true);
    const frame = form.frame!;
    expect(labels).toContain(`${Math.round(frame.kneeAngle.left!)}°`);
    expect(labels).toContain(`${Math.round(frame.backAngle.left!)}°`);
    expect(frame.kneeAngle.left!).toBeGreaterThan(90);
  });

  it('keeps every reference line square to the screen while the foot landmarks jitter', () => {
    const monitor = new SquatFormMonitor();
    // Kept small enough that the toe stays inside the camera image (y ≤ 1).
    for (const [i, lift] of [0, 0.03, -0.04, 0.045, -0.02].entries()) {
      const pose = sidePose(lift);
      const { lines } = drawSide(monitor, pose, i * 33);
      const hip = canvasPoint(pose, 'leftHip');
      const heel = canvasPoint(pose, 'leftHeel');
      expect(lines.find(startsAt(hip))!.x2).toBeCloseTo(hip.x, 6);
      expect(lines.filter(startsAt(heel)).some((line) => Math.abs(line.x2 - heel.x) < 1e-6)).toBe(true);
    }
  });
});

/** Side-on, upright and relaxed: heel behind the knee, knee a touch bent, a slight natural lean. */
function standingSidePose(): PoseResult {
  const body: Body = {};
  for (const [side, z] of [['left', 0.1], ['right', -0.1]] as const) {
    body[`${side}Shoulder`] = [0.03, -0.6, z * 2];
    body[`${side}Hip`] = [0, -0.1, z];
    body[`${side}Knee`] = [0.02, 0.4, z];
    body[`${side}Ankle`] = [0, 0.9, z];
    body[`${side}Heel`] = [-0.05, 0.95, z];
    body[`${side}FootIndex`] = [0.15, 0.95, z];
  }
  const world: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y, z]] of Object.entries(body) as [PoseLandmarkName, [number, number, number]][]) {
    world[POSE_LANDMARK_INDEX[name]] = { x, y, z, visibility: 0.99 };
  }
  const landmarks = world.map((lm) => ({ ...lm, x: lm.x / 2 + 0.5, y: lm.y / 2 + 0.5 }));
  return { landmarks, worldLandmarks: world, confidence: 0.99, timestamp: 0, frameAspect: 1 };
}

describe('standing zero prompt', () => {
  const PROMPT = 'Stand still to zero angles';

  it('asks the patient to stand still until the zero is set, then stops asking', () => {
    const monitor = new SquatFormMonitor();
    const body = standingSidePose();
    expect(drawSide(monitor, body, 0).labels).toContain(PROMPT);
    let labels: string[] = [];
    for (let t = 33; t <= 1200; t += 33) labels = drawSide(monitor, body, t).labels;
    expect(labels).not.toContain(PROMPT);
    expect(labels).toEqual(['0°', '0°', '0°']);
  });
});

describe('front-view squat overlay', () => {
  it('no longer warns about the feet: references are screen-based by design', () => {
    const torsoOnly: Body = {
      leftEye: FRONT_SQUAT.leftEye!,
      rightEye: FRONT_SQUAT.rightEye!,
      leftShoulder: FRONT_SQUAT.leftShoulder!,
      rightShoulder: FRONT_SQUAT.rightShoulder!,
      leftHip: FRONT_SQUAT.leftHip!,
      rightHip: FRONT_SQUAT.rightHip!,
    };
    expect(draw(torsoOnly).labels.some((label) => /feet/i.test(label))).toBe(false);
  });
});
