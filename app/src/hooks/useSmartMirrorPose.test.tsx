/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VisionError, type PoseResult } from '@vision';
import { useSmartMirrorPose } from './useSmartMirrorPose';

type PreviewListener = (frame: {
  pose: PoseResult | null;
  timestamp: number;
  frameWidth: number;
  frameHeight: number;
}) => void;

type ExerciseListener = (payload: { pose: PoseResult | null }) => void;

const previewListeners = vi.hoisted(() => new Set<PreviewListener>());
const exerciseListeners = vi.hoisted(() => new Set<ExerciseListener>());

const manager = vi.hoisted(() => {
  const track = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
  return {
    canOwn: true,
    previewActive: false,
    track,
    stream: { getVideoTracks: () => [track] },
    attachVideo: vi.fn(),
    detachVideoIfCurrent: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    attachStreamToVideo: vi.fn(async () => undefined),
    getStream: vi.fn(),
    canOwnPosePreview: vi.fn(),
    isPosePreviewActive: vi.fn(),
    getVideoFrameSize: vi.fn(() => ({ width: 1280, height: 720 })),
    startPosePreview: vi.fn(async () => undefined),
    stopPosePreview: vi.fn(),
    subscribePosePreview: vi.fn((listener: PreviewListener) => {
      previewListeners.add(listener);
      return () => previewListeners.delete(listener);
    }),
    subscribeExerciseFrame: vi.fn((listener: ExerciseListener) => {
      exerciseListeners.add(listener);
      return () => exerciseListeners.delete(listener);
    }),
  };
});

vi.mock('@vision', () => ({
  getVisionManager: () => manager,
  VisionError: class VisionError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.name = 'VisionError';
      this.code = code;
    }
  },
  userMessageForVisionError: (code: string) => `vision:${code}`,
}));

const PREVIEW_WAIT_MS = 500;

describe('useSmartMirrorPose', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted = false;

  beforeEach(() => {
    previewListeners.clear();
    exerciseListeners.clear();
    manager.canOwn = true;
    manager.previewActive = false;
    manager.attachVideo.mockReset();
    manager.detachVideoIfCurrent.mockReset();
    manager.stopCamera.mockReset();
    manager.stopPosePreview.mockReset();
    manager.startPosePreview.mockReset();
    manager.startPosePreview.mockResolvedValue(undefined);
    manager.attachStreamToVideo.mockReset();
    manager.attachStreamToVideo.mockResolvedValue(undefined);
    manager.startCamera.mockReset();
    manager.startCamera.mockResolvedValue(manager.stream);
    manager.getStream.mockReset();
    manager.getStream.mockReturnValue(manager.stream);
    manager.track.addEventListener.mockReset();
    manager.track.removeEventListener.mockReset();
    manager.canOwnPosePreview.mockImplementation(() => manager.canOwn);
    manager.isPosePreviewActive.mockImplementation(() => manager.previewActive);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    vi.useRealTimers();
    if (mounted) {
      act(() => {
        root.unmount();
      });
    }
    container.remove();
  });

  it('starts one camera and paints pose frames without re-rendering', async () => {
    let renders = 0;
    const poses: Array<number | null> = [];

    function Probe() {
      renders += 1;
      const { error } = useSmartMirrorPose((pose) => {
        poses.push(pose?.timestamp ?? null);
      });
      return <p>{error}</p>;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    expect(manager.startCamera).toHaveBeenCalledTimes(1);
    expect(manager.startPosePreview).toHaveBeenCalledTimes(1);
    expect(document.querySelector('video')).toBeNull();
    const rendersAfterStart = renders;

    act(() => {
      for (const listener of previewListeners) {
        listener({
          pose: { landmarks: [], confidence: 1, timestamp: 10 },
          timestamp: 10,
          frameWidth: 1280,
          frameHeight: 720,
        });
        listener({ pose: null, timestamp: 20, frameWidth: 1280, frameHeight: 720 });
      }
    });

    expect(poses).toEqual([10, null]);
    expect(renders).toBe(rendersAfterStart);
  });

  it('listens to the exercise pose stream when the camera is already in use', async () => {
    manager.canOwn = false;
    const poses: Array<number | null> = [];

    function Probe() {
      useSmartMirrorPose((pose) => {
        poses.push(pose?.timestamp ?? null);
      });
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    expect(manager.startCamera).not.toHaveBeenCalled();
    expect(manager.startPosePreview).not.toHaveBeenCalled();

    const pose = { landmarks: [], confidence: 1, timestamp: 4 };
    act(() => {
      for (const listener of exerciseListeners) {
        listener({ pose });
      }
    });
    expect(poses).toEqual([4]);
  });

  it('reports permission denial and releases the camera on unmount', async () => {
    manager.startCamera.mockRejectedValue(
      new VisionError('CAMERA_PERMISSION_DENIED', 'denied'),
    );

    function Probe() {
      const { error } = useSmartMirrorPose(() => undefined);
      return <p>{error}</p>;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    expect(container.textContent).toContain('vision:CAMERA_PERMISSION_DENIED');
    expect(manager.stopCamera).not.toHaveBeenCalled();
    expect(document.querySelector('video')).toBeNull();
  });

  it('stops the preview camera when the screen unmounts', async () => {
    function Probe() {
      useSmartMirrorPose(() => undefined);
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });
    await act(async () => {
      root.unmount();
    });
    mounted = false;

    expect(manager.stopPosePreview).toHaveBeenCalled();
    expect(manager.stopCamera).toHaveBeenCalledTimes(1);
    expect(manager.detachVideoIfCurrent).toHaveBeenCalled();
  });

  it('restarts the shared preview when the exercise session releases the pose loop', async () => {
    vi.useFakeTimers();
    function Probe() {
      useSmartMirrorPose(() => undefined);
      return null;
    }

    await act(async () => {
      root.render(<Probe />);
    });
    expect(manager.startCamera).toHaveBeenCalledTimes(1);
    expect(manager.startPosePreview).toHaveBeenCalledTimes(1);

    manager.canOwn = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_WAIT_MS);
    });
    expect(manager.startPosePreview).toHaveBeenCalledTimes(1);

    manager.canOwn = true;
    manager.previewActive = false;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(PREVIEW_WAIT_MS);
    });

    expect(manager.startCamera).toHaveBeenCalledTimes(1);
    expect(manager.startPosePreview).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('clears the pose when the camera track ends', async () => {
    let ended: (() => void) | undefined;
    manager.track.addEventListener.mockImplementation((event: string, handler: () => void) => {
      if (event === 'ended') ended = handler;
    });
    const cleared: Array<null> = [];

    function Probe() {
      const { error } = useSmartMirrorPose((pose) => {
        if (!pose) cleared.push(null);
      });
      return <p>{error}</p>;
    }

    await act(async () => {
      root.render(<Probe />);
    });

    act(() => {
      ended?.();
    });

    expect(cleared).toEqual([null]);
    expect(container.textContent).toContain('camera disconnected');
  });
});
