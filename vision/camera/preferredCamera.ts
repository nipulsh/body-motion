import type { CameraDevice } from '../types';

/**
 * Laptop / IR / virtual devices. USB webcams used as the smart-mirror camera
 * typically do not match these labels.
 */
const SKIP_CAMERA_PATTERNS = [
  /\bir\b/i,
  /infrared/i,
  /windows hello/i,
  /virtual/i,
  /\bobs\b/i,
  /manycam/i,
];

const BUILTIN_CAMERA_PATTERNS = [
  /integrated/i,
  /built[- ]?in/i,
  /\binternal\b/i,
  /facetime/i,
  /wide vision/i,
  /laptop/i,
];

export function isSkippedCamera(label: string): boolean {
  return SKIP_CAMERA_PATTERNS.some((pattern) => pattern.test(label));
}

export function isBuiltinCamera(label: string): boolean {
  return BUILTIN_CAMERA_PATTERNS.some((pattern) => pattern.test(label));
}

export interface CameraPreferenceOptions {
  /** Device opened by a user-facing probe. Treated as the laptop camera. */
  builtinDeviceId?: string | null;
}

function preferenceRank(device: CameraDevice, options?: CameraPreferenceOptions): number {
  if (isSkippedCamera(device.label)) return 3;
  if (options?.builtinDeviceId && device.deviceId === options.builtinDeviceId) return 2;
  if (!device.label.trim()) return 1;
  if (isBuiltinCamera(device.label)) return 2;
  return 0;
}

/** External USB cameras first, then unlabeled, then the laptop camera. */
export function camerasInPreferenceOrder<T extends CameraDevice>(
  devices: readonly T[],
  options?: CameraPreferenceOptions,
): T[] {
  return [...devices].sort(
    (a, b) => preferenceRank(a, options) - preferenceRank(b, options),
  );
}

/**
 * Prefer a connected external camera. If none is present, use the laptop camera.
 * IR / virtual devices are only used when nothing else is available.
 */
export function pickPreferredCamera<T extends CameraDevice>(
  devices: readonly T[],
  options?: CameraPreferenceOptions,
): T | undefined {
  if (devices.length === 0) return undefined;
  const ordered = camerasInPreferenceOrder(devices, options);
  return ordered.find((device) => !isSkippedCamera(device.label)) ?? ordered[0];
}
