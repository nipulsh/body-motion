import { describe, expect, it } from 'vitest';
import { selectSmartMirrorDisplay } from './smartMirrorDisplay';
import { parseElectronDisplayPayload } from './displaySnapshotPayload';

const laptop = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1.25,
  rotation: 0,
};

const tv = {
  name: 'TV',
  x: 1920,
  y: 0,
  width: 1111,
  height: 2222,
  scaleFactor: 1.5,
  rotation: 90,
};

function payload(monitors = [laptop, tv], primary = laptop) {
  return {
    runtimeAvailable: true,
    topology: 'extend',
    monitors,
    primary,
  };
}

describe('parseElectronDisplayPayload', () => {
  it('selects the same external display the smart-mirror window uses', () => {
    const parsed = parseElectronDisplayPayload(payload());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const selection = selectSmartMirrorDisplay(parsed.snapshot);
    expect(selection.status).toBe('selected');
    expect(selection.candidate).toMatchObject({
      name: 'TV',
      width: 1111,
      height: 2222,
      orientation: 'portrait',
      scaleFactor: 1.5,
      rotation: 90,
    });
  });

  it('rejects a missing display size instead of substituting one', () => {
    const broken = payload([laptop, { ...tv, width: 1111 }]);
    delete (broken.monitors[1] as { width?: number }).width;
    const parsed = parseElectronDisplayPayload(broken);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('Display width');
  });

  it('rejects a non-positive display size', () => {
    const parsed = parseElectronDisplayPayload(payload([laptop, { ...tv, height: 0 }]));
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('Display height');
  });

  it('rejects an unreadable runtime response', () => {
    const parsed = parseElectronDisplayPayload({ runtimeAvailable: false, topology: 'unknown', monitors: [] });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain('could not read');
  });
});
