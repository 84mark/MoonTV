import {
  canReplay,
  chinaDate,
  DOMESTIC_CHANNELS,
  isOfficialDirectUrl,
  parseDomesticEpg,
  programmeTime,
} from './domestic-live';

it('enables only explicitly verified official HTTPS channels and keeps protected CCTV entries unavailable', () => {
  expect(
    DOMESTIC_CHANNELS.filter((channel) => channel.streams.length)
  ).toHaveLength(5);
  for (const channel of DOMESTIC_CHANNELS)
    for (const stream of channel.streams) {
      expect(isOfficialDirectUrl(stream.url)).toBe(true);
      expect(Number.isFinite(Date.parse(stream.verifiedAt))).toBe(true);
    }
  expect(
    DOMESTIC_CHANNELS.find((channel) => channel.id === 'cctv1')?.streams
  ).toEqual([]);
  expect(
    DOMESTIC_CHANNELS.find((channel) => channel.id === 'cctv13')?.epgId
  ).toBe('cctv13');
});
it('rejects HTTP, nonofficial hosts, CF proxies, credentials and misleading domain suffixes', () => {
  for (const url of [
    'http://english-livebkali.cgtn.com/live.m3u8',
    'https://cgtn.com.evil.org/live.m3u8',
    'https://moontv-live-proxy.markoo.workers.dev/stream',
    'https://tv.markoo.cn/api/live/stream',
    'https://user:password@fastlive.cctvplus.com/live.m3u8',
    'https://fastlive.cctvplus.com:8080/live.m3u8',
  ])
    expect(isOfficialDirectUrl(url)).toBe(false);
});
it('parses real EPG fields while rejecting malformed programme times and missing channels', () => {
  expect(
    parseDomesticEpg(
      {
        data: {
          cctv1: {
            list: [
              { title: '新闻联播', startTime: 100, endTime: 200 },
              { title: '坏数据', startTime: 300, endTime: 250 },
            ],
          },
        },
      },
      'cctv1'
    )
  ).toEqual([{ title: '新闻联播', start: 100, end: 200 }]);
  expect(() => parseDomesticEpg({}, 'cctv1')).toThrow('节目单格式');
});
it('only enables replay for a programme inside the actual measured media window', () => {
  const programme = { title: '新闻', start: 100, end: 200 };
  expect(canReplay(programme, null)).toBe(false);
  expect(canReplay(programme, { start: 110, end: 200 })).toBe(false);
  expect(canReplay(programme, { start: 50, end: 100 })).toBe(false);
  expect(canReplay(programme, { start: 90, end: 150 })).toBe(true);
});
it('uses China time for dates and programmes at the UTC day boundary', () => {
  expect(chinaDate(new Date('2026-11-12T17:00:00Z'))).toBe('2026-11-13');
  expect(programmeTime(Date.parse('2026-11-12T11:00:00Z') / 1000)).toBe(
    '19:00'
  );
});
