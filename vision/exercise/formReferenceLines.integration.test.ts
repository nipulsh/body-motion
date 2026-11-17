/**
 * Integration: exercise → ExerciseFormMonitor → per-exercise monitor → drawExerciseFormOverlay,
 * the same path PoseWireframeOverlay uses. Checks that every reference line drawn over the
 * camera image is square to the screen edges, frame after frame, and only turns when the whole
 * wireframe tips over.
 */
import { describe, expect, it } from 'vitest';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '../pose/landmarks';
import { recordingContext } from '../test/recordingContext';
import type { PoseLandmark, PoseResult } from '../types';
import { ExerciseFormMonitor } from './exerciseForm';
import { drawExerciseFormOverlay } from './formOverlay';
import { makeExercise } from './testFixtures';

const SIZE = 600;
type Points = Partial<Record<PoseLandmarkName, [number, number]>>;

/** Square frame, so normalized image coordinates are already isotropic. */
function pose(points: Points, timestamp: number): PoseResult {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const [name, [x, y]] of Object.entries(points) as [PoseLandmarkName, [number, number]][]) {
    landmarks[POSE_LANDMARK_INDEX[name]] = { x, y, z: 0, visibility: 0.95 };
  }
  return { landmarks, confidence: 0.95, timestamp, frameAspect: 1 };
}

/** Side-on body facing image-right; both sides share a point (the far side hidden behind). */
function sideOn(points: Partial<Record<'shoulder' | 'hip' | 'knee' | 'ankle' | 'heel' | 'toe' | 'ear', [number, number]>>): Points {
  const names = { shoulder: 'Shoulder', hip: 'Hip', knee: 'Knee', ankle: 'Ankle', heel: 'Heel', toe: 'FootIndex', ear: 'Ear' } as const;
  const out: Points = {};
  for (const [part, xy] of Object.entries(points) as [keyof typeof names, [number, number]][]) {
    out[`left${names[part]}` as PoseLandmarkName] = xy;
    out[`right${names[part]}` as PoseLandmarkName] = [xy[0] + 0.003, xy[1]];
  }
  return out;
}

function render(form: ReturnType<ExerciseFormMonitor['update']>, p: PoseResult) {
  const rec = recordingContext(SIZE, SIZE);
  const labels: string[] = [];
  Object.assign(rec.ctx, {
    measureText: () => ({ width: 10 }),
    setLineDash() {},
    roundRect() {},
    fillText: (text: string) => labels.push(text),
  });
  drawExerciseFormOverlay(rec.ctx, p.landmarks, form!);
  return { ...rec, labels };
}

const px = ([x, y]: [number, number]) => ({ x: x * SIZE, y: y * SIZE });
const from = (point: { x: number; y: number }) => (l: { x1: number; y1: number }) =>
  Math.abs(l.x1 - point.x) < 0.5 && Math.abs(l.y1 - point.y) < 0.5;

/** Ten squat frames going down, with heel/toe landmark noise of a few percent. */
function squatDescent(): Points[] {
  return Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    const noise = [0, 0.02, -0.015, 0.025, -0.02, 0.01, -0.025, 0.02, -0.01, 0.015][i]!;
    return sideOn({
      shoulder: [0.47 + 0.03 * t, 0.2 + 0.15 * t],
      hip: [0.45 - 0.1 * t, 0.5 + 0.17 * t],
      knee: [0.47 + 0.08 * t, 0.7 + 0.02 * t],
      ankle: [0.47, 0.9],
      heel: [0.44, 0.93 + noise],
      toe: [0.55, 0.93 - noise],
    });
  });
}

