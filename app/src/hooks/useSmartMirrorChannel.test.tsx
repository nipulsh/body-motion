/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MIRROR_POSE_EVENT, MIRROR_POSE_STALE_MS } from '../display/mirrorChannel';
import { useSmartMirrorChannel, type MirrorFrameSink } from './useSmartMirrorChannel';

const listeners = vi.hoisted(() => new Map<string, (payload: unknown) => void>());
const unlisten = vi.hoisted(() => vi.fn());

vi.mock('../desktop/mirrorEvents', () => ({
  listenMirrorEvent: (event: string, handler: (payload: unknown) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(unlisten);
  },
  mirrorEmitTo: vi.fn(),
}));

function Probe({ sink }: { sink: MirrorFrameSink }) {
  useSmartMirrorChannel(sink);
  return null;
}

describe('useSmartMirrorChannel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    listeners.clear();
    unlisten.mockClear();
    vi.useFakeTimers();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (container.isConnected) {
      act(() => root.unmount());
      container.remove();
    }
    vi.useRealTimers();
  });

  it('draws a pose, clears it when the stream goes stale, and unlistens on cleanup', async () => {
    const draw = vi.fn();
    const sink: MirrorFrameSink = { current: draw };

    await act(async () => {
      root.render(<Probe sink={sink} />);
    });

    const onPose = listeners.get(MIRROR_POSE_EVENT);
    expect(onPose).toBeTypeOf('function');
    const points = Array.from({ length: 99 }, () => 0.2);
    act(() => {
      onPose?.({
        sentAt: Date.now(),
        confidence: 1,
        frameWidth: 640,
        frameHeight: 480,
        points,
      });
    });
    expect(draw).toHaveBeenCalledWith(
      expect.objectContaining({ confidence: 1 }),
      { width: 640, height: 480 },
      [],
    );

    act(() => {
      vi.advanceTimersByTime(MIRROR_POSE_STALE_MS);
    });
    expect(draw).toHaveBeenLastCalledWith(null, null, []);

    act(() => root.unmount());
    container.remove();
    expect(unlisten).toHaveBeenCalled();
  });
});
