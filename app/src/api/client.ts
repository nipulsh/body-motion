import { getIsOnline } from '../connectivity/connectivity';
import type { ApiErrorBody } from './types';

export function getApiBaseUrl(): string {
  const base = import.meta.env.VITE_API_URL?.replace(/\/$/, '');
  if (!base) {
    throw new Error('VITE_API_URL is not configured.');
  }
  return base;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  readonly bodyText?: string;

  constructor(status: number, body: ApiErrorBody['error'], bodyText?: string) {
    super(body.message);
    this.name = 'ApiError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.bodyText = bodyText;
  }
}

export class NetworkError extends Error {
  constructor(message = 'Network error — backend could not be reached.') {
    super(message);
    this.name = 'NetworkError';
  }
}

export class OfflineError extends NetworkError {
  readonly code = 'NETWORK_OFFLINE';

  constructor(message = 'Network unavailable.') {
    super(message);
    this.name = 'OfflineError';
  }
}

export function isOfflineError(err: unknown): err is OfflineError {
  return err instanceof OfflineError;
}

export function isAuthenticationError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

async function parseErrorResponse(res: Response): Promise<ApiError> {
  const text = await res.text();
  try {
    const body = JSON.parse(text) as ApiErrorBody;
    if (body?.error?.message) {
      return new ApiError(res.status, body.error, text);
    }
  } catch {
    // ignore
  }
  return new ApiError(
    res.status,
    {
      code: 'UNKNOWN',
      message: res.statusText || `Request failed (${res.status})`,
    },
    text,
  );
}

export function describeUploadFailure(err: unknown): { message: string; technical: string } {
  if (err instanceof OfflineError) {
    return {
      message: 'Upload failed.\n\nReason:\nThis action requires an internet connection.',
      technical: err.code,
    };
  }

  if (err instanceof NetworkError) {
    return {
      message: 'Upload failed.\n\nReason:\nNetwork error — backend could not be reached.',
      technical: err.message,
    };
  }

  if (err instanceof ApiError) {
    const reason = reasonForApiError(err);
    const technicalParts = [
      `HTTP ${err.status}`,
      err.code,
      err.message,
    ];
    if (import.meta.env.DEV && err.bodyText) {
      technicalParts.push(err.bodyText.slice(0, 1000));
    }
    return {
      message: `Upload failed.\n\nReason:\n${reason}`,
      technical: technicalParts.filter(Boolean).join(' — '),
    };
  }

  const raw = err instanceof Error ? err.message : String(err);
  return {
    message: 'Upload failed.\n\nReason:\nImages could not be sent to the analysis server.',
    technical: raw,
  };
}

function reasonForApiError(err: ApiError): string {
  switch (err.status) {
    case 400:
      return `HTTP 400 — ${err.message || 'Bad request'}`;
    case 401:
      return 'HTTP 401 — Authentication token expired or missing';
    case 403:
      return 'HTTP 403 — Not allowed to upload for this patient';
    case 404:
      return 'HTTP 404 — Patient or API route not found';
    case 413:
      return 'HTTP 413 — Payload too large';
    case 415:
      return `HTTP 415 — ${err.message || 'Unsupported media type'}`;
    case 422:
      return `HTTP 422 — ${err.message || 'Validation failed'}`;
    case 429:
      return 'HTTP 429 — Too many upload requests';
    case 502:
    case 503:
    case 504:
      if (err.code === 'DATABASE_UNAVAILABLE') {
        return `HTTP ${err.status} — ${err.message || 'Database unavailable'}`;
      }
      return `HTTP ${err.status} — Analysis server or database unavailable`;
    default:
      return `HTTP ${err.status} — ${err.message || err.code || 'Request failed'}`;
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!getIsOnline()) {
    throw new OfflineError();
  }

  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  const method = (init.method ?? 'GET').toUpperCase();
  if (import.meta.env.DEV) {
    console.log('[API] method:', method);
    console.log('[API] url:', url);
  }
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (error) {
    console.error('[API] status:', 'NETWORK');
    console.error('[API] endpoint:', url);
    console.error('[API] backend message:', error instanceof Error ? error.message : String(error));
    throw new NetworkError(error instanceof Error ? error.message : 'Failed to fetch');
  }
  if (!res.ok) {
    const apiError = await parseErrorResponse(res);
    console.error('[API] status:', apiError.status);
    console.error('[API] endpoint:', url);
    console.error('[API] backend message:', apiError.message);
    if (apiError.code) {
      console.error('[API] error code:', apiError.code);
    }
    if (import.meta.env.DEV && apiError.details !== undefined) {
      console.error('[API] details:', apiError.details);
    }
    throw apiError;
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

export async function apiUploadWithProgress(
  path: string,
  formData: FormData,
  onProgress?: (loaded: number, total: number) => void,
): Promise<string> {
  if (!getIsOnline()) {
    return Promise.reject(new OfflineError());
  }

  const url = `${getApiBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`;
  console.log('[UPLOAD] Final URL:', url);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = 'text';

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded, event.total);
      }
    };

    xhr.onload = () => {
      console.log('[UPLOAD] status:', xhr.status);
      console.log('[UPLOAD] response:', xhr.responseText.slice(0, 2000));
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.responseText);
        return;
      }
      try {
        const body = JSON.parse(xhr.responseText) as ApiErrorBody;
        console.error('[API] status:', xhr.status);
        console.error('[API] endpoint:', url);
        console.error('[API] backend message:', body.error?.message);
        console.error('[API] error code:', body.error?.code);
        reject(new ApiError(xhr.status, body.error, xhr.responseText));
      } catch {
        console.error('[API] status:', xhr.status);
        console.error('[API] endpoint:', url);
        console.error('[API] backend message:', xhr.statusText || `Upload failed (${xhr.status})`);
        reject(
          new ApiError(
            xhr.status,
            {
              code: 'UNKNOWN',
              message: xhr.statusText || `Upload failed (${xhr.status})`,
            },
            xhr.responseText,
          ),
        );
      }
    };

    xhr.onerror = () => {
      console.error('[UPLOAD] NETWORK ERROR: Failed to reach', url);
      reject(new NetworkError());
    };

    xhr.send(formData);
  });
}
