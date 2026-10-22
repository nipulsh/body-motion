export type ErrorCode =
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'PAYLOAD_TOO_LARGE'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'TOO_MANY_REQUESTS'
  | 'UPLOAD_ERROR'
  | 'STORAGE_ERROR'
  | 'GEMINI_ERROR'
  | 'IMAGE_GENERATION_ERROR'
  | 'MESHY_ERROR'
  | 'PIPELINE_ERROR'
  | 'CONFIGURATION_ERROR'
  | 'DATABASE_UNAVAILABLE'
  | 'INTERNAL_ERROR';

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;
  readonly details?: unknown;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    statusCode: number,
    options?: { details?: unknown; cause?: unknown; expose?: boolean },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options?.details;
    this.expose = options?.expose ?? statusCode < 500;
    Error.captureStackTrace?.(this, AppError);
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError('BAD_REQUEST', message, 400, { details });
  }

  static validation(message: string, details?: unknown): AppError {
    return new AppError('VALIDATION_ERROR', message, 400, { details });
  }

  static unauthorized(message = 'Authentication is required.'): AppError {
    return new AppError('UNAUTHORIZED', message, 401);
  }

  static forbidden(message = 'You do not have access to this resource.'): AppError {
    return new AppError('FORBIDDEN', message, 403);
  }

  static notFound(message = 'Resource not found.'): AppError {
    return new AppError('NOT_FOUND', message, 404);
  }

  static conflict(message: string): AppError {
    return new AppError('CONFLICT', message, 409);
  }

  static internal(message = 'An unexpected error occurred.', cause?: unknown): AppError {
    return new AppError('INTERNAL_ERROR', message, 500, { cause, expose: false });
  }

  static databaseUnavailable(message: string): AppError {
    return new AppError('DATABASE_UNAVAILABLE', message, 503, { expose: true });
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
