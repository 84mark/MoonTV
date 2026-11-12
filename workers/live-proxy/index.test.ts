/** @jest-environment node */
import { webcrypto } from 'crypto';
import {
  Headers,
  Request,
  Response,
} from 'next/dist/compiled/@edge-runtime/primitives';
import { ReadableStream } from 'stream/web';

import { handleProxyRequest, rewriteProxyPlaylist } from './index';
import { ProxyResource, signProxyToken, verifyProxyToken } from './token';
Object.assign(global, { Headers, Request, Response, ReadableStream });
Object.defineProperty(global, 'crypto', {
  value: webcrypto,
  configurable: true,
});
const env = {
  LIVE_PROXY_SECRET: 'test-only-proxy-secret-at-least-32-characters',
  ALLOWED_ORIGINS: 'https://tv.markoo.cn',
};
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const resource = (overrides: Partial<ProxyResource> = {}): ProxyResource => ({
  url: 'https://media.example.com/live.m3u8',
  playlist: true,
  expires: Date.now() + 3600000,
  ...overrides,
});
async function request(res = resource(), headers: Record<string, string> = {}) {
  const token = await signProxyToken(res, env.LIVE_PROXY_SECRET);
  return new Request(`https://live.example.com/stream?token=${token}`, {
    headers: { Origin: 'https://tv.markoo.cn', ...headers },
  });
}
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  global.fetch = originalFetch;
});

