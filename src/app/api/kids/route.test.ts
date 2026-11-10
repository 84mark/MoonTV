/** @jest-environment node */
import { Request, Response } from 'next/dist/compiled/@edge-runtime/primitives';
import type { NextRequest } from 'next/server';

import { KIDS_TITLES } from '@/lib/kids';

const mockGetConfig = jest.fn();
const mockSearchFromApi = jest.fn();
jest.mock('@/lib/config', () => ({ getConfig: mockGetConfig }));
jest.mock('@/lib/downstream', () => ({ searchFromApi: mockSearchFromApi }));
Object.assign(global, { Request, Response });
// eslint-disable-next-line @typescript-eslint/no-var-requires
const loadRoute = (): typeof import('./route') => require('./route');
const item = KIDS_TITLES[0];
const sites = [
  { key: 'one', name: 'One', api: 'https://one.example.com/api' },
  { key: 'two', name: 'Two', api: 'https://two.example.com/api' },
];
const source = (site = sites[0]) => ({
  id: '1',
  title: item.name,
  poster: 'https://example.com/poster.jpg',
  source: site.key,
  source_name: site.name,
  year: '2020',
  language: '国语',
  episodes: ['https://example.com/a.m3u8'],
});
const request = (id = item.id) =>
  ({
    nextUrl: new URL(`https://moontv.example.com/api/kids?id=${id}`),
  } as NextRequest);
beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  mockGetConfig.mockResolvedValue({ SourceConfig: sites });
  mockSearchFromApi.mockImplementation(async (site) => [source(site)]);
});
afterEach(() => jest.restoreAllMocks());
it('rejects arbitrary search queries outside the curated resource pool', async () => {
  const { GET } = loadRoute();
  const response = await GET(request('unapproved'));
  expect(response.status).toBe(400);
  expect(mockGetConfig).not.toHaveBeenCalled();
  expect(mockSearchFromApi).not.toHaveBeenCalled();
});
it('searches enabled sources with two-page limit and returns language variants with real posters', async () => {
  mockGetConfig.mockResolvedValue({
    SourceConfig: [...sites, { ...sites[0], key: 'disabled', disabled: true }],
  });
  mockSearchFromApi.mockImplementation(async (site) => [
    { ...source(site), language: site.key === 'one' ? '英语' : '国语' },
  ]);
  const { GET } = loadRoute();
  const response = await GET(request());
  const data = await response.json();
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(data.variants).toHaveLength(2);
  expect(
    data.variants
      .map((v: { language: { code: string } }) => v.language.code)
      .sort()
  ).toEqual(['en', 'zh-CN']);
  expect(mockSearchFromApi).toHaveBeenCalledTimes(2);
  expect(mockSearchFromApi).toHaveBeenCalledWith(
    sites[0],
    expect.any(String),
    2,
    expect.any(AbortSignal)
  );
  expect(data.variants[0].poster).toBe('https://example.com/poster.jpg');
});
it('deduplicates concurrent requests, caches success and isolates changed source catalogs', async () => {
  let finish!: () => void;
  const wait = new Promise<void>((resolve) => {
    finish = resolve;
  });
  mockSearchFromApi.mockImplementation(async (site) => {
    await wait;
    return [source(site)];
  });
  const { GET } = loadRoute();
  const first = GET(request());
  const second = GET(request());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(mockSearchFromApi).toHaveBeenCalledTimes(2);
  finish();
  await Promise.all([first, second]);
  await GET(request());
  expect(mockSearchFromApi).toHaveBeenCalledTimes(2);
  mockGetConfig.mockResolvedValue({
    SourceConfig: [{ ...sites[0], api: 'https://other.example.com/api' }],
  });
  await GET(request());
  expect(mockSearchFromApi).toHaveBeenCalledTimes(3);
});
it('retains prior resources on an empty update and retries stale results only after 30 seconds', async () => {
  let now = 1000000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const { GET } = loadRoute();
  const first = await (await GET(request())).json();
  expect(first.stale).toBe(false);
  now += 10 * 60 * 1000 + 1;
  mockSearchFromApi.mockResolvedValue([]);
  const stale = await (await GET(request())).json();
  expect(stale.stale).toBe(true);
  expect(stale.variants).toEqual(first.variants);
  expect(stale.updatedAt).toBe(first.updatedAt);
  const calls = mockSearchFromApi.mock.calls.length;
  now += 29000;
  await GET(request());
  expect(mockSearchFromApi).toHaveBeenCalledTimes(calls);
  now += 2000;
  await GET(request());
  expect(mockSearchFromApi).toHaveBeenCalledTimes(calls + 2);
});
it('caps the source fanout at twelve and keeps at most four searches active', async () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    ...sites[0],
    key: String(i),
  }));
  mockGetConfig.mockResolvedValue({ SourceConfig: many });
  let active = 0;
  let peak = 0;
  mockSearchFromApi.mockImplementation(async (site) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return [source(site)];
  });
  const { GET } = loadRoute();
  const data = await (await GET(request())).json();
  expect(mockSearchFromApi).toHaveBeenCalledTimes(12);
  expect(peak).toBeLessThanOrEqual(4);
  expect(data.hasMoreSources).toBe(true);
});

