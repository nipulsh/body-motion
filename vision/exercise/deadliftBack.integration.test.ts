/**
 * Integration: a whole deadlift rep through ExerciseFormMonitor → DeadliftFormMonitor → FaultTimer
 * → drawExerciseFormOverlay, the path the live session and PoseWireframeOverlay use.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { hinge, type HingeOptions } from '../test/deadliftHinge';
import { recordingContext } from '../test/recordingContext';
import { ExerciseFormMonitor } from './exerciseForm';
import { drawExerciseFormOverlay } from './formOverlay';
import { resetNeutralSpineProfile } from '../posture/NeutralSpineCalibrator';
import { makeExercise } from './testFixtures';

const DEADLIFT = makeExercise({ id: 'library_deadlift', name: 'Deadlift', formCheck: 'deadlift' });

beforeEach(() => {
  resetNeutralSpineProfile();
});

interface Phase {
  untilMs: number;
  options: HingeOptions;
  repCount: number;
}

function runRep(phases: Phase[]) {
  const monitor = new ExerciseFormMonitor();
  monitor.start(DEADLIFT);
  const timeline: Array<{ t: number; result: NonNullable<ReturnType<ExerciseFormMonitor['update']>>; labels: string[] }> = [];
  let t = 0;
  for (const phase of phases) {
    for (; t <= phase.untilMs; t += 66) {
      const pose = hinge(phase.options);
      const result = monitor.update(pose, t, phase.repCount, pose.frameAspect)!;
      const rec = recordingContext(640, 360);
      const labels: string[] = [];
      Object.assign(rec.ctx, { measureText: () => ({ width: 10 }), setLineDash() {}, roundRect() {}, fillText: (text: string) => labels.push(text) });
      drawExerciseFormOverlay(rec.ctx, pose.landmarks, result);
      timeline.push({ t, result, labels });
    }
  }
  return timeline;
}

describe('deadlift back rounding (integration)', () => {
  it('walks a rep, warns for a rounded outline, and scores that rep incorrect', () => {
    const timeline = runRep([
      { untilMs: 700, options: { leanDeg: 6, kneeBendDeg: 8 }, repCount: 0 },
      { untilMs: 1400, options: { leanDeg: 58, kneeBendDeg: 85 }, repCount: 0 },
      { untilMs: 1900, options: { leanDeg: 48, kneeBendDeg: 70, hipShiftY: -18 }, repCount: 0 },
      { untilMs: 2400, options: { leanDeg: 40, kneeBendDeg: 35 }, repCount: 0 },
      { untilMs: 4200, options: { leanDeg: 62, bendDeg: 45, kneeBendDeg: 40 }, repCount: 0 },
      { untilMs: 4800, options: { leanDeg: 8, kneeBendDeg: 8 }, repCount: 1 },
    ]);
    const phases = timeline.map((frame) => (frame.result.kind === 'deadlift' ? frame.result.frame?.phase : null));
    expect(phases).toContain('setup');
    expect(phases).toContain('initial_pull');
    expect(phases).toContain('knee_transition');
    expect(phases).toContain('lockout');
    const bottom = timeline.filter((frame) => frame.t > 2400 && frame.t <= 4200);
    const red = bottom.find((frame) =>
      frame.result.faults.some((fault) => fault.code === 'possible_combined_rounding' && fault.sustained),
    );
    expect(red, 'fault sustained during the rounded bottom').toBeDefined();
    expect(red!.labels).toContain('Possible upper- and lower-back rounding');
    const end = timeline[timeline.length - 1]!.result;
    expect(end).toMatchObject({ correctReps: 0, incorrectReps: 1 });
    expect(end.kind === 'deadlift' && end.frame?.phase).toBe('lockout');
  });

  it('a rep with a flat outline stays clear and scores correct', () => {
    const timeline = runRep([
      { untilMs: 700, options: { leanDeg: 6, kneeBendDeg: 8 }, repCount: 0 },
      { untilMs: 2000, options: { leanDeg: 65, kneeBendDeg: 40 }, repCount: 0 },
      { untilMs: 2600, options: { leanDeg: 8, kneeBendDeg: 8 }, repCount: 1 },
    ]);
    expect(timeline.every((frame) => frame.result.faults.length === 0)).toBe(true);
    expect(timeline[timeline.length - 1]!.result).toMatchObject({ correctReps: 1, incorrectReps: 0 });
  });

  it('labels the descent after lockout', () => {
    const timeline = runRep([
      { untilMs: 700, options: { leanDeg: 6, kneeBendDeg: 8 }, repCount: 0 },
      { untilMs: 1400, options: { leanDeg: 55, kneeBendDeg: 80 }, repCount: 0 },
      { untilMs: 2000, options: { leanDeg: 8, kneeBendDeg: 8 }, repCount: 0 },
      { untilMs: 2600, options: { leanDeg: 40, kneeBendDeg: 50 }, repCount: 0 },
    ]);
    const descent = timeline.filter((frame) => frame.t > 2000);
    expect(descent.some((frame) => frame.result.kind === 'deadlift' && frame.result.frame?.phase === 'lowering')).toBe(true);
  });
});
