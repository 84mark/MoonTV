/** @jest-environment node */
import { Request, Response } from 'next/dist/compiled/@edge-runtime/primitives';

import { getCacheTime } from '@/lib/config';

Object.assign(globalThis, { Request, Response });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { GET } = require('./route');

jest.mock('@/lib/config', () => ({ getCacheTime: jest.fn() }));

const request = () =>
  new Request(
    'https://example.com/api/douban/categories?kind=movie&category=hot&type=a%26b'
  );

const originalFetch = global.fetch;
const upstream = jest.fn();
beforeEach(() => {
  upstream.mockReset();
  global.fetch = upstream;
  (getCacheTime as jest.Mock).mockResolvedValue(600);
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('recovers a temporary upstream 503 and keeps category parameters intact', async () => {
  upstream
    .mockResolvedValueOnce(new Response('', { status: 503 }))
    .mockResolvedValueOnce(
      Response.json({ items: [{ id: '1', title: 'Movie' }] })
    );
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(upstream).toHaveBeenCalledTimes(2);
  expect(new URL(upstream.mock.calls[1][0]).searchParams.get('type')).toBe(
    'a&b'
  );
  expect((await response.json()).list[0].title).toBe('Movie');
});

it('reports a rate limit without retrying or caching the error', async () => {
  upstream.mockResolvedValueOnce(new Response('', { status: 429 }));
  const response = await GET(request());
  expect(response.status).toBe(429);
  expect(response.headers.get('Retry-After')).toBe('30');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  expect(upstream).toHaveBeenCalledTimes(1);
  expect((await response.json()).details).toContain('429');
});
