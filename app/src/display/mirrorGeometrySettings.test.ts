import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MIRROR_GEOMETRY } from '@vision/pose/mirrorReflection';
import { MIRROR_GEOMETRY_STORAGE_KEY, parseMirrorGeometry, subscribeMirrorGeometry } from './mirrorGeometrySettings';

describe('parseMirrorGeometry', () => {
  it('uses the site defaults: 42" portrait display, bottom at 19", camera at 42"', () => {
    const geometry = parseMirrorGeometry(null);
    expect(geometry).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(Math.hypot(geometry.screenWidthIn, geometry.screenHeightIn)).toBeCloseTo(42);
    expect(geometry.screenHeightIn).toBeGreaterThan(geometry.screenWidthIn);
    expect(geometry.screenBottomIn).toBe(19);
    expect(geometry.cameraHeightIn).toBe(42);
    expect(geometry.wireframeScale).toBe(1);
    expect(geometry.eyeFollowGain).toBe(1.5);
  });

  it('applies numeric overrides and ignores bad input', () => {
    expect(parseMirrorGeometry('{"cameraTiltDownDeg":12,"userDistanceIn":50}')).toMatchObject({
      cameraTiltDownDeg: 12,
      userDistanceIn: 50,
    });
    expect(parseMirrorGeometry('{"cameraTiltDownDeg":"12","unknown":3}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('not json')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"screenHeightIn":0,"cameraDiagonalFovDeg":200}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"wireframeScale":0}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"eyeFollowGain":-1}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"eyeFollowGain":2}').eyeFollowGain).toBe(2);
    expect(parseMirrorGeometry('{"videoFollowGainX":-1}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"videoFollowGainX":0.2,"videoFollowGainY":0}')).toMatchObject({
      videoFollowGainX: 0.2,
      videoFollowGainY: 0,
    });
    expect(parseMirrorGeometry('{"videoZoom":0}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"videoZoom":2}').videoZoom).toBe(2);
    expect(parseMirrorGeometry('{"videoMarginTopPx":"8"}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"videoMarginLeftPx":-40,"videoMarginTopPx":20}')).toMatchObject({
      videoMarginLeftPx: -40,
      videoMarginTopPx: 20,
    });
    expect(parseMirrorGeometry('{"showVideo":"true"}')).toEqual(DEFAULT_MIRROR_GEOMETRY);
    expect(parseMirrorGeometry('{"showVideo":true}').showVideo).toBe(true);
    expect(parseMirrorGeometry('{"wireframeScale":1}').wireframeScale).toBe(1);
  });
});

describe('subscribeMirrorGeometry', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reloads the geometry when another window changes the override', () => {
    const listeners: Array<(event: { key: string | null }) => void> = [];
    let stored: string | null = null;
    vi.stubGlobal('window', {
      addEventListener: (_: string, listener: (event: { key: string | null }) => void) => listeners.push(listener),
      removeEventListener: (_: string, listener: (event: { key: string | null }) => void) =>
        listeners.splice(listeners.indexOf(listener), 1),
      localStorage: { getItem: () => stored },
    });
    const seen: number[] = [];
    const unsubscribe = subscribeMirrorGeometry((geometry) => seen.push(geometry.cameraTiltDownDeg));

    stored = JSON.stringify({ cameraTiltDownDeg: 14 });
    listeners.forEach((listener) => listener({ key: MIRROR_GEOMETRY_STORAGE_KEY }));
    listeners.forEach((listener) => listener({ key: 'something-else' }));
    expect(seen).toEqual([14]);

    unsubscribe();
    expect(listeners).toHaveLength(0);
  });
});
