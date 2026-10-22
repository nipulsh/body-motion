import { describe, expect, it } from 'vitest';
import {
  buildDisplaySnapshot,
  selectSmartMirrorDisplay,
  type MonitorReading,
} from './smartMirrorDisplay';

const laptop: MonitorReading = {
  name: 'Laptop',
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1.25,
};

function snapshot(
  monitors: MonitorReading[],
  primary: MonitorReading | null = monitors[0] ?? null,
  topology: 'extend' | 'clone' | 'single' | 'unknown' = monitors.length > 1 ? 'extend' : 'single',
) {
  return buildDisplaySnapshot({
    runtimeAvailable: true,
    topology,
    monitors,
    primary,
  });
}

describe('selectSmartMirrorDisplay', () => {
  it('reports no external display when only the primary laptop is connected', () => {
    const selection = selectSmartMirrorDisplay(snapshot([laptop], laptop, 'single'));
    expect(selection.status).toBe('none');
    expect(selection.candidate).toBeNull();
    expect(selection.candidates).toEqual([]);
  });

  it('selects the only landscape external display', () => {
    const external: MonitorReading = {
      name: 'DELL',
      x: 1920,
      y: 0,
      width: 2560,
      height: 1440,
      scaleFactor: 1,
    };
    const selection = selectSmartMirrorDisplay(snapshot([laptop, external]));
    expect(selection.status).toBe('selected');
    expect(selection.candidate).toMatchObject({
      name: 'DELL',
      x: 1920,
      y: 0,
      width: 2560,
      height: 1440,
      scaleFactor: 1,
      primary: false,
      orientation: 'landscape',
    });
    expect(selection.candidates).toHaveLength(1);
  });

  it('selects the only portrait external display and ignores a portrait laptop', () => {
    const portraitLaptop: MonitorReading = { ...laptop, width: 1080, height: 1920 };
    const tv: MonitorReading = {
      name: 'TV',
      x: 1080,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1,
    };
    const selection = selectSmartMirrorDisplay(snapshot([portraitLaptop, tv], portraitLaptop));
    expect(selection.status).toBe('selected');
    expect(selection.candidate?.name).toBe('TV');
    expect(selection.candidate?.orientation).toBe('portrait');
    expect(selection.candidate?.primary).toBe(false);
  });

  it('prefers the portrait external display when another external display is landscape', () => {
    const landscape: MonitorReading = {
      name: 'Office',
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1,
    };
    const portrait: MonitorReading = {
      name: 'Mirror',
      x: 3840,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1.5,
    };
    const selection = selectSmartMirrorDisplay(snapshot([laptop, landscape, portrait]));
    expect(selection.status).toBe('selected');
    expect(selection.candidate?.name).toBe('Mirror');
    expect(selection.candidates.map((display) => display.name)).toEqual(['Mirror']);
  });

  it('asks for an explicit choice when several external displays are landscape', () => {
    const left: MonitorReading = {
      name: 'Left',
      x: -1920,
      y: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1,
    };
    const right: MonitorReading = {
      name: 'Right',
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1,
    };
    const selection = selectSmartMirrorDisplay(snapshot([left, laptop, right], laptop));
    expect(selection.status).toBe('choose');
    expect(selection.candidate).toBeNull();
    expect(selection.candidates.map((display) => display.name)).toEqual(['Left', 'Right']);
  });

  it('asks for an explicit choice when several external displays are portrait', () => {
    const first: MonitorReading = {
      name: 'TV A',
      x: 1920,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1,
    };
    const second: MonitorReading = {
      name: 'TV B',
      x: 3000,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1,
    };
    const selection = selectSmartMirrorDisplay(snapshot([laptop, first, second]));
    expect(selection.status).toBe('choose');
    expect(selection.candidate).toBeNull();
    expect(selection.candidates.map((display) => display.name)).toEqual(['TV A', 'TV B']);
  });

  it('explains Duplicate mode when the topology is cloned onto one desktop', () => {
    const selection = selectSmartMirrorDisplay(snapshot([laptop], laptop, 'clone'));
    expect(selection.status).toBe('duplicate');
    expect(selection.candidate).toBeNull();
    expect(selection.message).toContain('Extend');
  });

  it('explains Duplicate mode when reported monitors share one rectangle', () => {
    const mirrored: MonitorReading = { ...laptop, name: 'TV' };
    const selection = selectSmartMirrorDisplay(snapshot([laptop, mirrored], laptop, 'unknown'));
    expect(selection.status).toBe('duplicate');
    expect(selection.candidates).toEqual([]);
  });

  it('follows resolution, orientation, and scale changes', () => {
    const external: MonitorReading = {
      name: 'TV',
      x: 1920,
      y: 0,
      width: 1920,
      height: 1080,
      scaleFactor: 1,
    };
    const before = selectSmartMirrorDisplay(snapshot([laptop, external]));
    const rotated: MonitorReading = { ...external, width: 1080, height: 1920, scaleFactor: 1.5 };
    const after = selectSmartMirrorDisplay(snapshot([laptop, rotated]));

    expect(before.candidate).toMatchObject({ width: 1920, height: 1080, orientation: 'landscape', scaleFactor: 1 });
    expect(after.candidate).toMatchObject({ width: 1080, height: 1920, orientation: 'portrait', scaleFactor: 1.5 });
    expect(after.candidate?.id).toBe(before.candidate?.id);
  });

  it('keeps a reported 0° rotation and drops values Electron does not use', () => {
    const external: MonitorReading = {
      name: 'TV',
      x: 1920,
      y: 0,
      width: 1080,
      height: 1920,
      scaleFactor: 1,
      rotation: 0,
    };
    const selected = selectSmartMirrorDisplay(snapshot([laptop, external]));
    expect(selected.candidate?.rotation).toBe(0);

    const unreported = selectSmartMirrorDisplay(snapshot([laptop, { ...external, rotation: undefined }]));
    expect(unreported.candidate?.rotation).toBeNull();

    const unsupported = selectSmartMirrorDisplay(snapshot([laptop, { ...external, rotation: 45 }]));
    expect(unsupported.candidate?.rotation).toBeNull();
  });

  it('does not invent a candidate when the desktop runtime is unavailable', () => {
    const selection = selectSmartMirrorDisplay(buildDisplaySnapshot({
      runtimeAvailable: false,
      topology: 'unknown',
      monitors: [],
      primary: null,
    }));
    expect(selection.status).toBe('unavailable');
    expect(selection.candidate).toBeNull();
  });
});
