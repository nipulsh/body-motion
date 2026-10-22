import http from 'node:http';

/** Localhost-only companion to the desktop:display-snapshot IPC channel. */
export const DISPLAY_SNAPSHOT_HOST = '127.0.0.1';
export const DISPLAY_SNAPSHOT_PORT = 47321;
export const DISPLAY_SNAPSHOT_PATH = '/display-snapshot';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:1420',
  'http://127.0.0.1:1420',
]);

/**
 * GET /display-snapshot returns whatever `getSnapshot` provides.
 * The process must bind this server to 127.0.0.1. Browser callers are limited
 * to the Body Motion dev origin.
 */
export function respondToDisplaySnapshot(request, response, getSnapshot) {
  const originHeader = request.headers?.origin;
  const origin = typeof originHeader === 'string' ? originHeader : null;
  const originAllowed = origin != null && ALLOWED_ORIGINS.has(origin);
  if (originAllowed) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }

  if (request.method === 'OPTIONS') {
    if (!originAllowed) {
      response.writeHead(403);
      response.end();
      return;
    }
    response.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    response.end();
    return;
  }

  let pathname = '';
  try {
    pathname = new URL(request.url ?? '/', `http://${DISPLAY_SNAPSHOT_HOST}`).pathname;
  } catch {
    pathname = '';
  }
  if (request.method !== 'GET' || pathname !== DISPLAY_SNAPSHOT_PATH) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (origin != null && !originAllowed) {
    response.writeHead(403);
    response.end();
    return;
  }

  try {
    const body = JSON.stringify(getSnapshot());
    response.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(500);
    response.end();
  }
}

export function startDisplaySnapshotServer(getSnapshot) {
  const server = http.createServer((request, response) => {
    respondToDisplaySnapshot(request, response, getSnapshot);
  });
  server.on('error', (error) => {
    console.error('Display snapshot endpoint failed:', error instanceof Error ? error.message : error);
  });
  server.listen(DISPLAY_SNAPSHOT_PORT, DISPLAY_SNAPSHOT_HOST);
  return server;
}
