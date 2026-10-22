import { describe, expect, it } from 'vitest';
import {
  camerasInPreferenceOrder,
  isBuiltinCamera,
  pickPreferredCamera,
} from './preferredCamera';

describe('pickPreferredCamera', () => {
  it('prefers a USB camera over the laptop camera', () => {
    const laptop = { deviceId: 'laptop', label: 'HP Wide Vision HD Camera' };
    const usb = { deviceId: 'usb', label: 'Logitech Webcam' };

    expect(pickPreferredCamera([laptop, usb])).toEqual(usb);
    expect(pickPreferredCamera([usb, laptop])).toEqual(usb);
  });

  it('prefers an EMEET webcam over the HP laptop camera', () => {
    const laptop = { deviceId: 'laptop', label: 'HP Wide Vision HD Camera' };
    const external = { deviceId: 'emeet', label: 'EMEET SmartCam C950' };
    expect(pickPreferredCamera([laptop, external])).toEqual(external);
  });

  it('treats the facing-mode camera as the laptop when its label is not recognized', () => {
    const laptop = { deviceId: 'laptop', label: 'USB Video Device' };
    const external = { deviceId: 'usb', label: 'USB Video Device' };
    expect(pickPreferredCamera([laptop, external], { builtinDeviceId: 'laptop' })).toEqual(
      external,
    );
  });

  it('uses the laptop camera when no external camera is connected', () => {
    const laptop = { deviceId: 'laptop', label: 'HP Wide Vision HD Camera' };
    expect(pickPreferredCamera([laptop])).toEqual(laptop);
  });

  it('skips IR and virtual cameras when a real camera is available', () => {
    const ir = { deviceId: 'ir', label: 'IR Camera' };
    const virtual = { deviceId: 'obs', label: 'OBS Virtual Camera' };
    const laptop = { deviceId: 'laptop', label: 'Integrated Camera' };
    expect(pickPreferredCamera([ir, virtual, laptop])).toEqual(laptop);
  });

  it('treats unlabeled extra devices ahead of a known laptop camera', () => {
    const laptop = { deviceId: 'laptop', label: 'FaceTime HD Camera' };
    const unlabeled = { deviceId: 'usb', label: '' };
    expect(pickPreferredCamera([laptop, unlabeled])).toEqual(unlabeled);
  });

  it('returns undefined when there are no cameras', () => {
    expect(pickPreferredCamera([])).toBeUndefined();
  });
});

describe('camerasInPreferenceOrder', () => {
  it('lists the external camera before the laptop camera', () => {
    const laptop = { deviceId: 'laptop', label: 'Built-in Camera' };
    const usb = { deviceId: 'usb', label: 'USB Camera' };
    expect(camerasInPreferenceOrder([laptop, usb]).map((d) => d.deviceId)).toEqual([
      'usb',
      'laptop',
    ]);
  });
});

describe('isBuiltinCamera', () => {
  it('recognizes common laptop webcam labels', () => {
    expect(isBuiltinCamera('HP Wide Vision HD Camera')).toBe(true);
    expect(isBuiltinCamera('Integrated Webcam')).toBe(true);
    expect(isBuiltinCamera('Logitech C920')).toBe(false);
  });
});
