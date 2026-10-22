/** @jest-environment node */
import { TextDecoder } from 'util';

import { fetchDoubanRelated, fetchDoubanSubjectData } from './douban-comments';

const original = global.fetch;
const mockFetch = jest.fn();
beforeEach(() => {
  global.fetch = mockFetch;
  mockFetch.mockReset();
  Object.assign(global, { TextDecoder });
});
afterAll(() => {
  global.fetch = original;
});
function json(value: unknown) {
  let read = false;
  return {
    ok: true,
    status: 200,
    headers: { get: () => 'application/json' },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true };
          read = true;
          return {
            done: false,
            value: new Uint8Array(Buffer.from(JSON.stringify(value))),
          };
        },
        cancel: async () => undefined,
      }),
    },
  };
}
it('recovers the actual variety-show 301 by requesting its fixed TV endpoint without following redirects', async () => {
  mockFetch
    .mockResolvedValueOnce({ ok: false, status: 301 })
    .mockResolvedValueOnce(
      json({ id: '37816990', title: '现在就出发 第四季', type: 'tv' })
    );
  await expect(fetchDoubanSubjectData('37816990')).resolves.toMatchObject({
    kind: 'tv',
    data: { id: '37816990' },
  });
  expect(mockFetch.mock.calls.map(([url]) => url)).toEqual([
    'https://m.douban.com/rexxar/api/v2/movie/37816990',
    'https://m.douban.com/rexxar/api/v2/tv/37816990',
  ]);
  expect(mockFetch).toHaveBeenLastCalledWith(
    expect.any(String),
    expect.objectContaining({
      redirect: 'manual',
      headers: expect.objectContaining({
        Referer: 'https://m.douban.com/tv/subject/37816990/',
      }),
    })
  );
});
it('uses a known TV type immediately and preserves the movie endpoint for movies', async () => {
  mockFetch.mockResolvedValueOnce(
    json({ id: '37042229', title: '醉梦', type: 'tv' })
  );
  await expect(fetchDoubanSubjectData('37042229', 'tv')).resolves.toMatchObject(
    { kind: 'tv' }
  );
  expect(mockFetch.mock.calls[0][0]).toContain('/tv/37042229');
  mockFetch.mockResolvedValueOnce(
    json({ id: '1292052', title: '肖申克的救赎', type: 'movie' })
  );
  await expect(
    fetchDoubanSubjectData('1292052', 'movie')
  ).resolves.toMatchObject({ kind: 'movie' });
  expect(mockFetch.mock.calls[1][0]).toContain('/movie/1292052');
});
it('requests comments and photos using the resolved subject type and checks the result shape', async () => {
  mockFetch.mockResolvedValueOnce(json({ interests: [] }));
  await expect(
    fetchDoubanRelated('37816990', 'tv', 'interests', 'count=20')
  ).resolves.toEqual({ interests: [] });
  expect(mockFetch.mock.calls[0][0]).toContain(
    '/tv/37816990/interests?count=20'
  );
  mockFetch
    .mockResolvedValueOnce(json({ error: 'unavailable' }))
    .mockResolvedValueOnce(json({ photos: [] }));
  await expect(
    fetchDoubanRelated('37816990', 'tv', 'photos', 'count=12')
  ).resolves.toEqual({ photos: [] });
  expect(mockFetch.mock.calls[2][0]).toContain('/movie/37816990/photos');
});
it('never follows arbitrary redirect destinations or accepts another subject ID', async () => {
  mockFetch
    .mockResolvedValueOnce({
      ok: false,
      status: 301,
      headers: { get: () => 'https://evil.test/' },
    })
    .mockResolvedValueOnce(json({ id: '1292052', title: 'wrong' }));
  await expect(fetchDoubanSubjectData('37816990')).rejects.toThrow();
  expect(mockFetch).toHaveBeenCalledTimes(2);
  expect(
    mockFetch.mock.calls.every(([url]) =>
      String(url).startsWith('https://m.douban.com/rexxar/api/v2/')
    )
  ).toBe(true);
});
