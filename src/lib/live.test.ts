import {
  liveUrl,
  mergeLiveChannels,
  parseLiveM3u,
  readLivePreferences,
  seededLiveChannels,
} from './live';

it('groups quality variants into one channel, deduplicates URLs, and excludes insecure or malformed streams', () => {
  const channels = parseLiveM3u(
    `#EXTM3U
#EXTINF:-1 tvg-id="CCTV1.cn@HD",CCTV-1 (1080p)
https://example.com/one.m3u8
#EXTINF:-1 tvg-id="CCTV1.cn@SD",CCTV-1
https://example.com/two.m3u8
#EXTINF:-1 tvg-id="CCTV1.cn@SD",CCTV-1
https://example.com/two.m3u8
#EXTINF:-1 tvg-id="Bad",Bad
http://example.com/live.m3u8
#EXTINF:-1,Unsafe
javascript:alert(1)
`,
    'cn'
  );
  expect(channels).toEqual([
    {
      id: 'cn:CCTV1.cn',
      name: 'CCTV-1',
      category: '央视',
      urls: ['https://example.com/one.m3u8', 'https://example.com/two.m3u8'],
    },
  ]);
  expect(liveUrl('https://user:password@example.com/live')).toBeNull();
});
it('retains commas inside quoted attributes and keeps same-named regional channels separate', () => {
  const text =
    '#EXTM3U\n#EXTINF:-1 tvg-id="" group-title="News, TV",同名频道\nhttps://example.com/live';
  expect(
    mergeLiveChannels([
      ...parseLiveM3u(text, 'cn'),
      ...parseLiveM3u(text, 'hk'),
    ])
  ).toHaveLength(2);
  expect(parseLiveM3u(text)[0].name).toBe('同名频道');
});
it('ships real HTTPS channel lists with alternate lines', () => {
  const channels = seededLiveChannels();
  expect(channels.length).toBeGreaterThan(50);
  expect(channels.some((c) => c.urls.length > 1)).toBe(true);
  expect(
    channels.every((c) => c.urls.every((u) => u.startsWith('https://')))
  ).toBe(true);
});
it('handles corrupt or unexpected local preferences without changing film history', () => {
  localStorage.setItem('moontv_play_records', '{"keep":true}');
  localStorage.setItem('moontv_live_preferences_v1', 'broken');
  expect(readLivePreferences()).toEqual({
    favorites: [],
    recent: [],
    customM3u: '',
  });
  localStorage.setItem(
    'moontv_live_preferences_v1',
    JSON.stringify({
      favorites: ['cn:one', null, 3],
      recent: 'bad',
      customM3u: 5,
    })
  );
  expect(readLivePreferences()).toEqual({
    favorites: ['cn:one'],
    recent: [],
    customM3u: '',
  });
  expect(localStorage.getItem('moontv_play_records')).toBe('{"keep":true}');
});
