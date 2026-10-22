/**
 * @vitest-environment jsdom
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildDisplaySnapshot, type MonitorReading } from '../../display/smartMirrorDisplay';
import {
  CLEAR_MANUAL_CONFIRMATION,
  createHardwareProfile,
  initialManualDraft,
  initialManualMeasurements,
  readLiveHardware,
} from '../../display/hardwareCalibration';
import { HardwareDiagnosticView } from './HardwareDiagnosticScreen';

const laptop: MonitorReading = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
};

const tv: MonitorReading = {
  name: 'TV',
  x: 1920,
  y: 0,
  width: 1080,
  height: 1920,
  scaleFactor: 1,
  rotation: 0,
};

function inputValue(container: HTMLElement, testId: string): { field: HTMLElement; value: string } {
  const field = container.querySelector(`[data-testid="${testId}"]`);
  if (!(field instanceof HTMLElement)) throw new Error(`Missing ${testId}`);
  const input = field.querySelector('input');
  if (!(input instanceof HTMLInputElement)) throw new Error(`Missing input for ${testId}`);
  return { field, value: input.value };
}

function renderView(props: Partial<Parameters<typeof HardwareDiagnosticView>[0]> = {}) {
  const live = props.live ?? readLiveHardware(null, null);
  const calls = { cleared: 0, refreshed: 0 };
  let root: Root;
  const container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container);
    root.render(
      <HardwareDiagnosticView
        live={live}
        draft={props.draft ?? initialManualDraft()}
        savedSnapshot={props.savedSnapshot ?? null}
        displayError={props.displayError ?? null}
        cameraError={props.cameraError ?? null}
        detectedAt={props.detectedAt ?? null}
        formError={props.formError ?? null}
        notice={props.notice ?? null}
        storageError={props.storageError ?? null}
        onDraftChange={props.onDraftChange ?? (() => undefined)}
        onRefresh={() => {
          calls.refreshed += 1;
        }}
        onSave={props.onSave ?? (() => undefined)}
        onExport={props.onExport ?? (() => undefined)}
        onImportText={props.onImportText ?? (() => undefined)}
        onClear={() => {
          calls.cleared += 1;
        }}
        confirm={props.confirm ?? (() => true)}
      />,
    );
  });
  return {
    container,
    calls,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('HardwareDiagnosticView', () => {
  let mounted: ReturnType<typeof renderView> | null = null;

  beforeEach(() => {
    mounted = null;
  });

  afterEach(() => {
    mounted?.unmount();
  });

  it('marks detected, entered, and unknown values separately', () => {
    const snapshot = buildDisplaySnapshot({
      runtimeAvailable: true,
      topology: 'extend',
      monitors: [laptop, tv],
      primary: laptop,
    });
    const live = readLiveHardware(snapshot, {
      width: 1280,
      height: 720,
      label: 'Logitech BRIO',
      deviceId: 'usb-cam',
    });
    mounted = renderView({ live, detectedAt: '2026-10-22T08:00:00.000Z' });

    const width = mounted.container.querySelector('[data-testid="live-display-width"]');
    expect(width?.textContent).toContain('1080 px');
    expect(width?.querySelector('[data-status="detected"]')).not.toBeNull();

    const rotation = mounted.container.querySelector('[data-testid="live-display-rotation"]');
    expect(rotation?.textContent).toContain('0°');

    const plastic = inputValue(mounted.container, 'field-plasticHeightIn');
    expect(plastic.value).toBe('63');
    expect(plastic.field.querySelector('[data-status="entered"]')).not.toBeNull();

    const panel = inputValue(mounted.container, 'field-panelHeightIn');
    expect(panel.value).toBe('');
    expect(panel.field.querySelector('[data-status="unknown"]')).not.toBeNull();
    expect(mounted.container.textContent).toContain('positive to the right');
  });

  it('shows unknown display and webcam rows when those readings are missing', () => {
    mounted = renderView({
      live: readLiveHardware(null, null),
      displayError: 'Could not read the connected displays.',
      cameraError: 'No webcam was found.',
    });

    expect(mounted.container.querySelector('[data-testid="live-camera-resolution"]')?.textContent).toContain('Unknown');
    expect(mounted.container.querySelector('[data-testid="live-canvas-size"]')?.textContent).toContain('Unknown');
    expect(mounted.container.querySelector('[data-testid="live-source-aspect"]')?.textContent).toContain('Unknown');
    expect(mounted.container.textContent).toContain('Could not read the connected displays.');
    expect(mounted.container.textContent).toContain('No webcam was found.');
    expect(mounted.container.querySelector('[data-testid="detection-time"]')?.textContent).toContain(
      'No successful read yet.',
    );
  });

  it('shows an import error and keeps a saved snapshot off the live camera row', () => {
    const snapshot = buildDisplaySnapshot({
      runtimeAvailable: true,
      topology: 'extend',
      monitors: [laptop, tv],
      primary: laptop,
    });
    const live = readLiveHardware(snapshot, {
      width: 1920,
      height: 1080,
      label: 'Logitech BRIO',
      deviceId: 'usb-cam',
    });
    const saved = createHardwareProfile(
      initialManualMeasurements(),
      { ...live, cameraWidth: 640, cameraHeight: 480, sourceAspect: 640 / 480, letterbox: null },
      '2026-01-01T00:00:00.000Z',
    );
    mounted = renderView({
      live,
      savedSnapshot: saved.detectedSnapshot,
      formError: 'This file is not valid JSON.',
    });

    expect(mounted.container.textContent).toContain('This file is not valid JSON.');
    expect(mounted.container.querySelector('[data-testid="live-camera-resolution"]')?.textContent).toContain('1920 × 1080');
    expect(mounted.container.querySelector('[data-testid="saved-camera-resolution"]')?.textContent).toContain('640 × 480');
  });

  it('asks before clearing manual measurements', () => {
    let asked = '';
    mounted = renderView({
      confirm: (message) => {
        asked = message;
        return false;
      },
    });
    const clear = [...mounted.container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Clear manual'),
    );
    act(() => clear?.click());
    expect(asked).toBe(CLEAR_MANUAL_CONFIRMATION);
    expect(mounted.calls.cleared).toBe(0);

    mounted.unmount();
    mounted = renderView({ confirm: () => true });
    const accept = [...mounted.container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Clear manual'),
    );
    act(() => accept?.click());
    expect(mounted.calls.cleared).toBe(1);
  });
});
