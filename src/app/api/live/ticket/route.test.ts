/** @jest-environment node */
import { webcrypto } from 'crypto';
import {
  Headers,
  Request,
  Response,
} from 'next/dist/compiled/@edge-runtime/primitives';

import { verifyProxyToken } from '../../../../../workers/live-proxy/token';
Object.assign(globalThis, { Request, Response, Headers });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { NextRequest } = require('next/server');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { POST } = require('./route');

Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
const secret = 'test-proxy-secret-with-more-than-32-characters';
const original = {
  secret: process.env.LIVE_PROXY_SECRET,
  origin: process.env.LIVE_PROXY_ORIGIN,
};
beforeEach(() => {
  process.env.LIVE_PROXY_SECRET = secret;
  process.env.LIVE_PROXY_ORIGIN = 'https://moontv-proxy.workers.dev';
});
afterAll(() => {
  if (original.secret === undefined) delete process.env.LIVE_PROXY_SECRET;
  else process.env.LIVE_PROXY_SECRET = original.secret;
  if (original.origin === undefined) delete process.env.LIVE_PROXY_ORIGIN;
  else process.env.LIVE_PROXY_ORIGIN = original.origin;
});
const request = (body: unknown, origin = 'https://tv.markoo.cn') =>
  new NextRequest('https://tv.markoo.cn/api/live/ticket', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify(body),
  });
it('signs a short-lived Worker capability without sharing site cookies', async () => {
  const response = await POST(
    request({
      url: 'http://media.public.tv/live.m3u8',
      referer: 'https://public.tv/watch',
    })
  );
  expect(response.status).toBe(200);
  const data = await response.json();
  const url = new URL(data.url);
  expect(url.origin).toBe('https://moontv-proxy.workers.dev');
  expect(
    await verifyProxyToken(url.searchParams.get('token') || '', secret)
  ).toMatchObject({
    url: 'http://media.public.tv/live.m3u8',
    referer: 'https://public.tv/watch',
    playlist: true,
  });
  expect(response.headers.get('cache-control')).toContain('no-store');
});
it.each([
  'http://127.0.0.1/live.m3u8',
  'http://169.254.169.254/latest',
  'file:///etc/passwd',
])('rejects unsafe resource %s', async (url) => {
  expect((await POST(request({ url }))).status).toBe(400);
});
it('rejects cross-site requests and oversized payloads', async () => {
  expect(
    (
      await POST(
        request({ url: 'https://public.tv/live.m3u8' }, 'https://untrusted.tv')
      )
    ).status
  ).toBe(403);
  expect((await POST(request({ url: 'x'.repeat(13000) }))).status).toBe(400);
});
it('reports missing proxy configuration without falling back to Pages media relay', async () => {
  delete process.env.LIVE_PROXY_SECRET;
  expect(
    (await POST(request({ url: 'https://public.tv/live.m3u8' }))).status
  ).toBe(503);
});