it('rotates discovery across the full catalog and retains sources outside the refreshed window', async () => {
  let now = 1000000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const many = Array.from({ length: 20 }, (_, i) => ({
    ...sites[0],
    key: String(i),
  }));
  mockGetConfig.mockResolvedValue({ SourceConfig: many });
  const { GET } = loadRoute();
  await GET(request());
  expect(
    new Set(mockSearchFromApi.mock.calls.map(([site]) => site.key)).size
  ).toBe(12);
  now += 10 * 60 * 1000 + 1;
  const data = await (await GET(request())).json();
  expect(
    new Set(mockSearchFromApi.mock.calls.map(([site]) => site.key)).size
  ).toBe(20);
  expect(data.variants[0].sources).toHaveLength(20);
});

it('tries aliases only for sources without a matching title and stays within the request budget', async () => {
  jest.doMock('@/lib/kids', () => ({
    KIDS_TITLES: [{ ...item, aliases: ['Peppa Pig', '粉红猪小妹'] }],
  }));
  try {
    const many = Array.from({ length: 20 }, (_, i) => ({
      ...sites[0],
      key: String(i),
    }));
    mockGetConfig.mockResolvedValue({ SourceConfig: many });
    mockSearchFromApi.mockImplementation(async (site, query) =>
      query === 'Peppa Pig' ? [source(site)] : []
    );
    const { GET } = loadRoute();
    const data = await (await GET(request())).json();
    expect(mockSearchFromApi).toHaveBeenCalledTimes(16);
    expect(
      mockSearchFromApi.mock.calls
        .slice(0, 12)
        .every(([, query]) => query !== 'Peppa Pig')
    ).toBe(true);
    expect(
      mockSearchFromApi.mock.calls
        .slice(12)
        .every(([, query, pages]) => query === 'Peppa Pig' && pages === 2)
    ).toBe(true);
    expect(data.variants[0].sources).toHaveLength(4);
  } finally {
    jest.dontMock('@/lib/kids');
  }
});

it('stops starting searches after the overall discovery deadline', async () => {
  let now = 1000000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  const many = Array.from({ length: 20 }, (_, i) => ({
    ...sites[0],
    key: String(i),
  }));
  mockGetConfig.mockResolvedValue({ SourceConfig: many });
  mockSearchFromApi.mockImplementation(async () => {
    now += 20001;
    return [];
  });
  const { GET } = loadRoute();
  const data = await (await GET(request())).json();
  expect(data.sourceCount).toBe(1);
  expect(mockSearchFromApi).toHaveBeenCalledTimes(1);
  expect(mockSearchFromApi.mock.calls[0][3].aborted).toBe(true);
});
