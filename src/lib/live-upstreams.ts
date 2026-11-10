import { isShoppingChannel, LiveChannel } from './live';
import { validateLiveRelayUrl } from './live-relay';

export interface WorldLiveSource extends LiveChannel {
  feed: string;
  tvgIds: string[];
  trustedHosts: string[];
  language?: string;
  website?: string;
  description?: string;
  quality?: string;
}
export type VerifiedLiveChannel = LiveChannel & {
  quality: string;
  language: string;
  verification: { checkedAt: string; method: string };
};
export const DAILY_STATUS_URL =
  'https://raw.githubusercontent.com/gchust/iptv-daily/main/reports/status.json';
export const DAILY_CHANNELS_URL =
  'https://raw.githubusercontent.com/gchust/iptv-daily/main/reports/channels.json';
const MAINLAND_SATELLITES = new Set(
  '北京卫视 东方卫视 湖南卫视 江苏卫视 浙江卫视 广东卫视 深圳卫视 安徽卫视 山东卫视 河南卫视 河北卫视 黑龙江卫视 吉林卫视 辽宁卫视 天津卫视 重庆卫视 四川卫视 湖北卫视 江西卫视 东南卫视 厦门卫视 海峡卫视 云南卫视 贵州卫视 广西卫视 海南卫视 陕西卫视 山西卫视 甘肃卫视 青海卫视 宁夏卫视 内蒙古卫视 新疆卫视 西藏卫视 兵团卫视'.split(
    ' '
  )
);
const MAX_AGE = 48 * 60 * 60 * 1000;

function hlsUrl(value: unknown, allowHttp = false): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = validateLiveRelayUrl(value);
    if (
      (!allowHttp && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      !/\.m3u8$/i.test(url.pathname)
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}
function freshDate(value: unknown, now: number): string | null {
  if (typeof value !== 'string') return null;
  const at = Date.parse(value);
  return Number.isFinite(at) && at <= now + 5 * 60 * 1000 && now - at <= MAX_AGE
    ? new Date(at).toISOString()
    : null;
}
export function satelliteReportCurrent(
  status: unknown,
  report: unknown,
  now = Date.now()
): boolean {
  const state = status as Record<string, unknown> | null;
  const data = report as Record<string, unknown> | null;
  return Boolean(
    state &&
      data &&
      state.state === 'ok' &&
      freshDate(state.last_success_at, now) &&
      Date.parse(String(state.last_success_at)) ===
        Date.parse(String(data.checked_at)) &&
      Array.isArray(data.channels)
  );
}
export function verifiedSatelliteChannels(
  status: unknown,
  report: unknown,
  now = Date.now()
): VerifiedLiveChannel[] {
  if (!satelliteReportCurrent(status, report, now)) return [];
  const data = report as { channels: unknown[] };
  const channels = new Map<string, VerifiedLiveChannel>();
  for (const entry of data.channels) {
    if (!entry || typeof entry !== 'object') continue;
    const item = entry as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const group = typeof item.group === 'string' ? item.group : '';
    const checkedAt = freshDate(item.checked_at, now);
    const resolution =
      typeof item.resolution === 'string'
        ? item.resolution.match(/^(\d+)\s*[x×]\s*(\d+)$/)
        : null;
    const width = Number(resolution?.[1] || 0),
      height = Number(resolution?.[2] || 0);
    const url = hlsUrl(item.url, true);
    const region = typeof item.region === 'string' ? item.region : '';
    const excluded =
      /港澳台|香港|澳门|澳門|台湾|台灣|外语|國際|国际|电影|更新时间|测试|購物/.test(
        name + group + region
      );
    const domestic =
      /^CCTV|^CGTN/i.test(name) ||
      item.kind === '地方台' ||
      MAINLAND_SATELLITES.has(name.replace(/高清|标清|HD|SD|\s/gi, '')) ||
      /地方|省台|市台|县台|新闻|综合|公共|教育|经济|经视|都市|民生|文旅|文艺|影视|体育|交通|农村|农科|生活|少儿|动漫|音乐|财经|科教/.test(
        name + group
      );
    if (
      !name ||
      !domestic ||
      (excluded && !/^CCTV|^CGTN/i.test(name)) ||
      isShoppingChannel({ name, category: group }) ||
      item.ok !== true ||
      item.reason !== 'passed' ||
      !Number.isFinite(Number(item.frames)) ||
      Number(item.frames) <= 0 ||
      !Array.isArray(item.errors) ||
      item.errors.length ||
      !checkedAt ||
      width < 320 ||
      height < 240 ||
      !url
    )
      continue;
    const canonical = name
      .replace(
        /(?:超高清|高清|标清|4K|8K|UHD|FHD|HD|SD|\([^)]*\)|\[[^\]]*\])/gi,
        ''
      )
      .replace(/\s+/g, '')
      .trim();
    if (!canonical) continue;
    const id = `cn:${canonical}`;
    const quality = height >= 2160 ? '4K' : `${height}p`;
    const previous = channels.get(id);
    if (previous) {
      if (!previous.urls.includes(url)) previous.urls.push(url);
      if (url.startsWith('http:') && !previous.relayRequired?.includes(url))
        previous.relayRequired?.push(url);
    } else
      channels.set(id, {
        id,
        name: canonical,
        category: /^CCTV|^CGTN/i.test(canonical)
          ? '央视'
          : MAINLAND_SATELLITES.has(canonical)
          ? '卫视'
          : '地方频道',
        region: 'domestic',
        urls: [url],
        relayRequired: url.startsWith('http:') ? [url] : [],
        quality,
        language:
          typeof item.language === 'string'
            ? item.language
            : /^CGTN/i.test(canonical)
            ? /法语|French/i.test(canonical)
              ? '法语'
              : /西语|Spanish/i.test(canonical)
              ? '西班牙语'
              : /阿语|Arabic/i.test(canonical)
              ? '阿拉伯语'
              : /俄语|Russian/i.test(canonical)
              ? '俄语'
              : '英语'
            : '',
        verification: { checkedAt, method: 'upstream-decode' },
      });
  }
  return Array.from(channels.values());
}

