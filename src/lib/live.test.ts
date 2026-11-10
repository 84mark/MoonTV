import {
  isShoppingChannel,
  liveChannelRegion,
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
      region: 'domestic',
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
  expect(channels.length).toBeGreaterThanOrEqual(8);
  expect(channels.some((c) => c.category === '地方频道')).toBe(true);
  expect(
    channels
      .filter((c) => c.id.startsWith('world:'))
      .every((c) => c.relayRequired?.length === c.urls.length)
  ).toBe(true);
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

it('preserves routing metadata and excludes shopping channels from merged/custom lists', () => {
  expect(
    liveChannelRegion({
      id: 'world:one',
      name: 'One',
      category: 'News',
      urls: [],
    })
  ).toBe('overseas');
  const channels = mergeLiveChannels([
    {
      id: 'cn:one',
      name: '新闻',
      category: '地方频道',
      urls: ['http://a.com/a.m3u8'],
      relayRequired: ['http://a.com/a.m3u8'],
    },
    {
      id: 'cn:one',
      name: '新闻',
      category: '地方频道',
      urls: ['https://a.com/a.m3u8'],
    },
    {
      id: 'cn:shop',
      name: '好易购',
      category: '地方频道',
      urls: ['https://a.com/shop.m3u8'],
    },
  ]);
  expect(channels).toHaveLength(1);
  expect(channels[0].relayRequired).toEqual(['http://a.com/a.m3u8']);
  expect(isShoppingChannel({ name: 'QVC UK', category: 'News' })).toBe(true);
  expect(
    parseLiveM3u('#EXTM3U\n#EXTINF:-1,河北三佳购物\nhttps://a.com/shop.m3u8')
  ).toEqual([]);
});

it('filters shopping imports by original group and TV guide identity as well as name', () => {
  expect(
    parseLiveM3u(
      '#EXTM3U\n#EXTINF:-1 group-title="購物",普通名字\nhttps://a.com/a.m3u8\n#EXTINF:-1 tvg-id="QVC.uk",Another\nhttps://a.com/b.m3u8'
    )
  ).toEqual([]);
});
