/** @jest-environment node */

import {
  Blob,
  Request,
  Response,
} from 'next/dist/compiled/@edge-runtime/primitives';

import { GET } from './route';

// Jest 27's Node environment predates Fetch globals. Exercise the same Web
// primitives Next uses in its Edge runtime rather than mocking response bodies.
Object.assign(global, { Blob, Request, Response });

const poster =
  'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg';
const request = (url = poster) =>
  new Request(`https://tv.markoo.cn/api/image?url=${encodeURIComponent(url)}`, {
    headers: { Cookie: 'auth=private', Authorization: 'Bearer private' },
  });
const image = () =>
  new Response(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), {
    headers: { 'Content-Type': 'image/jpeg', 'Set-Cookie': 'upstream=private' },
  });

describe('Edge image proxy', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns image bytes with cache headers and no upstream cookies', async () => {
    fetchMock.mockResolvedValue(image());
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/jpeg');
    expect(response.headers.get('Cache-Control')).toContain('s-maxage=604800');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(Array.from(new Uint8Array(await response.arrayBuffer()))).toEqual([
      0xff, 0xd8, 0xff, 0xd9,
    ]);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(poster);
    expect(options.redirect).toBe('manual');
    expect(options.headers.Referer).toBe('https://movie.douban.com/');
    expect(options.headers.Cookie).toBeUndefined();
    expect(options.headers.Authorization).toBeUndefined();
  });

  it('rejects arbitrary URLs without fetching them', async () => {
    expect((await GET(request('http://127.0.0.1/private'))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('follows a validated relative image redirect', async () => {
    fetchMock
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: './p480747493.jpg' },
        })
      )
      .mockResolvedValueOnce(image());
    expect((await GET(request())).status).toBe(200);
    expect(fetchMock.mock.calls[1][0]).toBe(
      poster.replace('p480747492', 'p480747493')
    );
  });

  it('rejects a redirect outside the poster CDN', async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: 'https://example.com/private' },
      })
    );
    expect((await GET(request())).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('bounds redirect loops', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(null, { status: 302, headers: { Location: poster } })
      )
    );
    expect((await GET(request())).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it.each([
    [403, 'text/html', 'denied'],
    [200, 'text/html', '<html>challenge</html>'],
    [200, 'image/svg+xml', '<svg/>'],
    [200, 'image/jpeg', ''],
  ])(
    'does not cache upstream failure or invalid content (%s, %s)',
    async (status, type, body) => {
      fetchMock.mockResolvedValue(
        new Response(body, { status, headers: { 'Content-Type': type } })
      );
      const response = await GET(request());
      expect(response.status).toBe(502);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  );

  it('rejects oversized content even without Content-Length', async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array(8 * 1024 * 1024 + 1), {
        headers: { 'Content-Type': 'image/jpeg' },
      })
    );
    expect((await GET(request())).status).toBe(502);
  });

  it('handles upstream connection failures without leaking details', async () => {
    fetchMock.mockRejectedValue(new Error('private upstream details'));
    const response = await GET(request());
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('');
  });
});
