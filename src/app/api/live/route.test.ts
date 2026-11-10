/** @jest-environment node */

import { Request, Response } from 'next/dist/compiled/@edge-runtime/primitives';

import { LIVE_REGIONS, seededLiveChannels } from '@/lib/live';

// Exercise Next's Edge response primitives in Jest 27's pre-Fetch environment.
Object.assign(global, { Request, Response });
function loadRoute(): { GET: () => Promise<Response> } {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('./route');
}
const originalFetch = global.fetch;
const fetchMock = jest.fn();
let now = 2_000_000_000;
const playlist = (region: string) => `#EXTM3U
#EXTINF:-1 tvg-id="test-${region}@HD",Test ${region}
https://media.example.com/${region}/hd.m3u8
#EXTINF:-1 tvg-id="test-${region}@SD",Test ${region}
https://media.example.com/${region}/sd.m3u8
#EXTINF:-1 tvg-id="insecure",HTTP only
http://media.example.com/insecure.m3u8
`;
const regionOf = (url: string) => url.match(/\/([a-z]+)\.m3u$/)?.[1] || '';
const successfulFetch = (url: string) =>
  Promise.resolve(new Response(playlist(regionOf(url))));

beforeEach(() => {
  jest.resetModules();
  now = 2_000_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  fetchMock.mockReset();
  global.fetch = fetchMock;
});
afterEach(() => {
  jest.restoreAllMocks();
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('returns the bundled channels when every upstream fails, without claiming a fresh update', async () => {
  fetchMock.mockRejectedValue(new Error('upstream unavailable'));
  const { GET } = loadRoute();
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  const body = await response.json();
  expect(body).toMatchObject({
    channels: seededLiveChannels(),
    updatedAt: 0,
    fallback: true,
  });
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('fetches only the four fixed regional playlists, merging alternate HTTPS lines', async () => {
  fetchMock.mockImplementation(successfulFetch);
  const { GET } = loadRoute();
  const body = await (await GET()).json();
  expect(body.updatedAt).toBe(now);
  expect(body.fallback).toBe(false);
  expect(body.channels).toHaveLength(4);
  for (const region of LIVE_REGIONS) {
    expect(fetchMock).toHaveBeenCalledWith(
      `https://raw.githubusercontent.com/iptv-org/iptv/master/streams/${region}.m3u`,
      expect.objectContaining({ cache: 'no-store', signal: expect.anything() })
    );
    expect(body.channels).toContainEqual(
      expect.objectContaining({
        id: `${region}:test-${region}`,
        urls: [
          `https://media.example.com/${region}/hd.m3u8`,
          `https://media.example.com/${region}/sd.m3u8`,
        ],
      })
    );
  }
});

it('uses the affected region snapshot for empty or failed responses while retaining fresh regions', async () => {
  fetchMock.mockImplementation((url: string) => {
    const region = regionOf(url);
    if (region === 'hk') return Promise.resolve(new Response('#EXTM3U'));
    if (region === 'mo')
      return Promise.resolve(new Response('unavailable', { status: 503 }));
    return successfulFetch(url);
  });
  const { GET } = loadRoute();
  const body = await (await GET()).json();
  expect(body.fallback).toBe(true);
  expect(body.updatedAt).toBe(0);
  for (const region of ['cn', 'tw'])
    expect(body.channels).toContainEqual(
      expect.objectContaining({ id: `${region}:test-${region}` })
    );
  const snapshots = seededLiveChannels().filter((channel) =>
    /^(hk|mo):/.test(channel.id)
  );
  for (const snapshot of snapshots)
    expect(body.channels).toContainEqual(snapshot);
  expect(body.channels).not.toContainEqual(
    expect.objectContaining({ id: 'hk:test-hk' })
  );
});

it('reuses a fresh update and refreshes the regional lists after the cache expires', async () => {
  fetchMock.mockImplementation(successfulFetch);
  const { GET } = loadRoute();
  const first = await (await GET()).json();
  now += 29 * 60 * 1000;
  expect(await (await GET()).json()).toEqual(first);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  now += 2 * 60 * 1000;
  const refreshed = await (await GET()).json();
  expect(fetchMock).toHaveBeenCalledTimes(8);
  expect(refreshed.updatedAt).toBe(now);
});

it('shares one upstream update across concurrent requests', async () => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (url: string) => {
    await blocked;
    return new Response(playlist(regionOf(url)));
  });
  const { GET } = loadRoute();
  const pending = [GET(), GET(), GET()];
  expect(fetchMock).toHaveBeenCalledTimes(4);
  release();
  const responses = await Promise.all(pending);
  const bodies = await Promise.all(
    responses.map((response) => response.json())
  );
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toEqual(bodies[2]);
  expect(bodies[0].fallback).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it('briefly caches failed updates and retries after 60 seconds instead of refetching on every page view', async () => {
  fetchMock.mockRejectedValue(new Error('temporary outage'));
  const { GET } = loadRoute();
  const fallback = await (await GET()).json();
  expect(fallback.fallback).toBe(true);
  expect(fallback.updatedAt).toBe(0);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  now += 59_000;
  expect(await (await GET()).json()).toEqual(fallback);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  now += 2_000;
  fetchMock.mockImplementation(successfulFetch);
  const recovered = await (await GET()).json();
  expect(fetchMock).toHaveBeenCalledTimes(8);
  expect(recovered.fallback).toBe(false);
  expect(recovered.updatedAt).toBe(now);
  expect(recovered.channels).toHaveLength(4);
});

it('reports fallback separately from the timestamp of the last completely successful update', async () => {
  fetchMock.mockImplementation(successfulFetch);
  const { GET } = loadRoute();
  const fresh = await (await GET()).json();
  now += 31 * 60 * 1000;
  fetchMock.mockRejectedValue(new Error('temporary outage'));
  const fallback = await (await GET()).json();
  expect(fallback.fallback).toBe(true);
  expect(fallback.updatedAt).toBe(fresh.updatedAt);
  expect(fallback.updatedAt).not.toBe(now);
  expect(fetchMock).toHaveBeenCalledTimes(8);
});
