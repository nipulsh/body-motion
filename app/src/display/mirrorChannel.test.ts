import { describe, expect, it } from 'vitest';
import {
  decodeMirrorExercise,
  decodeMirrorPose,
  encodeMirrorExercise,
  encodeMirrorPose,
  MIRROR_POSE_STALE_MS,
} from './mirrorChannel';

const now = 10_000;

describe('mirror pose channel', () => {
  it('round-trips landmarks without the camera image', () => {
    const encoded = encodeMirrorPose({
      landmarks: [{ x: 0.25, y: 0.5, z: 1, visibility: 0.9 }],
      confidence: 0.8,
      timestamp: 1,
    }, { width: 1280, height: 720 }, now);
    encoded.points = Array.from({ length: 99 }, (_, index) => (index === 0 ? 0.25 : index === 1 ? 0.5 : index === 2 ? 0.9 : 0));
    const decoded = decodeMirrorPose(encoded, now);
    expect(decoded.kind).toBe('frame');
    if (decoded.kind !== 'frame') return;
    expect(decoded.pose?.landmarks[0]).toMatchObject({ x: 0.25, y: 0.5, visibility: 0.9 });
    expect(decoded.frame).toEqual({ width: 1280, height: 720 });
    expect(decoded.hands).toEqual([]);
    expect(JSON.stringify(encoded)).not.toContain('data:image');
  });

  it('round-trips finger landmarks for both hands and keeps a single detected hand', () => {
    const fingers = Array.from({ length: 21 }, (_, index) => ({
      x: index / 20,
      y: 0.4,
      visibility: 1,
    }));
    const encoded = encodeMirrorPose(
      {
        landmarks: Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 })),
        confidence: 1,
        timestamp: 1,
      },
      { width: 640, height: 480 },
      now,
      [{ landmarks: fingers, handedness: 'Left' }],
    );
    const decoded = decodeMirrorPose(encoded, now);
    expect(decoded.kind).toBe('frame');
    if (decoded.kind !== 'frame') return;
    expect(decoded.hands).toHaveLength(1);
    expect(decoded.hands[0]?.landmarks).toHaveLength(21);
    expect(decoded.hands[0]?.landmarks[8]).toMatchObject({ x: 8 / 20, y: 0.4, visibility: 1 });
    expect(decoded.hands[1]).toBeUndefined();
  });

  it('clears the skeleton for a fresh empty pose and ignores a stale one', () => {
    const empty = decodeMirrorPose({
      sentAt: now,
      confidence: 0,
      frameWidth: 640,
      frameHeight: 480,
      points: [],
    }, now);
    expect(empty).toMatchObject({ kind: 'frame', pose: null });

    const stale = decodeMirrorPose({
      sentAt: now - MIRROR_POSE_STALE_MS - 1,
      confidence: 1,
      frameWidth: 640,
      frameHeight: 480,
      points: [],
    }, now);
    expect(stale.kind).toBe('stale');
    expect(decodeMirrorPose({ points: [1, 2] }, now).kind).toBe('invalid');
  });

  it('accepts the exercise name, demo url, and rep count, and rejects a bad payload', () => {
    const encoded = encodeMirrorExercise({
      exercise: { name: 'Shoulder Abduction', demoVideoUrl: null },
      repCount: 8,
      targetReps: 12,
    });
    expect(decodeMirrorExercise(encoded)).toEqual(encoded);
    expect(decodeMirrorExercise(null)).toBeNull();
    expect(decodeMirrorExercise({ name: 'Squat', demoVideoUrl: '/exercise-videos/squat.webm', repCount: 2, targetReps: 15 })?.demoVideoUrl)
      .toBe('/exercise-videos/squat.webm');
    expect(decodeMirrorExercise({ name: '', demoVideoUrl: null, repCount: 1, targetReps: 10 })).toBeNull();
    expect(decodeMirrorExercise({ name: 'Squat', demoVideoUrl: null, repCount: 1.5, targetReps: 10 })).toBeNull();
  });
});
