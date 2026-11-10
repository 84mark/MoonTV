/** @jest-environment node */
import { Request, Response } from 'next/dist/compiled/@edge-runtime/primitives';

import { seededLiveChannels } from '@/lib/live';
import {
  BEST_FAN_SUBSCRIPTION_URL,
  DAILY_CHANNELS_URL,
  DAILY_STATUS_URL,
  WorldLiveSource,
} from '@/lib/live-upstreams';
import world from '@/lib/live-world.json';
Object.assign(global, { Request, Response });
function loadRoute(): { GET: () => Promise<Response> } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./route');
}
const configs = world as WorldLiveSource[];
const feeds = Array.from(
  new Set(configs.map((s) => s.feed).filter((f) => /^[a-z]{2}$/.test(f)))
);
const fetchMock = jest.fn();
const originalFetch = global.fetch;
let now = Date.parse('2026-11-10T08:00:00Z');
const checked = '2026-11-10T04:32:44Z';
const satellite = {
  name: '湖南卫视高清',
  group: '卫视',
  url: 'https://media.example.com/satellite.m3u8',
  resolution: '1920x1080',
  checked_at: checked,
  ok: true,
  reason: 'passed',
  frames: 500,
  errors: [],
};
function responseFor(url: string) {
  if (url === BEST_FAN_SUBSCRIPTION_URL) return new Response('#EXTM3U');
  if (url === DAILY_STATUS_URL)
    return new Response(
      JSON.stringify({ state: 'ok', last_success_at: checked })
    );
  if (url === DAILY_CHANNELS_URL)
    return new Response(
      JSON.stringify({
        checked_at: checked,
        channels: [
          satellite,
          { ...satellite, name: '好易购', group: '地方台' },
          { ...satellite, name: '购物频道', resolution: '720x576' },
          {
            ...satellite,
            name: 'HTTP地方新闻',
            url: 'http://media.example.com/live.m3u8',
          },
        ],
      })
    );
  const feed = url.match(/\/([a-z]+)\.m3u$/)?.[1];
  const parts = ['#EXTM3U'];
  for (const source of configs.filter((s) => s.feed === feed)) {
    if (!source.tvgIds.length || !source.trustedHosts.length) continue;
    parts.push(
      `#EXTINF:-1 tvg-id="${source.tvgIds[0]}",${source.name}`,
      `https://${source.trustedHosts[0]}/fresh.m3u8`
    );
    parts.push(
      `#EXTINF:-1 tvg-id="${source.tvgIds[0]}",Anonymous`,
      'https://untrusted.example.net/live.m3u8'
    );
  }
  parts.push(
    '#EXTINF:-1 tvg-id="UnreviewedChannel",Ads',
    'https://untrusted.example.net/ads.m3u8'
  );
  return new Response(parts.join('\n'));
}
beforeEach(() => {
  jest.resetModules();
  now = Date.parse('2026-11-10T08:00:00Z');
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  global.fetch = originalFetch;
});
it('retains reviewed seeds on outage and does not claim a successful update', async () => {
  fetchMock.mockRejectedValue(new Error('down'));
  const { GET } = loadRoute();
  const response = await GET();
  const body = await response.json();
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  expect(body).toMatchObject({
    channels: expect.arrayContaining(seededLiveChannels()),
    updatedAt: 0,
    fallback: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(feeds.length + 3);
});
it('only refreshes approved stations on trusted CDNs and adds decoded HTTPS HD satellites', async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(responseFor(url))
  );
  const { GET } = loadRoute();
  const body = await (await GET()).json();
  expect(body.fallback).toBe(false);
  expect(body.updatedAt).toBe(now);
  expect(
    body.channels.some((c: { id: string }) => c.id === 'cn:湖南卫视')
  ).toBe(true);
  expect(
    body.channels.some((c: { name: string }) =>
      /好易购|购物频道|Ads/.test(c.name)
    )
  ).toBe(false);
  expect(
    body.channels.every((c: { urls: string[] }) =>
      c.urls.every((u) => !u.includes('untrusted.example.net'))
    )
  ).toBe(true);
  expect(body.channels).toHaveLength(seededLiveChannels().length + 2);
  expect(
    body.channels.find((c: { name: string }) => c.name === 'HTTP地方新闻')
      .relayRequired
  ).toEqual(['http://media.example.com/live.m3u8']);
});
it('treats current reports with no eligible HD HLS as an empty supplement, without inventing channels', async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url === DAILY_CHANNELS_URL
        ? new Response(
            JSON.stringify({
              checked_at: checked,
              channels: [{ ...satellite, resolution: '0x0' }],
            })
          )
        : responseFor(url)
    )
  );
  const body = await (await loadRoute().GET()).json();
  expect(body.fallback).toBe(false);
  expect(body.channels).toHaveLength(seededLiveChannels().length);
});
it('rejects stale or failed verification reports while retaining the reviewed international catalog', async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url === DAILY_STATUS_URL
        ? new Response(
            JSON.stringify({ state: 'failed', last_success_at: checked })
          )
        : responseFor(url)
    )
  );
  const body = await (await loadRoute().GET()).json();
  expect(body.fallback).toBe(true);
  expect(body.channels).toHaveLength(seededLiveChannels().length);
  expect(body.updatedAt).toBe(0);
});
it('deduplicates concurrent updates, caches fresh data for 30 minutes and failed updates for 60 seconds', async () => {
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(responseFor(url))
  );
  const { GET } = loadRoute();
  const bodies = await Promise.all(
    [GET(), GET(), GET()].map(async (p) => (await p).json())
  );
  expect(bodies[0]).toEqual(bodies[1]);
  expect(fetchMock).toHaveBeenCalledTimes(feeds.length + 3);
  now += 29 * 60000;
  await GET();
  expect(fetchMock).toHaveBeenCalledTimes(feeds.length + 3);
  now += 2 * 60000;
  fetchMock.mockRejectedValue(new Error('outage'));
  const fallback = await (await GET()).json();
  expect(fallback.fallback).toBe(true);
  expect(fallback.updatedAt).toBe(bodies[0].updatedAt);
  expect(fetchMock).toHaveBeenCalledTimes((feeds.length + 3) * 2);
  now += 59000;
  await GET();
  expect(fetchMock).toHaveBeenCalledTimes((feeds.length + 3) * 2);
  now += 2000;
  await GET();
  expect(fetchMock).toHaveBeenCalledTimes((feeds.length + 3) * 3);
});

