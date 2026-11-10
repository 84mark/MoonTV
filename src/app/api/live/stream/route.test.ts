/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires */
import { webcrypto } from 'crypto';
import {
  Headers,
  Request,
  Response,
} from 'next/dist/compiled/@edge-runtime/primitives';
import type { NextRequest } from 'next/server';
import { ReadableStream } from 'stream/web';

import { signLiveRelayToken } from '@/lib/live-relay';

Object.assign(global, { Headers, Request, Response, ReadableStream });
const { NextRequest: EdgeRequest } = require('next/server');
const {
  GET,
}: { GET: (request: NextRequest) => Promise<Response> } = require('./route');
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  configurable: true,
});
jest.mock('@/lib/live-catalog', () => ({
  getLiveCatalog: async () => ({
    channels: [
      { id: 'cn:test', urls: ['https://media.example.com/master.m3u8'] },
    ],
    updatedAt: 1,
    fallback: false,
  }),
}));
const originalFetch = global.fetch;
const originalPassword = process.env.PASSWORD;
const mockFetch = jest.fn();
const request = (query: string, headers?: Record<string, string>) =>
  new EdgeRequest(`https://tv.example.com/api/live/stream?${query}`, {
    headers,
  });
beforeEach(() => {
  process.env.PASSWORD = 'test-secret';
  global.fetch = mockFetch;
  mockFetch.mockReset();
});
afterAll(() => {
  global.fetch = originalFetch;
  if (originalPassword === undefined) delete process.env.PASSWORD;
  else process.env.PASSWORD = originalPassword;
});
it('rejects channels outside the catalog and unsigned URL inputs', async () => {
  expect((await GET(request('channel=custom:test&line=0'))).status).toBe(404);
  expect((await GET(request('url=https://evil.example.com/a'))).status).toBe(
    400
  );
  expect(mockFetch).not.toHaveBeenCalled();
});
it('turns a known channel playlist into signed same-origin requests without forwarding browser credentials', async () => {
  mockFetch.mockResolvedValue(
    new Response('#EXTM3U\n#EXTINF:6,\nsegment.ts', {
      headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
    })
  );
  const response = await GET(
    request('channel=cn:test&line=0', {
      Cookie: 'auth=sensitive',
      Authorization: 'secret',
    })
  );
  expect(response.status).toBe(200);
  expect(await response.text()).toContain('/api/live/stream?token=');
  const sent = mockFetch.mock.calls[0][1].headers;
  expect(sent.get('Cookie')).toBeNull();
  expect(sent.get('Authorization')).toBeNull();
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
});
it('validates every redirect before fetching it', async () => {
  mockFetch.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: 'http://169.254.169.254/latest' },
    })
  );
  const response = await GET(request('channel=cn:test&line=0'));
  expect(response.status).toBe(502);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  expect((await response.json()).error).toContain('私网');
});
it('returns readable upstream status and denies bad signatures', async () => {
  mockFetch.mockResolvedValue(new Response('missing', { status: 404 }));
  const response = await GET(request('channel=cn:test&line=0'));
  expect(response.status).toBe(502);
  expect((await response.json()).error).toContain('404');
  expect((await GET(request('token=invalid.signature'))).status).toBe(403);
});
it('streams signed binary resources with range metadata', async () => {
  mockFetch.mockResolvedValue(
    new Response('segment', {
      status: 206,
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Range': 'bytes 0-6/20',
      },
    })
  );
  const token = await signLiveRelayToken(
    'http://media.example.com/segment.ts',
    'test-secret'
  );
  const response = await GET(request(`token=${token}`, { Range: 'bytes=0-6' }));
  expect(response.status).toBe(206);
  expect(response.headers.get('Content-Range')).toBe('bytes 0-6/20');
  expect(await response.text()).toBe('segment');
  expect(mockFetch.mock.calls[0][1].headers.get('Range')).toBe('bytes=0-6');
});
