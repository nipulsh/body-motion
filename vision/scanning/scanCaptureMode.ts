export type ScanCaptureMode = 'BODY_360' | 'TIMED_BURST';

export function targetCaptureCount(mode: ScanCaptureMode): number {
  if (mode === 'TIMED_BURST') {
    return 30;
  }
  return 36;
}
