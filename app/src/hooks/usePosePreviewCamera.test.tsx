/**
 * @vitest-environment jsdom
 */
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoseLandmark, PoseResult } from '@vision';
import { POSE_LANDMARK_INDEX, type PoseLandmarkName } from '@vision/pose/landmarks';
import { CAMERA_TURN_FIRST_LOCK_MS, CAMERA_TURN_SWITCH_MS } from '@vision/pose/uprightPose';
import { KioskScreenRotate } from '../components/layout/KioskScreenRotate';
import { KIOSK_CAMERA_TURN_STORAGE_KEY } from '../games/kioskCameraTurn';
import { getGameVideoOrientation } from '../games/gameVideoOrientation';
import { usePosePreviewCamera, type PosePreviewFrameSize } from './usePosePreviewCamera';

type PreviewListener = (frame: {
  pose: PoseResult | null;
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
}) => void;

const previewListeners = vi.hoisted(() => new Set<PreviewListener>());

const manager = vi.hoisted(() => {
  const track = { addEventListener: vi.fn(), removeEventListener: vi.fn() };
  return {
    track,
    stream: { getVideoTracks: () => [track] },
    attachVideo: vi.fn(),
    detachVideoIfCurrent: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    attachStreamToVideo: vi.fn(async () => undefined),
    getStream: vi.fn(),
    canOwnPosePreview: vi.fn(() => true),
    isPosePreviewActive: vi.fn(() => false),
    getVideoFrameSize: vi.fn(() => ({ width: 1920, height: 1080 })),
    startPosePreview: vi.fn(async () => undefined),
    stopPosePreview: vi.fn(),
    subscribePosePreview: vi.fn((listener: PreviewListener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    }),
    subscribeExerciseFrame: vi.fn(() => () => {}),
  };
});

vi.mock('@vision', () => ({
  getVisionManager: () => manager,
  VisionError: class VisionError extends Error {},
  userMessageForVisionError: (code: string) => `vision:${code}`,
}));

/** Standing person, upright camera view. */
const UPRIGHT: Partial<Record<PoseLandmarkName, [number, number]>> = {
  nose: [0.5, 0.12],
  leftShoulder: [0.6, 0.25],
  rightShoulder: [0.4, 0.25],
  leftHip: [0.57, 0.5],
  rightHip: [0.43, 0.5],
  leftAnkle: [0.57, 0.9],
  rightAnkle: [0.43, 0.9],
};

function rawPose(headToward: 'right' | 'left', timestamp: number): PoseResult {
  const landmarks: PoseLandmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  for (const [name, [x, y]] of Object.entries(UPRIGHT) as [PoseLandmarkName, [number, number]][]) {
    const [rx, ry] = headToward === 'right' ? [1 - y, x] : [y, 1 - x];
    landmarks[POSE_LANDMARK_INDEX[name]] = { x: rx, y: ry, z: 0, visibility: 0.95 };
  }
  return { landmarks, confidence: 0.9, timestamp, frameAspect: 16 / 9 };
}

function emit(pose: PoseResult | null, timestamp: number) {
  for (const listener of previewListeners) listener({ pose, timestamp, frameWidth: 1920, frameHeight: 1080 });
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('usePosePreviewCamera on the portrait kiosk (integration)', () => {
  let container: HTMLDivElement;
  let root: Root;
  const received: Array<{ pose: PoseResult | null; frame: PosePreviewFrameSize | null }> = [];

  function Probe() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const { turn, pictureAspect } = usePosePreviewCamera(
      videoRef,
      (pose, frame) => received.push({ pose, frame }),
      true,
    );
    return (
      <div data-testid="probe" data-turn={turn} data-aspect={pictureAspect ?? ''}>
        <video ref={videoRef} />
      </div>
    );
  }

  const probe = () => container.querySelector('[data-testid="probe"]')!;
  const lastPose = () => [...received].reverse().find((r) => r.pose)!;
  const nose = (pose: PoseResult) => pose.landmarks[POSE_LANDMARK_INDEX.nose]!;

  beforeEach(async () => {
    localStorage.clear();
    received.length = 0;
    previewListeners.clear();
    manager.startCamera.mockResolvedValue(manager.stream);
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(
        <KioskScreenRotate>
          <Probe />
        </KioskScreenRotate>,
      );
    });
    await flush();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('hands the game an upright, portrait pose from the sideways camera', () => {
    act(() => emit(rawPose('right', 1000), 1000));
    const { pose, frame } = lastPose();
    expect(frame).toEqual({ width: 1080, height: 1920 });
    expect(nose(pose!).x).toBeCloseTo(0.5);
    expect(nose(pose!).y).toBeCloseTo(0.12);
    expect(pose!.frameAspect).toBeCloseTo(9 / 16);
    expect(probe().getAttribute('data-turn')).toBe('270');
    expect(Number(probe().getAttribute('data-aspect'))).toBeCloseTo(9 / 16);
    expect(getGameVideoOrientation()).toBe('vertical');
  });

  it('follows a kiosk whose camera is turned the other way, and remembers it', () => {
    for (let t = 0; t <= CAMERA_TURN_FIRST_LOCK_MS + 100; t += 33) {
      act(() => emit(rawPose('left', t), t));
    }
    const { pose } = lastPose();
    expect(nose(pose!).y).toBeCloseTo(0.12);
    expect(probe().getAttribute('data-turn')).toBe('90');
    expect(localStorage.getItem(KIOSK_CAMERA_TURN_STORAGE_KEY)).toBe('90');
  });

  it('starts the next game from the remembered turn', async () => {
    localStorage.setItem(KIOSK_CAMERA_TURN_STORAGE_KEY, '90');
    act(() => root.unmount());
    root = createRoot(container);
    act(() => {
      root.render(
        <KioskScreenRotate>
          <Probe />
        </KioskScreenRotate>,
      );
    });
    await flush();
    expect(probe().getAttribute('data-turn')).toBe('90');
    act(() => emit(rawPose('left', 5), 5));
    expect(nose(lastPose().pose!).y).toBeCloseTo(0.12);
  });

  it('does not flip the game when the patient leans for a moment', () => {
    for (let t = 0; t <= 1000; t += 33) act(() => emit(rawPose('right', t), t));
    for (let t = 1033; t <= 1033 + CAMERA_TURN_SWITCH_MS - 200; t += 33) act(() => emit(rawPose('left', t), t));
    expect(probe().getAttribute('data-turn')).toBe('270');
  });

  it('passes a lost pose through as null', () => {
    act(() => emit(rawPose('right', 10), 10));
    act(() => emit(null, 43));
    expect(received.at(-1)?.pose).toBeNull();
    expect(received.at(-1)?.frame).toEqual({ width: 1080, height: 1920 });
  });
});
