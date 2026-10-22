import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';

async function meshyRequest<T>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  if (!env.meshyEnabled || !env.MESHY_API_KEY) {
    throw new AppError(
      'MESHY_ERROR',
      '3D model generation is disabled. Set MESHY_ENABLED=true and MESHY_API_KEY to use Meshy.',
      503,
    );
  }

  const url = `${env.MESHY_API_BASE_URL}${path}`;
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env.MESHY_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await response.text();
  let payload: unknown = null;
  if (text.length > 0) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      'message' in payload &&
      typeof (payload as { message: unknown }).message === 'string'
        ? (payload as { message: string }).message
        : `Meshy API error (${response.status})`;

    throw new AppError('MESHY_ERROR', message, response.status >= 500 ? 502 : response.status);
  }

  return payload as T;
}

export const meshyClient = {
  post: <T>(path: string, body: unknown) => meshyRequest<T>('POST', path, body),
  get: <T>(path: string) => meshyRequest<T>('GET', path),
};
