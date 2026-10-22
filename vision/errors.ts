import type { VisionErrorCode } from './types';

export class VisionError extends Error {
  readonly code: VisionErrorCode;
  override readonly cause?: unknown;

  constructor(code: VisionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'VisionError';
    this.code = code;
    this.cause = cause;
  }
}

export function wrapCameraError(err: unknown): VisionError {
  if (err instanceof VisionError) return err;

  const name = err instanceof DOMException ? err.name : '';
  const detail = err instanceof Error ? err.message : 'Camera access failed.';

  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return new VisionError(
        'CAMERA_PERMISSION_DENIED',
        'Camera permission was denied.',
        err,
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new VisionError('CAMERA_NOT_FOUND', 'No matching camera was found.', err);
    case 'NotReadableError':
    case 'TrackStartError':
      return new VisionError(
        'CAMERA_NOT_READABLE',
        'The camera is already in use or could not be started.',
        err,
      );
    case 'NotSupportedError':
    case 'TypeError':
      return new VisionError('UNSUPPORTED', 'Camera capture is not supported.', err);
    default:
      return new VisionError('CAMERA_UNKNOWN', detail, err);
  }
}

export function userMessageForVisionError(code: VisionErrorCode): string {
  switch (code) {
    case 'CAMERA_PERMISSION_DENIED':
      return 'Camera access is required. Check permissions and try again.';
    case 'CAMERA_NOT_FOUND':
      return 'No camera was found. Connect a camera and try again.';
    case 'CAMERA_NOT_READABLE':
      return 'The camera is busy or could not be started. Close other apps using it and try again.';
    case 'CAMERA_UNKNOWN':
      return 'Unable to access the camera. Check permissions and try again.';
    case 'POSE_INIT_FAILED':
      return 'Pose tracking could not start. Check your connection and try again.';
    case 'POSE_NOT_READY':
      return 'Pose tracking is not ready yet. Wait a moment and try again.';
    case 'SCAN_NOT_READY':
      return 'The scan is not ready. Return to camera setup and try again.';
    case 'SCAN_FAILED':
      return 'The scan was interrupted. Return to camera setup and try again.';
    case 'VIDEO_NOT_ATTACHED':
      return 'Camera preview is not attached. Return to camera setup and try again.';
    case 'UNSUPPORTED':
      return 'This device does not support camera capture.';
    default: {
      const _never: never = code;
      return _never;
    }
  }
}
