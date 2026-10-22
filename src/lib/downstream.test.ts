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
