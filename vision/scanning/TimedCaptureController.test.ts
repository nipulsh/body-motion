import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VISION_CONFIG } from '../config';
import type { CapturedFrame, CaptureStep } from '../types';
import { TimedCaptureController } from './TimedCaptureController';

const cfg = VISION_CONFIG.timedCapture;
const { frameCount, frameIntervalMs, framesPerStage } = cfg;
const turnGapMs = cfg.turnPromptMs + cfg.countdownFrom * cfg.countdownStepMs;
const stageMs = framesPerStage * frameIntervalMs;
/** Every stage's frames plus the turn prompt and count between stages. */
const durationMs = cfg.stages.length * stageMs + (cfg.stages.length - 1) * turnGapMs;
const video = { readyState: 2, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

function frame(tag: string): CapturedFrame {
  return {
    blob: new Blob([tag], { type: 'image/jpeg' }),
    timestamp: Date.now(),
    width: 640,
    height: 480,
  };
}

// `now` reads the fake clock so advancing timers also advances the controller's deadline checks.
function createController(captureFrame: () => Promise<CapturedFrame | null>) {
  const events: string[] = [];
  const steps: string[] = [];
  const holder: { controller?: TimedCaptureController } = {};
  const controller = new TimedCaptureController({
    isCameraLive: () => true,
    getVideo: () => video,
    captureFrame,
    emit: (event) => {
      events.push(event);
      const step: CaptureStep | null | undefined = holder.controller?.getSnapshot().captureStep;
      const label = step ? `${step.stage}:${step.phase}${step.count !== null ? `:${step.count}` : ''}` : null;
      if (label && steps[steps.length - 1] !== label) steps.push(label);
    },
    now: () => Date.now(),
  });
  holder.controller = controller;
  return { controller, events, steps };
}

describe('TimedCaptureController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('takes 10 frames facing the camera, then asks to turn right and counts 3-2-1, then the same for left', async () => {
    const { controller, events, steps } = createController(async () => frame('f'));

    await controller.start();
    await vi.advanceTimersByTimeAsync(durationMs + 500);

    expect(events).toContain('SCAN_COMPLETED');
    const angles = controller.getResult()?.images.map((image) => image.angleDeg);
    expect(angles).toEqual([
      ...Array(framesPerStage).fill(0),
      ...Array(framesPerStage).fill(90),
      ...Array(framesPerStage).fill(270),
    ]);
    expect(steps).toEqual([
      'front:capture',
      'right:turn',
      'right:count:3',
      'right:count:2',
      'right:count:1',
      'right:capture',
      'left:turn',
      'left:count:3',
      'left:count:2',
      'left:count:1',
      'left:capture',
    ]);
    expect(controller.getSnapshot().captureStep).toBeNull();
  });

  it('takes no frames while the user is being asked to turn', async () => {
    const { controller } = createController(async () => frame('f'));

    await controller.start();
    // Just past the front stage, inside the turn prompt.
    await vi.advanceTimersByTimeAsync(stageMs + 100);
    expect(controller.getSnapshot().captureStep).toMatchObject({ stage: 'right', phase: 'turn' });
    await vi.advanceTimersByTimeAsync(turnGapMs - 500);
    expect(controller.getSnapshot().capturedCount).toBe(framesPerStage);
  });

  it('does not emit SCAN_ERROR when cancelled while a frame encodes', async () => {
    let attempts = 0;
    const { controller, events } = createController(async () => {
      attempts += 1;
      await new Promise((resolve) => setTimeout(resolve, attempts === framesPerStage ? 300 : 10));
      return frame(`f${attempts}`);
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync((framesPerStage - 1) * frameIntervalMs + 50);
    controller.cancel();
    await vi.advanceTimersByTimeAsync(500);

    expect(controller.getSnapshot().scanState).toBe('cancelled');
    expect(events).toContain('SCAN_CANCELLED');
    expect(events).not.toContain('SCAN_ERROR');
    expect(events).not.toContain('SCAN_COMPLETED');
  });

  it('does not store a capture from a previous session after restart', async () => {
    let attempts = 0;
    let releaseFirst = () => {};
    const { controller } = createController(async () => {
      attempts += 1;
      if (attempts === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return frame('stale');
      }
      return frame(`f${attempts}`);
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(0);
    await controller.start();
    releaseFirst();
    await vi.advanceTimersByTimeAsync(durationMs + 500);

    const images = controller.getResult()?.images ?? [];
    expect(images).toHaveLength(frameCount);
    const contents = await Promise.all(images.map((image) => image.blob.text()));
    expect(contents).not.toContain('stale');
  });

  it('retries a null encode and still completes with all frames', async () => {
    let attempts = 0;
    const { controller, events } = createController(async () => {
      attempts += 1;
      return attempts === 1 ? null : frame(`f${attempts}`);
    });

    await controller.start();
    await vi.advanceTimersByTimeAsync(durationMs + 500);

    expect(events).toContain('SCAN_COMPLETED');
    expect(controller.getResult()?.images).toHaveLength(frameCount);
  });

  it('fails when a stage cannot get its frames in time', async () => {
    const { controller, events } = createController(async () => null);

    await controller.start();
    await vi.advanceTimersByTimeAsync(stageMs + cfg.stageSlackMs + 500);

    expect(controller.getSnapshot().scanState).toBe('error');
    expect(events).toContain('SCAN_ERROR');
    expect(events).not.toContain('SCAN_COMPLETED');
    expect(controller.getLastError()?.message).toContain(String(frameCount));
    expect(controller.getSnapshot().capturedCount).toBe(0);
  });
});
