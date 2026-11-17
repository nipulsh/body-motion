/**
 * Integration: captured scan frames (with poses) → uploadScanImages → multipart body.
 * Real: vision posture summary, upload form building. Mocked: the HTTP transport.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseLandmark, PoseResult } from '@vision';

const sent = vi.hoisted(() => ({ form: null as FormData | null }));

vi.mock('./client', () => ({
  apiFetch: vi.fn(),
  apiUploadWithProgress: vi.fn(async (_url: string, form: FormData) => {
    sent.form = form;
    return JSON.stringify({ scanId: 's', status: 'UPLOADED', imageCount: 1 });
  }),
}));

import { uploadScanImages } from './scans';

const IDX: Record<string, number> = {
  nose: 0, leftEye: 2, rightEye: 5, leftEar: 7, rightEar: 8, leftShoulder: 11, rightShoulder: 12,
  leftElbow: 13, rightElbow: 14, leftWrist: 15, rightWrist: 16, leftHip: 23, rightHip: 24,
  leftKnee: 25, rightKnee: 26, leftAnkle: 27, rightAnkle: 28, leftHeel: 29, rightHeel: 30,
  leftFootIndex: 31, rightFootIndex: 32,
};

function standing(leftKneeX = 0.56): PoseResult {
  const lm: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  const p: Record<string, [number, number]> = {
    nose: [0.5, 0.12], leftEye: [0.53, 0.1], rightEye: [0.47, 0.1], leftEar: [0.56, 0.11], rightEar: [0.44, 0.11],
    leftShoulder: [0.62, 0.3], rightShoulder: [0.38, 0.3], leftElbow: [0.64, 0.45], rightElbow: [0.36, 0.45],
    leftWrist: [0.65, 0.58], rightWrist: [0.35, 0.58], leftHip: [0.56, 0.56], rightHip: [0.44, 0.56],
    leftKnee: [leftKneeX, 0.74], rightKnee: [0.44, 0.74], leftAnkle: [0.56, 0.92], rightAnkle: [0.44, 0.92],
    leftHeel: [0.56, 0.94], rightHeel: [0.44, 0.94], leftFootIndex: [0.57, 0.95], rightFootIndex: [0.43, 0.95],
  };
  for (const [name, [x, y]] of Object.entries(p)) lm[IDX[name]!] = { x, y, z: 0, visibility: 0.95 };
  return { landmarks: lm, confidence: 0.95, timestamp: 0, frameAspect: 1 };
}

const blob = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

beforeEach(() => {
  sent.form = null;
});

describe('scan upload with posture measurements', () => {
  it('sends a postureMetrics field that names the bent knee', async () => {
    const frames = Array.from({ length: 6 }, (_, i) => ({ blob: blob(), angleDeg: i, pose: standing(0.62) }));
    await uploadScanImages('scan-1', frames);
    const raw = sent.form!.get('postureMetrics');
    expect(typeof raw).toBe('string');
    const posture = JSON.parse(raw as string);
    expect(posture.version).toBe(1);
    expect(posture.frameCount).toBe(6);
    expect(posture.findings[0].region).toBe('knee');
    expect(sent.form!.getAll('images')).toHaveLength(6);
  });

  it('omits the field when no frame has a pose (pose model not ready)', async () => {
    await uploadScanImages('scan-1', [{ blob: blob(), angleDeg: 0 }, blob()]);
    expect(sent.form!.get('postureMetrics')).toBeNull();
  });

  it('keeps the payload small enough for the server limit', async () => {
    const frames = Array.from({ length: 80 }, (_, i) => ({ blob: blob(), angleDeg: i, pose: standing() }));
    await uploadScanImages('scan-1', frames);
    expect((sent.form!.get('postureMetrics') as string).length).toBeLessThan(64_000);
  });
});
