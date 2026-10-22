/**
 * @vitest-environment jsdom
 */
import { createRef } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setTrackedHands } from '@vision/hand/handLandmarksBus';
import { PoseWireframeOverlay, type PoseWireframeOverlayHandle } from './PoseWireframeOverlay';

const drawPoseWireframe = vi.hoisted(() => vi.fn());
const drawHandWireframes = vi.hoisted(() => vi.fn());

vi.mock('@vision', () => ({
  drawPoseWireframe,
  drawHandWireframes,
}));

describe('PoseWireframeOverlay mirror drawing', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    setTrackedHands([]);
    drawPoseWireframe.mockClear();
    drawHandWireframes.mockClear();
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      clearRect: vi.fn(),
      canvas: { width: 900, height: 1600 },
    } as never);
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    setTrackedHands([]);
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('flips the smart-mirror skeleton horizontally and keeps the camera aspect ratio', () => {
    const ref = createRef<PoseWireframeOverlayHandle>();
    act(() => {
      root.render(<PoseWireframeOverlay ref={ref} mirrorX />);
    });
    act(() => {
      ref.current?.draw(
        { landmarks: [{ x: 0.25, y: 0.5, z: 0, visibility: 1 }], confidence: 1, timestamp: 1 },
        { width: 1920, height: 1080 },
      );
    });

    expect(drawPoseWireframe).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({ mirrorX: true, fit: 'contain', sourceWidth: 1920, sourceHeight: 1080 }),
    );
  });

  it('leaves the exercise overlay unmirrored', () => {
    const ref = createRef<PoseWireframeOverlayHandle>();
    act(() => {
      root.render(<PoseWireframeOverlay ref={ref} />);
    });
    act(() => {
      ref.current?.draw(
        { landmarks: [{ x: 0.25, y: 0.5, z: 0, visibility: 1 }], confidence: 1, timestamp: 1 },
        null,
      );
    });

    expect(drawPoseWireframe).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({ mirrorX: false, fit: 'stretch' }),
    );
  });

  it('letterboxes the exercise overlay when sourceFrame is passed with pose', () => {
    act(() => {
      root.render(
        <PoseWireframeOverlay
          pose={{ landmarks: [{ x: 0.5, y: 0.5, z: 0, visibility: 1 }], confidence: 1, timestamp: 1 }}
          sourceFrame={{ width: 1280, height: 720 }}
        />,
      );
    });

    expect(drawPoseWireframe).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Array),
      expect.objectContaining({ fit: 'contain', sourceWidth: 1280, sourceHeight: 720, mirrorX: false }),
    );
  });

  it('strokes detected hands on the exercise-session canvas', () => {
    const pose = {
      landmarks: [{ x: 0.3, y: 0.6, z: 0, visibility: 1 }],
      confidence: 1,
      timestamp: 1,
    };
    const hand = {
      landmarks: Array.from({ length: 21 }, (_, index) => ({
        x: 0.3 + index * 0.01,
        y: 0.6,
        visibility: 0,
      })),
      handedness: 'Left' as const,
    };
    setTrackedHands([hand]);

    act(() => {
      root.render(
        <PoseWireframeOverlay
          pose={pose}
          sourceFrame={{ width: 640, height: 480 }}
          mirrorX
          lineWidth={3}
          jointRadius={4}
        />,
      );
    });

    expect(drawPoseWireframe).toHaveBeenCalled();
    expect(drawHandWireframes).toHaveBeenCalledWith(
      expect.anything(),
      [hand],
      expect.objectContaining({
        mirrorX: true,
        fit: 'contain',
        sourceWidth: 640,
        sourceHeight: 480,
        lineWidth: 3,
        jointRadius: 4,
        strokeStyle: 'rgba(96, 210, 255, 0.92)',
        poseLandmarks: pose.landmarks,
      }),
    );
  });
});
