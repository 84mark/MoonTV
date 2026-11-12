/** @jest-environment node */
/* eslint-disable @typescript-eslint/no-var-requires */
import {
  IPTV_CACHE_TTL,
  IPTV_SNAPSHOT_URL,
  IPTV_SUBSCRIPTION_URL,
  parseIptvCatalog,
} from './iptv-catalog';

const playlist = `#EXTM3U
#EXTINF:-1 tvg-id="CCTV1.cn@HD" tvg-logo="https://cdn.testmedia.com/logo.png" group-title="General",CCTV-1 (1080p)
https://cdn.testmedia.com/live?id=1
#EXTINF:-1 tvg-id="CCTV1.cn@HD" group-title="General",CCTV-1 (1080p)
http://cdn.testmedia.com/backup
#EXTINF:-1 tvg-id="CCTV1.cn@SD" group-title="General",CCTV-1
https://cdn.testmedia.com/sd.m3u8
#EXTINF:-1 tvg-id="TV.us@HD" group-title="News" http-referrer="https://news.testmedia.com/" http-user-agent="Browser UA",News TV
#EXTVLCOPT:http-referrer=https://news.testmedia.com/watch
https://news.testmedia.com/live.m3u8
#EXTINF:-1 tvg-id="Shopping.us@HD" group-title="Shop",Shopping TV
https://cdn.testmedia.com/shop.m3u8
#EXTINF:-1 tvg-id="Private.us" group-title="News",Private
http://127.0.0.1/live.m3u8
#EXTINF:-1 tvg-id="Bad.us" group-title="News",Not web
rtsp://cdn.testmedia.com/live
#EXTINF:-1 tvg-id="Dash.us" group-title="News",Dash
https://cdn.testmedia.com/live.mpd
`;

it('retains HTTP and extensionless HLS, combines matching feeds, and keeps HD/SD identities separate', async () => {
  const channels = await parseIptvCatalog(playlist);
  expect(channels).toHaveLength(3);
  expect(channels[0]).toMatchObject({
    id: 'iptv:CCTV1.cn@HD',
    name: 'CCTV-1',
    country: 'CN',
    countryName: '中国',
    categories: ['General'],
    region: 'domestic',
    urls: [
      'https://cdn.testmedia.com/live?id=1',
      'http://cdn.testmedia.com/backup',
    ],
    relayRequired: ['http://cdn.testmedia.com/backup'],
  });
  expect(channels[1].id).toBe('iptv:CCTV1.cn@SD');
  expect(channels[2]).toMatchObject({
    country: 'US',
    region: 'overseas',
    requestHeaders: {
      'https://news.testmedia.com/live.m3u8': {
        referer: 'https://news.testmedia.com/watch',
        userAgent: 'Browser UA',
      },
    },
  });
});

it('has stable identities for id-less entries and rejects HTML or aborted parsing', async () => {
  const first = await parseIptvCatalog(
    '#EXTM3U\n#EXTINF:-1 group-title="News",Unnamed\nhttps://cdn.testmedia.com/a.m3u8'
  );
  const second = await parseIptvCatalog(
    '#EXTM3U\n#EXTINF:-1 group-title="News",Unnamed\nhttps://cdn.testmedia.com/b.m3u8'
  );
  expect(first[0].id).toBe(second[0].id);
  await expect(parseIptvCatalog('<html>failure</html>')).rejects.toThrow();
  const controller = new AbortController();
  controller.abort();
  await expect(
    parseIptvCatalog(playlist, controller.signal)
  ).rejects.toMatchObject({ name: 'AbortError' });
});

it('yields while parsing a large list without dropping the final channel', async () => {
  const text =
    '#EXTM3U\n' +
    Array.from(
      { length: 1200 },
      (_, i) =>
        `#EXTINF:-1 tvg-id="TV${i}.us@HD",Channel ${i}\nhttps://cdn.testmedia.com/${i}.m3u8`
    ).join('\n');
  let browserHadATurn = false;
  setTimeout(() => {
    browserHadATurn = true;
  }, 0);
  const channels = await parseIptvCatalog(text);
  expect(browserHadATurn).toBe(true);
  expect(channels).toHaveLength(1200);
  expect(channels[1199].id).toBe('iptv:TV1199.us@HD');
});

it('does not turn shopping categories into normal channels via a later alias', async () => {
  const channels = await parseIptvCatalog(
    '#EXTM3U\n#EXTINF:-1 tvg-id="QVC.us@HD" group-title="General",Quality TV\nhttps://cdn.testmedia.com/qvc.m3u8'
  );
  expect(channels).toHaveLength(0);
});

it('reuses the browser memory cache for six hours and preserves it on refresh failure', async () => {
  jest.resetModules();
  const { loadIptvCatalog } =
    require('./iptv-catalog') as typeof import('./iptv-catalog');
  const fetchMock = jest
    .fn()
    .mockResolvedValue({ ok: true, text: async () => playlist });
  global.fetch = fetchMock;
  const now = jest.spyOn(Date, 'now').mockReturnValue(1000000);
  const first = await loadIptvCatalog();
  expect(first.stale).toBe(false);
  expect(fetchMock).toHaveBeenCalledWith(
    IPTV_SUBSCRIPTION_URL,
    expect.any(Object)
  );
  expect((await loadIptvCatalog()).channels).toBe(first.channels);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  now.mockReturnValue(1000000 + IPTV_CACHE_TTL + 1);
  fetchMock.mockRejectedValue(new Error('offline'));
  const onCached = jest.fn();
  const stale = await loadIptvCatalog({ onCached });
  expect(stale.stale).toBe(true);
  expect(stale.channels).toBe(first.channels);
  expect(onCached).toHaveBeenCalledWith(
    expect.objectContaining({ stale: true })
  );
  now.mockRestore();
});

it('uses the static fallback on first-load failure without claiming a successful update', async () => {
  jest.resetModules();
  const { loadIptvCatalog } =
    require('./iptv-catalog') as typeof import('./iptv-catalog');
  global.fetch = jest
    .fn()
    .mockImplementation((url: string) =>
      url === IPTV_SNAPSHOT_URL
        ? Promise.resolve({ ok: true, text: async () => playlist })
        : Promise.reject(new Error('offline'))
    );
  const result = await loadIptvCatalog();
  expect(result).toMatchObject({
    source: 'snapshot',
    stale: true,
    updatedAt: 0,
  });
  expect(global.fetch).toHaveBeenCalledWith(
    IPTV_SNAPSHOT_URL,
    expect.objectContaining({ credentials: 'same-origin' })
  );
});

it('shows the first-visit static snapshot while the subscription is still pending', async () => {
  jest.resetModules();
  const { loadIptvCatalog } =
    require('./iptv-catalog') as typeof import('./iptv-catalog');
  let finishRemote: (value: unknown) => void = () => undefined;
  const remote = new Promise((resolve) => {
    finishRemote = resolve;
  });
  global.fetch = jest
    .fn()
    .mockImplementation((url: string) =>
      url === IPTV_SNAPSHOT_URL
        ? Promise.resolve({ ok: true, text: async () => playlist })
        : remote
    );
  let snapshotShown: (value: unknown) => void = () => undefined;
  const shown = new Promise((resolve) => {
    snapshotShown = resolve;
  });
  const result = loadIptvCatalog({ onCached: snapshotShown });
  await expect(shown).resolves.toMatchObject({
    source: 'snapshot',
    stale: true,
  });
  finishRemote({ ok: true, text: async () => playlist });
  await expect(result).resolves.toMatchObject({
    source: 'subscription',
    stale: false,
  });
});
