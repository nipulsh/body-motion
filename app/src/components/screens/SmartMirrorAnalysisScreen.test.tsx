/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MIRROR_SCAN_COUNTDOWN_MS,
  MIRROR_SCAN_INSTRUCTION_HOLD_MS,
} from '../smartMirror/mirrorScanPreamble';
import { SmartMirrorAnalysisScreen } from './SmartMirrorAnalysisScreen';

const dispatch = vi.fn();
const speak = vi.fn();
const cancel = vi.fn();
const listDevices = vi.fn(async () => [{ deviceId: 'cam-1', label: 'Webcam' }]);
const startCamera = vi.fn(async () => ({}));
const stopCamera = vi.fn();
const startScan = vi.fn(async () => undefined);
const stopScan = vi.fn();
const attachVideo = vi.fn();
const attachStreamToVideo = vi.fn(async () => undefined);
const setScanCaptureMode = vi.fn();

vi.mock('../../workflow/WorkflowContext', () => ({
  useWorkflow: () => ({
    dispatch,
    state: {
      scanCaptureMode: 'TIMED_BURST',
      cameraDeviceId: null,
      patientId: null,
      activePatient: null,
    },
  }),
}));

vi.mock('../../hooks/useRequiresOnline', () => ({
  useRequiresOnline: () => ({ isOnline: true, offlineMessage: 'Offline' }),
}));

vi.mock('../smartMirror/MirrorHandNavContext', () => ({
  useMirrorHandNav: () => ({
    analysisCaptureActive: false,
    setAnalysisCaptureActive: vi.fn(),
  }),
}));

vi.mock('../../hooks/useVoiceInstructions', () => ({
  useVoiceInstructions: () => ({ speak, cancel }),
}));

vi.mock('../../hooks/useVision', () => ({
  guidanceToCopy: () => '',
  isHighPriorityGuidance: () => false,
  useVision: () => ({
    listDevices,
    attachVideo,
    attachStreamToVideo,
    startCamera,
    stopCamera,
    setScanCaptureMode,
    startScan,
    stopScan,
    getScanResult: () => null,
    scanState: 'idle',
    guidance: null,
    error: null,
    targetCount: 80,
  }),
}));

