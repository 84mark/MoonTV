export interface DomesticStream {
  name: string;
  url: string;
  verifiedAt: string;
}
export interface DomesticChannel {
  id: string;
  name: string;
  website: string;
  epgId?: string;
  streams: DomesticStream[];
  unavailableReason?: string;
}
export interface DomesticProgramme {
  title: string;
  start: number;
  end: number;
}
const protectedReason =
  '尚无经过验证、可在本站直接播放的官方线路。央视官网当前使用受保护的播放器，该频道暂不提供站内播放。';
const names = [
  ['cctv1', 'CCTV-1 综合'],
  ['cctv2', 'CCTV-2 财经'],
  ['cctv3', 'CCTV-3 综艺'],
  ['cctv4', 'CCTV-4 中文国际（亚）'],
  ['cctv5', 'CCTV-5 体育'],
  ['cctv5plus', 'CCTV-5+ 体育赛事'],
  ['cctv6', 'CCTV-6 电影'],
  ['cctv7', 'CCTV-7 国防军事'],
  ['cctv8', 'CCTV-8 电视剧'],
  ['cctvjilu', 'CCTV-9 纪录'],
  ['cctv10', 'CCTV-10 科教'],
  ['cctv11', 'CCTV-11 戏曲'],
  ['cctv12', 'CCTV-12 社会与法'],
  ['cctv13', 'CCTV-13 新闻'],
  ['cctvchild', 'CCTV-14 少儿'],
  ['cctv15', 'CCTV-15 音乐'],
  ['cctv16', 'CCTV-16 奥林匹克'],
  ['cctv17', 'CCTV-17 农业农村'],
  ['cctveurope', 'CCTV-4 中文国际（欧）'],
  ['cctvamerica', 'CCTV-4 中文国际（美）'],
];
// Only unmodified official HTTPS resources decoded from a MoonTV-origin browser are enabled.
// Protected CCTV streams are intentionally not resolved, decrypted, embedded, or proxied.
export const DOMESTIC_CHANNELS: DomesticChannel[] = [
  ...names.map(([id, name]) => ({
    id,
    name,
    website: `https://tv.cctv.com/live/${id}/`,
    epgId: id,
    streams: [],
    unavailableReason: protectedReason,
  })),
  {
    id: 'cgtn',
    name: 'CGTN 英语',
    website: 'https://www.cgtn.com/',
    streams: [
      {
        name: '官方线路',
        url: 'https://english-livebkali.cgtn.com/live/encgtn.m3u8',
        verifiedAt: '2026-11-12T09:53:10.700Z',
      },
    ],
  },
  {
    id: 'cctvplus1',
    name: 'CCTV+ 直播一',
    website: 'https://www.cctvplus.com/',
    streams: [
      {
        name: '官方线路',
        url: 'https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL1.smil/playlist.m3u8',
        verifiedAt: '2026-11-12T09:53:10.700Z',
      },
    ],
  },
  {
    id: 'cctvplus2',
    name: 'CCTV+ 直播二',
    website: 'https://www.cctvplus.com/',
    streams: [
      {
        name: '官方线路',
        url: 'https://cd-live-stream.news.cctvplus.com/live/smil:CHANNEL2.smil/playlist.m3u8',
        verifiedAt: '2026-11-12T09:53:10.700Z',
      },
    ],
  },
  {
    id: 'globalbiz',
    name: 'CGTN Global Biz',
    website: 'https://www.cctvplus.com/',
    streams: [
      {
        name: '官方线路',
        url: 'https://fastlive.cctvplus.com/out/v1/2b3d8a0c805d437f9dc85b764c2ac599/index.m3u8',
        verifiedAt: '2026-11-12T09:53:10.700Z',
      },
    ],
  },
  {
    id: 'china-travel',
    name: 'China Travel',
    website: 'https://www.cctvplus.com/',
    streams: [
      {
        name: '官方线路',
        url: 'https://fastlive.cctvplus.com/out/v1/ca6f9297b7314a63959435028af287fc/index.m3u8',
        verifiedAt: '2026-11-12T09:53:10.700Z',
      },
    ],
  },
];
export function isOfficialDirectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      !url.username &&
      !url.password &&
      (!url.port || url.port === '443') &&
      ['cgtn.com', 'cctvplus.com'].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`)
      )
    );
  } catch {
    return false;
  }
}
export function chinaDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
export function programmeTime(unix: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(unix * 1000);
}
export function parseDomesticEpg(
  value: unknown,
  channel: string
): DomesticProgramme[] {
  const body = value as { data?: Record<string, { list?: unknown[] }> };
  const list = body?.data?.[channel]?.list;
  if (!Array.isArray(list)) throw new Error('官方节目单格式暂不可用');
  return list
    .flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const row = item as Record<string, unknown>;
      if (
        typeof row.title !== 'string' ||
        typeof row.startTime !== 'number' ||
        typeof row.endTime !== 'number' ||
        row.endTime <= row.startTime
      )
        return [];
      return [{ title: row.title, start: row.startTime, end: row.endTime }];
    })
    .sort((a, b) => a.start - b.start);
}
export function canReplay(
  programme: DomesticProgramme,
  window: { start: number; end: number } | null
): boolean {
  return (
    !!window && programme.start >= window.start && programme.start < window.end
  );
}