it('prioritizes recent verified HTTPS over old seed and HTTP alternatives for a known domestic channel', async () => {
  const seed = configs.find((channel) => channel.name === '宁夏卫视');
  if (!seed) throw new Error('Missing domestic fixture');
  const verifiedHttps = 'https://media.example.com/verified.m3u8';
  const verifiedHttp = 'http://media.example.com/verified.m3u8';
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url === DAILY_CHANNELS_URL
        ? new Response(
            JSON.stringify({
              checked_at: checked,
              channels: [
                { ...satellite, name: seed.name, url: verifiedHttp },
                { ...satellite, name: seed.name, url: verifiedHttps },
              ],
            })
          )
        : responseFor(url)
    )
  );
  const body = await (await loadRoute().GET()).json();
  const channel = body.channels.find(
    (item: { id: string }) => item.id === seed.id
  );
  expect(channel.urls[0]).toBe(verifiedHttps);
  expect(channel.urls.indexOf(seed.urls[0])).toBeLessThan(
    channel.urls.indexOf(verifiedHttp)
  );
  expect(channel.relayRequired).toContain(verifiedHttp);
});

it('refreshes the requested subscription, merges known stations and retains it on an outage', async () => {
  const subscription =
    '#EXTM3U\n#EXTINF:-1,湖南卫视\nhttp://media.example.com/hunan.m3u8\n#EXTINF:-1,新地方台\nhttps://media.example.com/new.m3u8\n#EXTINF:-1,购物频道\nhttps://media.example.com/shop.m3u8';
  fetchMock.mockImplementation((url: string) =>
    Promise.resolve(
      url === BEST_FAN_SUBSCRIPTION_URL
        ? new Response(subscription)
        : responseFor(url)
    )
  );
  const { GET } = loadRoute();
  const body = await (await GET()).json();
  const hunan = body.channels.filter(
    (c: { name: string }) => c.name === '湖南卫视'
  );
  expect(hunan).toHaveLength(1);
  expect(hunan[0].urls).toContain('http://media.example.com/hunan.m3u8');
  expect(hunan[0].relayRequired).toContain(
    'http://media.example.com/hunan.m3u8'
  );
  expect(hunan[0].verification.method).not.toBe('upstream-decode');
  expect(body.subscription).toMatchObject({
    channelCount: 2,
    updatedAt: now,
    fallback: false,
  });
  now += 31 * 60000;
  fetchMock.mockRejectedValue(new Error('down'));
  const stale = await (await GET()).json();
  expect(
    stale.channels.find((c: { name: string }) => c.name === '新地方台').urls
  ).toContain('https://media.example.com/new.m3u8');
  expect(stale.subscription.fallback).toBe(true);
  expect(stale.subscription.updatedAt).toBe(body.subscription.updatedAt);
});