describe('form reference lines (integration)', () => {
  it('squat side view: back and heel references vertical, every frame of the rep', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' }));
    for (const [i, points] of squatDescent().entries()) {
      const p = pose(points, i * 33);
      const form = monitor.update(p, i * 33, 0, 1)!;
      expect(form.kind).toBe('squat');
      const { lines } = render(form, p);
      const hipLine = lines.find(from(px(points.leftHip!)));
      const heelLines = lines.filter(from(px(points.leftHeel!)));
      expect(hipLine, `frame ${i} hip`).toBeDefined();
      expect(hipLine!.x2, `frame ${i} hip`).toBeCloseTo(hipLine!.x1, 6);
      expect(hipLine!.y2, `frame ${i} hip`).toBeLessThan(hipLine!.y1);
      expect(heelLines.some((l) => Math.abs(l.x2 - l.x1) < 1e-6 && l.y2 < l.y1), `frame ${i} heel`).toBe(true);
      expect(lines.filter(from(px(points.leftFootIndex!))), `frame ${i} toe`).toHaveLength(0);
      expect(lines.filter(from(px(points.leftAnkle!))), `frame ${i} ankle`).toHaveLength(0);
    }
  });

  it('squat side view: knee and back read 0° straight and upright, and grow as the squat deepens', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' }));
    const knees: number[] = [];
    const backs: number[] = [];
    const heels: number[] = [];
    const standing = sideOn({ shoulder: [0.47, 0.2], hip: [0.47, 0.5], knee: [0.47, 0.7], ankle: [0.47, 0.9], heel: [0.44, 0.93], toe: [0.55, 0.93] });
    const first = monitor.update(pose(standing, 0), 0, 0, 1)!;
    if (first.kind !== 'squat') throw new Error('expected squat');
    expect(first.frame!.kneeAngle.left).toBe(0);
    expect(first.frame!.backAngle.left).toBe(0);
    for (const [i, points] of squatDescent().entries()) {
      const form = monitor.update(pose(points, (i + 1) * 33), (i + 1) * 33, 0, 1)!;
      if (form.kind !== 'squat') throw new Error('expected squat');
      knees.push(form.frame!.kneeAngle.left!);
      backs.push(form.frame!.backAngle.left!);
      heels.push(form.frame!.kneeHeelAngle.left!);
    }
    for (let i = 1; i < knees.length; i += 1) {
      expect(knees[i]!).toBeGreaterThan(knees[i - 1]!);
      expect(backs[i]!).toBeGreaterThan(backs[i - 1]!);
    }
    // The fixture's heel landmark carries noise, so this one is judged across the whole descent.
    expect(heels[heels.length - 1]!).toBeGreaterThan(heels[0]! + 10);
  });

  it('squat session: every number drawn reads 0° after standing still, then grows in the squat', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' }));
    // A real standing body: heel behind the knee, knee a touch bent, a slight forward lean.
    const standing = sideOn({ shoulder: [0.49, 0.2], hip: [0.47, 0.5], knee: [0.48, 0.7], ankle: [0.47, 0.9], heel: [0.44, 0.93], toe: [0.55, 0.93] });
    let t = 0;
    let last = render(monitor.update(pose(standing, t), t, 0, 1), pose(standing, t));
    expect(last.labels).toContain('Stand still to zero angles');
    for (t = 33; t <= 1200; t += 33) {
      const p = pose(standing, t);
      last = render(monitor.update(p, t, 0, 1), p);
    }
    expect(last.labels).toEqual(['0°', '0°', '0°']);

    const bottom = squatDescent()[9]!;
    const p = pose(bottom, t);
    const form = monitor.update(p, t, 0, 1)!;
    if (form.kind !== 'squat') throw new Error('expected squat');
    for (const value of [form.frame!.kneeAngle.left!, form.frame!.backAngle.left!, form.frame!.kneeHeelAngle.left!]) {
      expect(value).toBeGreaterThan(5);
    }
    expect(render(form, p).labels).not.toContain('0°');
  });

  it('squat front view: every number drawn reads 0° after standing still', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' }));
    // Slightly uneven shoulders, heels a little inside the knees.
    const standing: Points = {
      leftEye: [0.53, 0.1], rightEye: [0.47, 0.1],
      leftShoulder: [0.62, 0.31], rightShoulder: [0.38, 0.29], leftHip: [0.56, 0.56], rightHip: [0.44, 0.56],
      leftKnee: [0.57, 0.74], rightKnee: [0.43, 0.74], leftAnkle: [0.56, 0.92], rightAnkle: [0.44, 0.92],
      leftHeel: [0.555, 0.94], rightHeel: [0.445, 0.94], leftFootIndex: [0.58, 0.95], rightFootIndex: [0.42, 0.95],
    };
    let last: ReturnType<typeof render> | null = null;
    for (let t = 0; t <= 1200; t += 33) {
      const p = pose(standing, t);
      last = render(monitor.update(p, t, 0, 1), p);
    }
    expect(last!.labels).not.toContain('Stand still to zero angles');
    expect(last!.labels.filter((label) => label === '0°')).toHaveLength(4);
    expect(last!.labels.filter((label) => label === '0° R')).toHaveLength(4);
    expect(last!.labels).toHaveLength(8);
  });

  it('deadlift: draws a vertical back reference at the hip and labels how far the trunk has bent', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_deadlift', name: 'Romanian deadlift', formCheck: 'deadlift' }));
    // Hinged 50° forward of the vertical through the hip.
    const lean = (50 * Math.PI) / 180;
    const hip: [number, number] = [0.4, 0.5];
    const shoulder: [number, number] = [hip[0] + 0.25 * Math.sin(lean), hip[1] - 0.25 * Math.cos(lean)];
    const points = sideOn({ shoulder, hip, knee: [0.43, 0.7], ankle: [0.42, 0.9], heel: [0.39, 0.93], toe: [0.5, 0.93] });
    const p = pose(points, 0);
    const form = monitor.update(p, 0, 0, 1)!;
    if (form.kind !== 'deadlift') throw new Error('expected deadlift');
    expect(form.frame!.backAngleDeg).toBeCloseTo(50, 0);
    const { lines, labels } = render(form, p);
    const ref = lines.filter(from(px(hip))).find((l) => Math.abs(l.x2 - l.x1) < 1e-6 && l.y2 < l.y1);
    expect(ref).toBeDefined();
    expect(lines.filter(from(px(hip))).filter((l) => Math.abs(l.x2 - l.x1) < 1e-6)).toHaveLength(1);
    expect(labels).toContain('50°');
  });

  it('lunge: shoulder and hip references stay horizontal with staggered feet', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_lunge', name: 'Forward lunge (right)', formCheck: 'lunge' }));
    const points: Points = {
      leftShoulder: [0.6, 0.25], rightShoulder: [0.4, 0.25], leftHip: [0.56, 0.5], rightHip: [0.44, 0.5],
      leftKnee: [0.56, 0.68], rightKnee: [0.43, 0.7], leftAnkle: [0.56, 0.82], rightAnkle: [0.43, 0.92],
      leftHeel: [0.56, 0.84], rightHeel: [0.43, 0.94], leftFootIndex: [0.56, 0.86], rightFootIndex: [0.43, 0.97],
    };
    const p = pose(points, 0);
    const form = monitor.update(p, 0, 0, 1)!;
    const { lines } = render(form, p);
    for (const y of [0.25 * SIZE, 0.5 * SIZE]) {
      expect(lines.some((l) => Math.abs(l.y1 - y) < 0.5 && Math.abs(l.y2 - y) < 0.5), `line at y=${y}`).toBe(true);
    }
    // Lunges keep their toe line: only the squat moved to the heel.
    const toeLine = lines.find(from(px(points.rightFootIndex!)));
    expect(toeLine!.x2).toBeCloseTo(toeLine!.x1, 6);
  });

  it('references turn a quarter only when the whole wireframe lies down, and turn back when it stands up', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' }));
    const lying = sideOn({ shoulder: [0.8, 0.6], hip: [0.55, 0.6], knee: [0.35, 0.6], ankle: [0.15, 0.6], heel: [0.13, 0.63], toe: [0.13, 0.52] });
    const standing = sideOn({ shoulder: [0.47, 0.2], hip: [0.47, 0.5], knee: [0.47, 0.7], ankle: [0.47, 0.9], heel: [0.44, 0.93], toe: [0.55, 0.93] });
    const upAt = (points: Points, t: number) => {
      const form = monitor.update(pose(points, t), t, 0, 1)!;
      if (form.kind !== 'squat') throw new Error('expected squat');
      return form.frame!.upImage;
    };
    expect(upAt(standing, 0)).toEqual({ x: 0, y: -1 });
    for (let i = 1; i <= 4; i += 1) expect(upAt(lying, i * 33)).toEqual({ x: 0, y: -1 });
    expect(upAt(lying, 5 * 33)).toEqual({ x: 1, y: 0 });
    for (let i = 6; i <= 9; i += 1) expect(upAt(standing, i * 33)).toEqual({ x: 1, y: 0 });
    expect(upAt(standing, 10 * 33)).toEqual({ x: 0, y: -1 });
  });

  it('a new exercise starts from screen up again', () => {
    const monitor = new ExerciseFormMonitor();
    monitor.start(makeExercise({ id: 'library_squat', name: 'Squat', formCheck: 'squat' }));
    const lying = sideOn({ shoulder: [0.8, 0.6], hip: [0.55, 0.6], knee: [0.35, 0.6], ankle: [0.15, 0.6], heel: [0.13, 0.63], toe: [0.13, 0.52] });
    for (let i = 0; i < 6; i += 1) monitor.update(pose(lying, i * 33), i * 33, 0, 1);
    monitor.reset();
    const standing = sideOn({ shoulder: [0.47, 0.2], hip: [0.47, 0.5], knee: [0.47, 0.7], ankle: [0.47, 0.9], heel: [0.44, 0.93], toe: [0.55, 0.93] });
    const form = monitor.update(pose(standing, 999), 999, 0, 1)!;
    if (form.kind !== 'squat') throw new Error('expected squat');
    expect(form.frame!.upImage).toEqual({ x: 0, y: -1 });
  });
});
