import { describe, expect, it } from 'vitest';
import type { OrientationEstimatorLike } from '../orientation/OrientationEstimator';
import type { CapturedFrame, OrientationResult, PoseResult } from '../types';
import { poseFromLandmarks, visibleStandingLandmarks } from '../test/fixtures';
import { ScanController } from './ScanController';
import type { PoseDetectorLike } from './ScanController';

class ScriptedOrientation implements OrientationEstimatorLike {
  yawDeg = 0;
  confidence = 1;

  update(_pose: PoseResult): OrientationResult {
    return {
      yawDeg: this.yawDeg,
      rawYawDeg: this.yawDeg,
      normalizedAngle: ((this.yawDeg % 360) + 360) % 360,
      direction: 'front',
      confidence: this.confidence,
    };
  }

  reset(): void {
    this.yawDeg = 0;
    this.confidence = 1;
  }
}

function fakeFrame(): CapturedFrame {
  return {
    blob: new Blob(['frame'], { type: 'image/jpeg' }),
    timestamp: Date.now(),
    width: 1280,
    height: 720,
  };
}

function visiblePose(timestamp: number): PoseResult {
  return poseFromLandmarks(visibleStandingLandmarks(), timestamp);
}

function createController(orientation: ScriptedOrientation) {
  const poseDetector: PoseDetectorLike = {
    initialize: async () => undefined,
    processFrame: () => null,
    dispose: () => undefined,
    isReady: () => true,
  };

  return new ScanController({
    isCameraLive: () => true,
    getVideo: () =>
      ({ videoWidth: 1280, videoHeight: 720, readyState: 2, currentTime: 1 }) as HTMLVideoElement,
    poseDetector,
    captureFrame: async () => fakeFrame(),
    emit: () => undefined,
    orientationEstimator: orientation,
    runLoop: false,
    now: () => 0,
  });
}

const FRAME = { width: 1280, height: 720 };

async function pump(
  controller: ScanController,
  orientation: ScriptedOrientation,
  yawDeg: number,
  timestamp: number,
): Promise<void> {
  orientation.yawDeg = yawDeg;
  await controller.processPoseSample(visiblePose(timestamp), timestamp, FRAME, async () => fakeFrame());
}

async function enterScanning(controller: ScanController, orientation: ScriptedOrientation) {
  await controller.start();
  for (let i = 0; i < 20; i += 1) {
    await pump(controller, orientation, 0, i * 200);
    if (controller.getSnapshot().scanState === 'scanning') return;
  }
  expect(controller.getSnapshot().scanState).toBe('scanning');
}

async function holdCompleted(controller: ScanController, orientation: ScriptedOrientation, yawDeg: number, startTs: number) {
  for (let i = 0; i < 6; i += 1) {
    await pump(controller, orientation, yawDeg, startTs + i * 500);
  }
}

describe('ScanController', () => {
  it('does not complete a full turn with fewer than 30 images', async () => {
    const orientation = new ScriptedOrientation();
    const controller = createController(orientation);
    await enterScanning(controller, orientation);

    for (let i = 0; i < 29; i += 1) {
      await pump(controller, orientation, i * 10, 5_000 + i * 500);
    }

    orientation.confidence = 0;
    for (let i = 29; i < 42; i += 1) {
      await pump(controller, orientation, i * 10, 20_000 + i * 500);
    }

    const snapshot = controller.getSnapshot();
    expect(snapshot.capturedCount).toBe(29);
    expect(snapshot.scanState).toBe('scanning');
    expect(snapshot.rotation?.completed).toBe(true);
  });

  it('completes at 30 images once rotation reaches ~360°', async () => {
    const orientation = new ScriptedOrientation();
    const controller = createController(orientation);
    await enterScanning(controller, orientation);

    for (let i = 0; i < 30; i += 1) {
      await pump(controller, orientation, i * 10, 5_000 + i * 500);
    }

    orientation.confidence = 0;
    for (let i = 30; i < 40; i += 1) {
      await pump(controller, orientation, i * 10, 25_000 + i * 500);
    }
    await holdCompleted(controller, orientation, 390, 50_000);

    const snapshot = controller.getSnapshot();
    expect(snapshot.capturedCount).toBe(30);
    expect(snapshot.scanState).toBe('completed');
    expect(snapshot.result?.imageCount).toBe(30);
  });

  it('completes at 36 images with sector coverage and never exceeds 40', async () => {
    const orientation = new ScriptedOrientation();
    const controller = createController(orientation);
    await enterScanning(controller, orientation);

    for (let i = 0; i < 40; i += 1) {
      await pump(controller, orientation, i * 10, 5_000 + i * 500);
    }

    const snapshot = controller.getSnapshot();
    expect(snapshot.scanState).toBe('completed');
    expect(snapshot.capturedCount).toBeGreaterThanOrEqual(36);
    expect(snapshot.capturedCount).toBeLessThanOrEqual(40);
  });

  it('pauses capture and resumes later', async () => {
    const orientation = new ScriptedOrientation();
    const controller = createController(orientation);
    await enterScanning(controller, orientation);

    await pump(controller, orientation, 0, 1_000);
    expect(controller.getSnapshot().capturedCount).toBe(1);

    controller.pause();
    expect(controller.getSnapshot().scanState).toBe('paused');
    await pump(controller, orientation, 10, 1_500);
    expect(controller.getSnapshot().capturedCount).toBe(1);

    controller.resume();
    expect(controller.getSnapshot().scanState).toBe('scanning');
    await pump(controller, orientation, 10, 2_000);
    expect(controller.getSnapshot().capturedCount).toBe(2);
  });

  it('cancels an in-progress scan', async () => {
    const orientation = new ScriptedOrientation();
    const controller = createController(orientation);
    await enterScanning(controller, orientation);
    controller.cancel();
    expect(controller.getSnapshot().scanState).toBe('cancelled');
    await pump(controller, orientation, 0, 1_000);
    expect(controller.getSnapshot().capturedCount).toBe(0);
  });

  it('clears a completed scan so a later start is not treated as already done', async () => {
    const orientation = new ScriptedOrientation();
    const controller = createController(orientation);
    await enterScanning(controller, orientation);

    for (let i = 0; i < 36; i += 1) {
      await pump(controller, orientation, i * 10, 5_000 + i * 500);
    }

    expect(controller.getSnapshot().scanState).toBe('completed');
    expect(controller.getResult()).not.toBeNull();

    controller.cancel();
    expect(controller.getSnapshot().scanState).toBe('idle');
    expect(controller.getResult()).toBeNull();
    expect(controller.getSnapshot().capturedCount).toBe(0);
  });
});