describe('SmartMirrorAnalysisScreen', () => {
  let container: HTMLDivElement;
  let root: Root;
  let mounted = false;

  beforeEach(() => {
    dispatch.mockClear();
    speak.mockClear();
    cancel.mockClear();
    listDevices.mockClear();
    startCamera.mockClear();
    stopCamera.mockClear();
    startScan.mockClear();
    stopScan.mockClear();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mounted = true;
  });

  afterEach(() => {
    if (mounted) {
      act(() => root.unmount());
      mounted = false;
    }
    container.remove();
  });

  function renderScreen() {
    act(() => {
      root.render(<SmartMirrorAnalysisScreen />);
    });
  }

  function unmountScreen() {
    if (!mounted) return;
    act(() => root.unmount());
    mounted = false;
  }

  function expectBlackStageWithoutVisibleVideo() {
    const card = container.querySelector('[data-testid="mirror-analysis-card"]');
    const viewport = container.querySelector('[data-testid="mirror-analysis-viewport"]');
    expect(card).not.toBeNull();
    expect(card?.className).toContain('bg-black');
    expect(viewport).not.toBeNull();
    expect(viewport?.className).toContain('bg-black');
    expect(viewport?.className).not.toMatch(/bg-black\/\d+/);
    expect(viewport?.querySelector('video')).toBeNull();
    expect(viewport?.querySelector('canvas')).toBeNull();
    expect(container.querySelector('canvas')).toBeNull();

    const videos = [...container.querySelectorAll('video')];
    expect(videos).toHaveLength(1);
    const camera = videos[0];
    expect(camera?.getAttribute('data-testid')).toBe('mirror-analysis-camera');
    expect(camera?.getAttribute('aria-hidden')).toBe('true');
    expect(camera?.className).toContain('opacity-0');
    expect(camera?.className).toContain('-left-[9999px]');
    expect(camera?.className).not.toContain('inset-0');
    expect(camera?.className).not.toContain('object-cover');
    expect(viewport?.contains(camera ?? null)).toBe(false);
  }

  it('shows a black stage and keeps the capture camera out of the viewport before Start', () => {
    renderScreen();
    expectBlackStageWithoutVisibleVideo();
    expect(container.querySelector('[data-testid="mirror-analysis-start"]')?.textContent).toBe('Start');
    expect(startCamera).not.toHaveBeenCalled();
  });

  it('keeps the shared camera running until Start so hand navigation can click Back and Start', () => {
    renderScreen();
    expect(
      container.querySelector('[data-testid="mirror-analysis-back"]')?.getAttribute(
        'data-mirror-gesture-target',
      ),
    ).toBe('true');
    expect(
      container.querySelector('[data-testid="mirror-analysis-start"]')?.getAttribute(
        'data-mirror-gesture-target',
      ),
    ).toBe('true');

    const back = container.querySelector<HTMLButtonElement>('[data-testid="mirror-analysis-back"]');
    act(() => back?.click());
    expect(stopCamera).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith({ type: 'RESET_CAPTURES' });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_STAGE', stage: 'mirror_home' });
  });

  it('does not stop the camera if Analyse unmounts before Start', () => {
    renderScreen();
    unmountScreen();
    expect(stopCamera).not.toHaveBeenCalled();
  });

  it('plays briefing and counts down before starting the scan', async () => {
    vi.useFakeTimers();
    renderScreen();
    const start = container.querySelector<HTMLButtonElement>('[data-testid="mirror-analysis-start"]');
    await act(async () => {
      start?.click();
      await Promise.resolve();
    });
    expect(listDevices).toHaveBeenCalled();
    expect(setScanCaptureMode).toHaveBeenCalledWith('TIMED_BURST');
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CAMERA_DEVICE', deviceId: 'cam-1' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(startCamera).toHaveBeenCalledWith('cam-1');
    expect(attachVideo).toHaveBeenCalled();
    expect(startScan).not.toHaveBeenCalled();
    const prep = container.querySelector('[data-testid="mirror-analysis-prep-overlay"]');
    expect(prep).not.toBeNull();
    expect(prep?.className).toContain('bg-black');
    expect(prep?.className).not.toMatch(/bg-black\/\d+/);
    expect(prep?.textContent).toContain('Stand facing the camera');
    expectBlackStageWithoutVisibleVideo();
    expect(speak).toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(MIRROR_SCAN_INSTRUCTION_HOLD_MS);
    });
    const countdown = container.querySelector('[data-testid="mirror-analysis-countdown-overlay"]');
    expect(countdown?.textContent).toBe('3');
    expect(countdown?.className).toContain('bg-black');
    expect(countdown?.className).not.toMatch(/bg-black\/\d+/);
    expectBlackStageWithoutVisibleVideo();

    for (let step = 0; step < 3; step += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(MIRROR_SCAN_COUNTDOWN_MS);
      });
    }
    await act(async () => {
      await Promise.resolve();
    });
    expect(startScan).toHaveBeenCalled();
    expect(stopCamera).not.toHaveBeenCalled();
    expectBlackStageWithoutVisibleVideo();
    unmountScreen();
    expect(stopCamera).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('uses a connected external camera instead of the laptop camera', async () => {
    listDevices.mockResolvedValueOnce([
      { deviceId: 'laptop', label: 'HP Wide Vision HD Camera' },
      { deviceId: 'usb', label: 'USB Camera' },
    ]);
    renderScreen();
    const start = container.querySelector<HTMLButtonElement>('[data-testid="mirror-analysis-start"]');
    await act(async () => {
      start?.click();
      await Promise.resolve();
    });
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_CAMERA_DEVICE', deviceId: 'usb' });
    await act(async () => {
      await Promise.resolve();
    });
    expect(startCamera).toHaveBeenCalledWith('usb');
  });
});
