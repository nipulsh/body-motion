import { AppError } from '../../utils/AppError';
import { toErrorMessage } from '../../utils/AppError';

function parseGeminiApiErrorMessage(message: string): string {
  try {
    const parsed = JSON.parse(message) as {
      error?: { message?: string; status?: string; code?: number };
    };
    if (parsed.error?.message) {
      const status = parsed.error.status ?? parsed.error.code;
      return status ? `${parsed.error.message} (${status})` : parsed.error.message;
    }
  } catch {
    // use raw message
  }
  return message;
}

/** Map @google/genai client errors to AppError without leaking API keys. */
export function mapGeminiClientError(error: unknown, context: string): AppError {
  const name = error instanceof Error ? error.name : undefined;
  if (name === 'ApiError') {
    const message = parseGeminiApiErrorMessage(toErrorMessage(error));
    return new AppError('GEMINI_ERROR', `${context}: ${message}`, 502, { expose: true });
  }

  return new AppError('GEMINI_ERROR', `${context}: ${toErrorMessage(error)}`, 502, {
    expose: true,
    cause: error,
  });
}
