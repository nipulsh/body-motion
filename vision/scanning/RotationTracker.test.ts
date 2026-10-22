import { describe, expect, it } from 'vitest';
import { RotationTracker } from './RotationTracker';
import type { RotationState } from '../types';

function tracker(): RotationTracker {
  return new RotationTracker({ smoothingAlpha: 1, deadzoneDeg: 0 });
}

function run(seq: number[]): RotationState[] {
  const t = tracker();
  return seq.map((angle) => t.update(angle));
}

describe('RotationTracker', () => {
  it('tracks a sequential 0 → 10 → 20 → 30 series', () => {
    const states = run([0, 10, 20, 30]);
    expect(states.map((s) => s.unwrappedAngle)).toEqual([0, 10, 20, 30]);
    expect(states.map((s) => s.cumulativeRotation)).toEqual([0, 10, 20, 30]);
  });

  it('unwraps 170 → 175 → 179 → -179 → -175 as 170 → 185', () => {
    const states = run([170, 175, 179, -179, -175]);
    expect(states.map((s) => Math.round(s.unwrappedAngle))).toEqual([170, 175, 179, 181, 185]);
    expect(states[3]?.unwrappedAngle).not.toBe(-179);
  });

  it('unwraps counterclockwise -170 → -175 → 179', () => {
    const states = run([-170, -175, 179]);
    expect(Math.round(states[0]?.unwrappedAngle ?? 0)).toBe(-170);
    expect(Math.round(states[1]?.unwrappedAngle ?? 0)).toBe(-175);
    expect(Math.round(states[2]?.unwrappedAngle ?? 0)).toBe(-181);
  });

  it('accumulates a full clockwise turn 0 → 360', () => {
    const seq = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360];
    const states = run(seq);
    expect(Math.round(states[states.length - 1]?.cumulativeRotation ?? 0)).toBe(360);
    expect(states[states.length - 1]?.direction).toBe('clockwise');
    expect(states[states.length - 1]?.rotationProgress).toBe(1);
  });

  it('accumulates a full counterclockwise turn 0 → -360', () => {
    const seq = [0, -30, -60, -90, -120, -150, -180, -210, -240, -270, -300, -330, -360];
    const states = run(seq);
    expect(Math.round(states[states.length - 1]?.cumulativeRotation ?? 0)).toBe(-360);
    expect(states[states.length - 1]?.direction).toBe('counterclockwise');
    expect(states[states.length - 1]?.rotationProgress).toBe(1);
  });

  it('does not produce a huge rotation from a noisy sequence', () => {
    const states = run([10, 11, 9, 12, 11, 13]);
    const last = states[states.length - 1];
    expect(Math.abs(last?.cumulativeRotation ?? 99)).toBeLessThan(8);
    expect(last?.completed).toBe(false);
  });

  it('rejects a 180° outlier instead of adding ~158°', () => {
    const t = tracker();
    t.update(20);
    t.update(21);
    const before = t.update(22);
    const outlier = t.update(180);
    const after = t.update(23);
    expect(Math.round(before.unwrappedAngle)).toBe(22);
    expect(Math.round(outlier.unwrappedAngle)).toBe(22);
    expect(Math.abs(outlier.cumulativeRotation - before.cumulativeRotation)).toBeLessThan(1);
    expect(Math.round(after.unwrappedAngle)).toBe(23);
  });

  it('unwraps 359 → 0 → 1 → 2 as 359 → 360 → 361 → 362', () => {
    const states = run([359, 0, 1, 2]);
    expect(states.map((s) => Math.round(s.unwrappedAngle))).toEqual([359, 360, 361, 362]);
    expect(Math.round(states[1]?.cumulativeRotation ?? 0)).toBe(1);
  });

  it('treats 359° → 0° as a small positive step', () => {
    const t = tracker();
    t.update(359);
    const state = t.update(0);
    expect(state.cumulativeRotation).toBeGreaterThan(0);
    expect(state.cumulativeRotation).toBeLessThan(2);
  });

  it('treats 0° → 359° as a small negative step', () => {
    const t = tracker();
    t.update(0);
    const state = t.update(359);
    expect(state.cumulativeRotation).toBeLessThan(0);
    expect(state.cumulativeRotation).toBeGreaterThan(-2);
  });

  it('zeros cumulative rotation at scan start', () => {
    const t = tracker();
    t.update(40);
    t.update(50);
    t.captureScanStart();
    const after = t.update(60);
    expect(Math.round(after.cumulativeRotation)).toBe(10);
    expect(Math.round(after.unwrappedAngle)).toBe(60);
  });
});
