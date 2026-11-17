/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_KIOSK_CAMERA_TURN,
  KIOSK_CAMERA_TURN_STORAGE_KEY,
  loadKioskCameraTurn,
  saveKioskCameraTurn,
} from './kioskCameraTurn';

describe('kiosk camera turn memory', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('defaults to the kiosk rig: head toward the raw picture right, a quarter turn left', () => {
    expect(DEFAULT_KIOSK_CAMERA_TURN).toBe(270);
    expect(loadKioskCameraTurn()).toBe(270);
  });

  it('remembers the last turn a body confirmed', () => {
    saveKioskCameraTurn(90);
    expect(localStorage.getItem(KIOSK_CAMERA_TURN_STORAGE_KEY)).toBe('90');
    expect(loadKioskCameraTurn()).toBe(90);
    saveKioskCameraTurn(0);
    expect(loadKioskCameraTurn()).toBe(0);
  });

  it('ignores anything stored that is not a turn', () => {
    for (const junk of ['45', '-90', 'abc', '', '90deg', '360', 'null', '{"turn":90}']) {
      localStorage.setItem(KIOSK_CAMERA_TURN_STORAGE_KEY, junk);
      expect(loadKioskCameraTurn()).toBe(DEFAULT_KIOSK_CAMERA_TURN);
    }
  });

  it('works when storage is blocked', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadKioskCameraTurn()).toBe(DEFAULT_KIOSK_CAMERA_TURN);
    expect(() => saveKioskCameraTurn(90)).not.toThrow();
  });
});
