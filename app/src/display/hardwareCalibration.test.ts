import { describe, expect, it } from 'vitest';
import { fitLandmarkToCanvas } from '@vision/pose/wireframe';
import { buildDisplaySnapshot, type MonitorReading } from './smartMirrorDisplay';
import {
  createHardwareProfile,
  hardwareProfileFromJson,
  hardwareProfileToJson,
  HARDWARE_PROFILE_STORAGE_KEY,
  initialManualDraft,
  initialManualMeasurements,
  liveReadingRows,
  loadHardwareProfile,
  measureLetterbox,
  parseManualDraft,
  readLiveHardware,
  saveHardwareProfile,
  USER_PROVIDED_PLASTIC_HEIGHT_IN,
  USER_PROVIDED_PLASTIC_WIDTH_IN,
  type KeyValueStorage,
} from './hardwareCalibration';

const laptop: MonitorReading = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1.25,
};

const tv: MonitorReading = {
  name: 'TV',
  x: 1920,
  y: 0,
  width: 1080,
  height: 1920,
  scaleFactor: 1.5,
  rotation: 90,
};

function memoryStorage(initial?: string): KeyValueStorage & { raw: string | null } {
  const store: { raw: string | null } = { raw: initial ?? null };
  return {
    get raw() {
      return store.raw;
    },
    set raw(value: string | null) {
      store.raw = value;
    },
    getItem: () => store.raw,
    setItem: (key, value) => {
      if (key !== HARDWARE_PROFILE_STORAGE_KEY) return;
      store.raw = value;
    },
  };
}

function invalidMessage(text: string): string {
  const result = hardwareProfileFromJson(text);
  return result.ok ? '' : result.message;
}

function portraitSnapshot() {
  return buildDisplaySnapshot({
    runtimeAvailable: true,
    topology: 'extend',
    monitors: [laptop, tv],
    primary: laptop,
  });
}

