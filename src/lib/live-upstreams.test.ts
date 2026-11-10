import {
  publicWorldChannel,
  verifiedSatelliteChannels,
  worldChannelCandidates,
  WorldLiveSource,
} from './live-upstreams';
const now = Date.parse('2026-11-10T08:00:00Z');
const checked = '2026-11-10T04:32:44Z';
const status = { state: 'ok', last_success_at: checked };
const hd = {
  name: '湖南卫视高清',
  group: '卫视',
  url: 'https://official.example.com/hunan.m3u8',
  resolution: '1920x1080',
  checked_at: checked,
  ok: true,
  reason: 'passed',
  frames: 500,
  errors: [],
};
const source: WorldLiveSource = {
  id: 'world:dw',
  name: 'DW English',
  category: '国际新闻',
  urls: ['https://official.example.com/seed.m3u8'],
  feed: 'de',
  tvgIds: ['DWEnglish.de'],
  trustedHosts: ['official.example.com'],
  language: '英语',
  website: 'https://dw.com',
};
it('only accepts current decoded HTTPS HLS satellite HD sources, merging duplicate station alternatives', () => {
  const report = {
    checked_at: checked,
    channels: [
      hd,
      { ...hd, url: 'https://official.example.com/backup.m3u8' },
      { ...hd, name: '地方新闻', group: '地方台' },
      { ...hd, name: '人间卫视', group: '港台' },
      { ...hd, name: '标清卫视', resolution: '720x576' },
      { ...hd, url: 'http://official.example.com/a.m3u8' },
      { ...hd, url: 'https://official.example.com/rtp/123' },
      { ...hd, frames: 0 },
      { ...hd, errors: ['decode error'] },
    ],
  };
  expect(verifiedSatelliteChannels(status, report, now)).toEqual([
    expect.objectContaining({
      id: 'cn:湖南卫视',
      quality: '1080p',
      category: '高清卫视',
      urls: [hd.url, 'https://official.example.com/backup.m3u8'],
      verification: {
        checkedAt: '2026-11-10T04:32:44.000Z',
        method: 'upstream-decode',
      },
    }),
  ]);
});
it('rejects stale, failed or mismatched report generations instead of claiming playable', () => {
  expect(
    verifiedSatelliteChannels(
      { ...status, state: 'failed' },
      { checked_at: checked, channels: [hd] },
      now
    )
  ).toEqual([]);
  expect(
    verifiedSatelliteChannels(
      status,
      { checked_at: '2026-11-09T04:32:44Z', channels: [hd] },
      now
    )
  ).toEqual([]);
  expect(
    verifiedSatelliteChannels(
      status,
      { checked_at: checked, channels: [hd] },
      now + 49 * 3600000
    )
  ).toEqual([]);
  expect(
    verifiedSatelliteChannels(
      status,
      { checked_at: checked, channels: [{ ...hd, checked_at: '2020-01-01' }] },
      now
    )
  ).toEqual([]);
});
it('uses country playlists only to locate the intended official station and trusted CDN', () => {
  const playlist =
    '#EXTM3U\n#EXTINF:-1 tvg-id="DWEnglish.de@HD",DW English\nhttps://official.example.com/live.m3u8\n#EXTINF:-1 tvg-id="DWEnglish.de",Anonymous restream\nhttps://anonymous.example.net/live.m3u8\n#EXTINF:-1 tvg-id="Other.de",Other channel\nhttps://official.example.com/other.m3u8';
  expect(worldChannelCandidates(source, playlist)).toEqual([
    'https://official.example.com/live.m3u8',
  ]);
  expect(publicWorldChannel(source)).not.toHaveProperty('trustedHosts');
  expect(publicWorldChannel(source)).toHaveProperty(
    'website',
    'https://dw.com'
  );
});

it('preserves language suffixes and rejects explicitly low-definition variants', () => {
  const configured = { ...source, tvgIds: ['DW.de@English'] };
  const list =
    '#EXTM3U\n#EXTINF:-1 tvg-id="DW.de@French",DW French (1080p)\nhttps://official.example.com/fr.m3u8\n#EXTINF:-1 tvg-id="DW.de@English",DW English (360p)\nhttps://official.example.com/low.m3u8\n#EXTINF:-1 tvg-id="DW.de@English",DW English (1080p)\nhttps://official.example.com/master_500.m3u8\n#EXTINF:-1 tvg-id="DW.de@English",DW English (1080p)\nhttps://official.example.com/english.m3u8';
  expect(worldChannelCandidates(configured, list)).toEqual([
    'https://official.example.com/english.m3u8',
  ]);
});
