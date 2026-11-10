import seed from './live-seed.json';

export interface LiveChannel {
  id: string;
  name: string;
  category: string;
  urls: string[];
}
export const LIVE_REGIONS = ['cn', 'hk', 'mo', 'tw'] as const;
const names: Record<string, string> = {
  AnhuiTV: '安徽卫视',
  BeijingSatelliteTV: '北京卫视',
  DragonTV: '东方卫视',
  GuangdongSatelliteTV: '广东卫视',
  HunanTV: '湖南卫视',
  JiangsuTV: '江苏卫视',
  ZhejiangTV: '浙江卫视',
  ShenzhenTV: '深圳卫视',
  PhoenixChineseChannel: '凤凰中文',
};
export function liveUrl(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}
export function mergeLiveChannels(channels: LiveChannel[]): LiveChannel[] {
  const merged = new Map<string, LiveChannel>();
  for (const channel of channels) {
    const previous = merged.get(channel.id);
    merged.set(channel.id, {
      ...channel,
      urls: Array.from(new Set([...(previous?.urls || []), ...channel.urls])),
    });
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
  );
}
export function parseLiveM3u(text: string, region = 'custom'): LiveChannel[] {
  const channels: LiveChannel[] = [];
  let metadata = '';
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const value = line.trim();
    if (value.startsWith('#EXTINF:')) {
      metadata = value;
      continue;
    }
    if (!value || value.startsWith('#')) continue;
    const info = metadata;
    metadata = '';
    const url = liveUrl(value);
    if (!url || !info) continue;
    const attribute = (name: string) =>
      info.match(new RegExp(`${name}="([^"]*)"`, 'i'))?.[1] || '';
    const comma = info.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)?.index;
    const rawName = (comma === undefined ? '' : info.slice(comma + 1)).trim();
    if (!rawName) continue;
    const tvgId = attribute('tvg-id').split('@')[0];
    const name =
      names[tvgId.split('.')[0]] ||
      rawName.replace(/\s*(?:\([^)]*\)|\[[^\]]*\])/g, '').trim();
    const national = /^CCTV|^CGTN/i.test(tvgId || name);
    const category =
      region === 'custom'
        ? '自定义'
        : national
        ? '央视'
        : region !== 'cn'
        ? '港澳台'
        : /卫视|satellite/i.test(name + tvgId) || names[tvgId.split('.')[0]]
        ? '卫视'
        : '地方频道';
    const identity = tvgId || name.replace(/\s/g, '').toLowerCase();
    channels.push({ id: `${region}:${identity}`, name, category, urls: [url] });
  }
  return mergeLiveChannels(channels);
}
export function seededLiveChannels(): LiveChannel[] {
  return mergeLiveChannels(
    seed.playlists.flatMap((p) => parseLiveM3u(p.text, p.region))
  );
}
export const LIVE_STORAGE_KEY = 'moontv_live_preferences_v1';
export interface LivePreferences {
  favorites: string[];
  recent: string[];
  customM3u: string;
}
export function readLivePreferences(): LivePreferences {
  try {
    const data = JSON.parse(localStorage.getItem(LIVE_STORAGE_KEY) || '{}');
    const ids = (value: unknown) =>
      Array.isArray(value)
        ? value.filter((v): v is string => typeof v === 'string').slice(0, 500)
        : [];
    return {
      favorites: ids(data.favorites),
      recent: ids(data.recent).slice(0, 20),
      customM3u:
        typeof data.customM3u === 'string'
          ? data.customM3u.slice(0, 200000)
          : '',
    };
  } catch {
    return { favorites: [], recent: [], customM3u: '' };
  }
}