it('rewrites variants, audio, encryption keys, maps, and segments while retaining signed referer and expiry', async () => {
  const res = resource({
    referer: 'https://station.example.com/watch',
    userAgent: 'StationPlayer/1.0',
  });
  const output = await rewriteProxyPlaylist(
    `#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,URI="audio/index.m3u8"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-MAP:URI="init.mp4"
#EXT-X-STREAM-INF:BANDWIDTH=100
video/index.php
#EXTINF:6,
http://cdn.example.com/a.ts
`,
    res.url,
    'https://live.example.com',
    res,
    env.LIVE_PROXY_SECRET
  );
  const tokens = Array.from(
    output.matchAll(/token=([\w.-]+)/g),
    (match) => match[1]
  );
  const children = await Promise.all(
    tokens.map((token) => verifyProxyToken(token, env.LIVE_PROXY_SECRET))
  );
  expect(children.map((child) => child.playlist)).toEqual([
    true,
    false,
    false,
    true,
    false,
  ]);
  expect(
    children.every(
      (child) =>
        child.referer === res.referer &&
        child.userAgent === res.userAgent &&
        child.expires <= res.expires
    )
  ).toBe(true);
  expect(children[1].expires).toBeLessThanOrEqual(Date.now() + 600000);
  expect(output).not.toContain('http://');
});
it('rejects unsigned, altered, expired, and foreign-origin tickets without an upstream request', async () => {
  const valid = await signProxyToken(resource(), env.LIVE_PROXY_SECRET);
  for (const token of ['', valid + 'x']) {
    const response = await handleProxyRequest(
      new Request(`https://live.example.com/stream?token=${token}`),
      env
    );
    expect(response.status).toBe(403);
  }
  const expires = Date.now() + 1000;
  const expired = await signProxyToken(
    resource({ expires }),
    env.LIVE_PROXY_SECRET
  );
  jest.spyOn(Date, 'now').mockReturnValue(expires + 1);
  expect(
    (
      await handleProxyRequest(
        new Request(`https://live.example.com/stream?token=${expired}`),
        env
      )
    ).status
  ).toBe(403);
  jest.restoreAllMocks();
  expect(
    (
      await handleProxyRequest(
        await request(resource(), { Origin: 'https://evil.example.com' }),
        env
      )
    ).status
  ).toBe(403);
  expect(fetchMock).not.toHaveBeenCalled();
});
it('blocks private addresses at signing, in playlist children, and after redirects', async () => {
  await expect(
    signProxyToken(
      resource({ url: 'http://127.0.0.1/live.m3u8' }),
      env.LIVE_PROXY_SECRET
    )
  ).rejects.toThrow();
  await expect(
    rewriteProxyPlaylist(
      '#EXTM3U\nhttp://169.254.169.254/a.ts',
      resource().url,
      'https://live.example.com',
      resource(),
      env.LIVE_PROXY_SECRET
    )
  ).rejects.toThrow();
  fetchMock.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: 'http://10.0.0.1/live.m3u8' },
    })
  );
  expect((await handleProxyRequest(await request(), env)).status).toBe(502);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('streams binary Range responses unchanged and forwards only signed source headers', async () => {
  fetchMock.mockResolvedValue(
    new Response(new Uint8Array([0, 1, 255]), {
      status: 206,
      headers: {
        'Content-Type': 'video/mp2t',
        'Content-Length': '3',
        'Content-Range': 'bytes 0-2/100',
        'Set-Cookie': 'private=true',
      },
    })
  );
  const response = await handleProxyRequest(
    await request(
      resource({
        url: 'https://media.example.com/a.ts',
        playlist: false,
        referer: 'https://station.example.com/watch',
        userAgent: 'StationPlayer/1.0',
      }),
      {
        Range: 'bytes=0-2',
        Cookie: 'session=secret',
        Authorization: 'Bearer secret',
        Referer: 'https://evil.example.com',
        'User-Agent': 'UntrustedBrowser/1.0',
      }
    ),
    env
  );
  expect(response.status).toBe(206);
  expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
    0, 1, 255,
  ]);
  expect(response.headers.get('Set-Cookie')).toBeNull();
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
    'https://tv.markoo.cn'
  );
  const upstream = fetchMock.mock.calls[0][1].headers as Headers;
  expect(upstream.get('Range')).toBe('bytes=0-2');
  expect(upstream.get('Referer')).toBe('https://station.example.com/watch');
  expect(upstream.get('Origin')).toBe('https://station.example.com');
  expect(upstream.get('User-Agent')).toBe('StationPlayer/1.0');
  expect(upstream.get('Cookie')).toBeNull();
  expect(upstream.get('Authorization')).toBeNull();
});
it('uses the final redirected playlist base and rejects oversized/non-HLS responses', async () => {
  fetchMock
    .mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: '/new/live.m3u8' },
      })
    )
    .mockResolvedValueOnce(new Response('#EXTM3U\na.ts'));
  const response = await handleProxyRequest(await request(), env);
  const token = (await response.text()).match(/token=([\w.-]+)/)?.[1] || '';
  expect(token).not.toBe('');
  expect((await verifyProxyToken(token, env.LIVE_PROXY_SECRET)).url).toBe(
    'https://media.example.com/new/a.ts'
  );
  fetchMock.mockResolvedValue(new Response('<html>blocked</html>'));
  expect((await handleProxyRequest(await request(), env)).status).toBe(502);
  fetchMock.mockResolvedValue(
    new Response('#EXTM3U\n' + 'x'.repeat(1024 * 1024))
  );
  expect((await handleProxyRequest(await request(), env)).status).toBe(502);
});
it('answers preflight without proxying and rejects malformed Range', async () => {
  const response = await handleProxyRequest(
    new Request('https://live.example.com/stream', {
      method: 'OPTIONS',
      headers: { Origin: 'https://tv.markoo.cn' },
    }),
    env
  );
  expect(response.status).toBe(204);
  expect(response.headers.get('Access-Control-Allow-Headers')).toBe('Range');
  expect(
    (
      await handleProxyRequest(
        await request(resource(), { Range: 'bytes=0-1,5-6' }),
        env
      )
    ).status
  ).toBe(400);
  expect(fetchMock).not.toHaveBeenCalled();
});

it.each([
  'x'.repeat(513),
  'bad\r\nHeader: value',
  'bad\u0000agent',
  'bad\u007fagent',
  '',
])('rejects an invalid signed source User-Agent', async (userAgent) => {
  await expect(
    signProxyToken(resource({ userAgent }), env.LIVE_PROXY_SECRET)
  ).rejects.toThrow('Invalid source User-Agent');
});