describe('hardware measurements', () => {
  it('letterboxes through fitLandmarkToCanvas and leaves unknown frames empty', () => {
    const box = measureLetterbox(900, 1600, 1600, 900);
    const origin = fitLandmarkToCanvas({ x: 0, y: 0 }, 900, 1600, 1600, 900, false);
    const far = fitLandmarkToCanvas({ x: 1, y: 1 }, 900, 1600, 1600, 900, false);

    expect(box).toEqual({
      offsetX: origin.x,
      offsetY: origin.y,
      drawWidth: far.x - origin.x,
      drawHeight: far.y - origin.y,
    });
    expect(box?.offsetX).toBe(0);
    expect(box?.drawWidth).toBe(900);
    expect(measureLetterbox(1080, 1920, null, null)).toBeNull();
  });

  it('reads the selected display and leaves a missing webcam unknown', () => {
    const live = readLiveHardware(portraitSnapshot(), null);
    const rows = liveReadingRows(live);

    expect(live.displayWidth).toBe(1080);
    expect(live.displayHeight).toBe(1920);
    expect(live.orientation).toBe('portrait');
    expect(live.scaleFactor).toBe(1.5);
    expect(live.rotation).toBe(90);
    expect(live.canvasWidth).toBe(1080);
    expect(live.canvasHeight).toBe(1920);
    expect(live.cameraWidth).toBeNull();
    expect(live.letterbox).toBeNull();
    expect(rows.find((row) => row.id === 'camera-resolution')).toMatchObject({
      text: 'Unknown',
      status: 'unknown',
    });
    expect(rows.find((row) => row.id === 'display-rotation')).toMatchObject({
      text: '90°',
      status: 'detected',
    });
  });

  it('keeps display rows unknown when no external display is available', () => {
    const live = readLiveHardware(buildDisplaySnapshot({
      runtimeAvailable: false,
      topology: 'unknown',
      monitors: [],
      primary: null,
    }), null);

    expect(live.displayWidth).toBeNull();
    expect(live.canvasWidth).toBeNull();
    expect(live.displayMessage).toContain('desktop window');
    expect(liveReadingRows(live).every((row) => row.status === 'unknown')).toBe(true);
  });

  it('does not let a saved detection snapshot replace a later camera size', () => {
    const live = readLiveHardware(portraitSnapshot(), {
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
    const reread = readLiveHardware(portraitSnapshot(), {
      width: 1920,
      height: 1080,
      label: 'Logitech BRIO',
      deviceId: 'usb-cam',
    });

    expect(saved.detectedSnapshot?.cameraWidth).toBe(640);
    expect(reread.cameraWidth).toBe(1920);
    expect(reread.sourceAspect).toBeCloseTo(1920 / 1080);
    expect(reread.letterbox).not.toBeNull();
  });
});

describe('hardware calibration profile', () => {
  it('starts plastic at the stated cabinet size and leaves the TV blank', () => {
    const draft = initialManualDraft();
    expect(draft.plasticHeightIn).toBe(String(USER_PROVIDED_PLASTIC_HEIGHT_IN));
    expect(draft.plasticWidthIn).toBe(String(USER_PROVIDED_PLASTIC_WIDTH_IN));
    expect(draft.panelHeightIn).toBe('');
    expect(draft.horizontalFovDeg).toBe('');
    const parsed = parseManualDraft(draft);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.manual.panelHeightIn).toBeNull();
      expect(parsed.manual.plasticHeightIn).toBe(63);
    }
  });

  it('saves and loads one local profile', () => {
    const storage = memoryStorage();
    const live = readLiveHardware(portraitSnapshot(), {
      width: 1280,
      height: 720,
      label: 'Logitech BRIO',
      deviceId: 'usb-cam',
    });
    const manual = initialManualMeasurements();
    manual.panelHeightIn = 37.5;
    const profile = createHardwareProfile(manual, live, '2026-10-22T08:00:00.000Z');
    saveHardwareProfile(profile, storage);

    expect(storage.getItem(HARDWARE_PROFILE_STORAGE_KEY)).toContain('"panelHeightIn": 37.5');
    const loaded = loadHardwareProfile(storage);
    expect(loaded.status).toBe('ok');
    if (loaded.status === 'ok') {
      expect(loaded.profile.manual.panelHeightIn).toBe(37.5);
      expect(loaded.profile.detectedSnapshot?.cameraWidth).toBe(1280);
      expect(loaded.profile.detectedSnapshot?.capturedAt).toBe('2026-10-22T08:00:00.000Z');
    }
  });

  it('round-trips exported JSON and rejects invalid files', () => {
    const live = readLiveHardware(portraitSnapshot(), null);
    const profile = createHardwareProfile(initialManualMeasurements(), live, '2026-10-22T08:00:00.000Z');
    const parsed = hardwareProfileFromJson(hardwareProfileToJson(profile));
    expect(parsed.ok).toBe(true);

    expect(invalidMessage('{')).toBe('This file is not valid JSON.');
    expect(invalidMessage('[]')).toBe('The file is not a hardware calibration profile.');
    expect(invalidMessage(JSON.stringify({ ...profile, version: 2 }))).toBe(
      'This profile version is not supported.',
    );

    const badFov = hardwareProfileFromJson(JSON.stringify({
      ...profile,
      manual: { ...profile.manual, horizontalFovDeg: 200 },
    }));
    expect(badFov.ok).toBe(false);
    if (!badFov.ok) expect(badFov.message).toContain('field of view');

    const negativeInset = hardwareProfileFromJson(JSON.stringify({
      ...profile,
      manual: { ...profile.manual, topInsetIn: -1 },
    }));
    expect(negativeInset.ok).toBe(false);
    if (!negativeInset.ok) expect(negativeInset.message).toContain('cannot be negative');

    const badRotation = hardwareProfileFromJson(JSON.stringify({
      ...profile,
      detectedSnapshot: { ...profile.detectedSnapshot, rotation: 45 },
    }));
    expect(badRotation.ok).toBe(false);
    if (!badRotation.ok) expect(badRotation.message).toContain('rotation');
  });

  it('reports a corrupt saved profile instead of applying it', () => {
    const storage = memoryStorage('{not json');
    expect(loadHardwareProfile(storage)).toMatchObject({ status: 'invalid' });
    expect(loadHardwareProfile(memoryStorage())).toEqual({ status: 'empty' });
  });
});