/** A country list is only a locator: both station identity and its trusted CDN must match. */
export function worldChannelCandidates(
  source: WorldLiveSource,
  playlist: string
): string[] {
  let metadata = '';
  const urls: string[] = [];
  for (const raw of playlist.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#EXTINF:')) {
      metadata = line;
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const id = metadata.match(/tvg-id="([^"]*)"/i)?.[1] || '';
    const label = metadata;
    metadata = '';
    const url = hlsUrl(line);
    const withoutQuality = (value: string) =>
      value.replace(/@(HD|SD|FHD|UHD|4K|8K)$/i, '');
    const identityMatches = source.tvgIds.some(
      (allowed) =>
        allowed === id || withoutQuality(allowed) === withoutQuality(id)
    );
    const height = label.match(/\b(\d{3,4})[pi]\b/i)?.[1];
    const lowQuality =
      (height && Number(height) < 720) ||
      /\bSD\b|标清/i.test(label.replace(/tvg-id="[^"]*"/i, '')) ||
      /master_(?:900|500)(?:[_.?]|$)/i.test(line);
    if (!url || !identityMatches || lowQuality) continue;
    const host = new URL(url).hostname.toLowerCase();
    if (!source.trustedHosts.some((allowed) => host === allowed.toLowerCase()))
      continue;
    if (!urls.includes(url)) urls.push(url);
  }
  return urls;
}
export function publicWorldChannel(source: WorldLiveSource): LiveChannel {
  const { feed, tvgIds, trustedHosts, ...channel } = source;
  void feed;
  void tvgIds;
  void trustedHosts;
  return channel;
}
