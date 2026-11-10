/** @jest-environment node */
import { Response } from 'next/dist/compiled/@edge-runtime/primitives';

import { getDetailFromApi, searchFromApi } from './downstream';

jest.mock('@/lib/config', () => ({
  API_CONFIG: { search: { headers: {} }, detail: { headers: {} } },
  getConfig: async () => ({ SiteConfig: { SearchDownstreamMaxPage: 1 } }),
}));
Object.assign(global, { Response });
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const site = {
  key: 'sample',
  name: '示例',
  api: 'https://example.com/api?token=api-key',
};
const first = 'https://media.example.com/first.m3u8?token=first&expires=123';
const second = 'https://media.example.com/second.m3u8?token=second';
const item = {
  vod_id: 7,
  vod_name: '测试',
  vod_pic: '',
  vod_content: '',
  vod_play_url: `第1集$${first}#第2集$${second}`,
};
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('preserves signed playlist query strings when parsing search results', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ list: [item], pagecount: 1 }))
  );
  const [result] = await searchFromApi(site, '测试');
  expect(result.episodes).toEqual([first, second]);
  const target = new URL(fetchMock.mock.calls[0][0]);
  expect(target.searchParams.get('token')).toBe('api-key');
  expect(target.searchParams.get('wd')).toBe('测试');
});

it('uses the configured source for details and retains API authentication parameters', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ list: [item] })));
  const result = await getDetailFromApi(site, '7');
  expect(result.episodes).toEqual([first, second]);
  const target = new URL(fetchMock.mock.calls[0][0]);
  expect(target.searchParams.get('ids')).toBe('7');
  expect(target.searchParams.get('token')).toBe('api-key');
});

it('keeps alternate movie playlists as one episode on later search pages', async () => {
  const movie = { ...item, vod_play_url: `正片$${first}$$$正片$${second}` };
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ list: [movie], pagecount: 2 }))
    )
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ list: [movie], pagecount: 2 }))
    );
  const results = await searchFromApi(site, '测试', 2);
  expect(results).toHaveLength(2);
  expect(results.map((result) => result.episodes)).toEqual([[first], [first]]);
  expect(new URL(fetchMock.mock.calls[1][0]).searchParams.get('pg')).toBe('2');
});

it('does not fetch any page after discovery was cancelled', async () => {
  const controller = new AbortController();
  controller.abort();
  expect(await searchFromApi(site, '测试', 2, controller.signal)).toEqual([]);
  expect(fetchMock).not.toHaveBeenCalled();
});

it('forwards discovery cancellation to an in-flight later page', async () => {
  const controller = new AbortController();
  let pageSignal: AbortSignal | undefined;
  fetchMock
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ list: [item], pagecount: 2 }))
    )
    .mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          pageSignal = init.signal;
          pageSignal?.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
          controller.abort();
        })
    );
  const results = await searchFromApi(site, '测试', 2, controller.signal);
  expect(pageSignal?.aborted).toBe(true);
  expect(results).toHaveLength(1);
});
