import { describe, expect, it } from 'vitest';
import { respondToDisplaySnapshot } from '../../electron/displaySnapshotHttp.mjs';

function mockResponse() {
  return {
    statusCode: 0,
    headers: {} as Record<string, string | number>,
    body: '',
    setHeader(name: string, value: string | number) {
      this.headers[name] = value;
    },
    writeHead(status: number, headers?: Record<string, string>) {
      this.statusCode = status;
      if (headers) Object.assign(this.headers, headers);
    },
    end(body?: string) {
      this.body = body ?? '';
    },
  };
}

const reported = {
  runtimeAvailable: true,
  topology: 'extend',
  monitors: [
    { name: 'TV', x: 0, y: 0, width: 1111, height: 2222, scaleFactor: 1.25, rotation: 90 },
  ],
  primary: null,
};

describe('display snapshot HTTP endpoint', () => {
  it('returns the snapshot from the desktop enumerator', () => {
    const response = mockResponse();
    respondToDisplaySnapshot(
      { method: 'GET', url: '/display-snapshot', headers: { origin: 'http://localhost:1420' } },
      response,
      () => reported,
    );
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(reported);
    expect(response.headers['Access-Control-Allow-Origin']).toBe('http://localhost:1420');
  });

  it('does not answer other paths or foreign origins', () => {
    const missing = mockResponse();
    respondToDisplaySnapshot(
      { method: 'POST', url: '/display-snapshot', headers: {} },
      missing,
      () => reported,
    );
    expect(missing.statusCode).toBe(404);
    expect(missing.body).toBe('');

    const foreign = mockResponse();
    respondToDisplaySnapshot(
      { method: 'GET', url: '/display-snapshot', headers: { origin: 'https://example.com' } },
      foreign,
      () => reported,
    );
    expect(foreign.statusCode).toBe(403);
    expect(foreign.body).toBe('');
  });
});
