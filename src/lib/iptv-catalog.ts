import type { LiveChannel } from './live';
import { isShoppingChannel } from './live';
import { validateLiveRelayUrl } from './live-relay';

export const IPTV_SUBSCRIPTION_URL =
  'https://iptv-org.github.io/iptv/index.m3u';
export const IPTV_SNAPSHOT_URL = '/live/iptv.m3u';
export const IPTV_CACHE_TTL = 6 * 60 * 60 * 1000;
const MAX_BYTES = 12 * 1024 * 1024;
const CACHE_VERSION = 1;

export interface IptvRequestHeaders {
  referer?: string;
  userAgent?: string;
}
export interface IptvChannel extends LiveChannel {
  tvgId: string;
  country: string;
  countryName: string;
  categories: string[];
  languages: string[];
  logo: string;
  requestHeaders?: Record<string, IptvRequestHeaders>;
}
export interface IptvCatalog {
  channels: IptvChannel[];
  updatedAt: number;
  stale: boolean;
  source: 'subscription' | 'snapshot';
  error?: string;
}
interface StoredCatalog extends IptvCatalog {
  version: number;
}
export interface IptvCatalogOptions {
  force?: boolean;
  signal?: AbortSignal;
  onCached?: (catalog: IptvCatalog) => void;
}

function publicUrl(value: string): string {
  try {
    return validateLiveRelayUrl(value).href;
  } catch {
    return '';
  }
}
function stableHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++)
    hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}
function cleanHeader(value: string): string {
  return value.length <= 1024 &&
    !/[\r\n]/.test(value) &&
    !value.includes(String.fromCharCode(0))
    ? value
    : '';
}
const countryNames = new Map<string, string>();
function countryName(code: string): string {
  if (!code) return '未标注地区';
  let name = countryNames.get(code);
  if (!name) {
    try {
      name = new Intl.DisplayNames(['zh-CN'], { type: 'region' }).of(code);
    } catch {
      /* Old browser fallback. */
    }
    name = name || code;
    countryNames.set(code, name);
  }
  return name;
}
function abortIfNeeded(signal?: AbortSignal) {
  if (signal?.aborted)
    throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
}

/** Parse in short batches so a full global directory does not lock the UI thread. */
export async function parseIptvCatalog(
  text: string,
  signal?: AbortSignal
): Promise<IptvChannel[]> {
  if (
    text.length > MAX_BYTES ||
    !text
      .replace(/^\uFEFF/, '')
      .trimStart()
      .startsWith('#EXTM3U')
  )
    throw new Error('直播订阅格式无效');
  const channels = new Map<string, IptvChannel>();
  let attributes: Record<string, string> = {};
  let name = '';
  let headers: IptvRequestHeaders = {};
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    if (i % 500 === 0) {
      abortIfNeeded(signal);
      if (i) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    const line = lines[i].trim();
    if (line.startsWith('#EXTINF:')) {
      attributes = {};
      headers = {};
      const comma = line.match(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)?.index;
      name = comma === undefined ? '' : line.slice(comma + 1).trim();
      const attrText = comma === undefined ? line : line.slice(0, comma);
      const pattern = /([\w-]+)="([^"]*)"/g;
      let match;
      while ((match = pattern.exec(attrText)))
        attributes[match[1].toLowerCase()] = match[2];
      if (attributes['http-referrer'] || attributes['http-referer'])
        headers.referer = publicUrl(
          attributes['http-referrer'] || attributes['http-referer']
        );
      if (attributes['http-user-agent'])
        headers.userAgent = cleanHeader(attributes['http-user-agent']);
      continue;
    }
    if (
      line.startsWith('#EXTVLCOPT:http-referrer=') ||
      line.startsWith('#EXTVLCOPT:http-referer=')
    ) {
      headers.referer = publicUrl(line.slice(line.indexOf('=') + 1));
      continue;
    }
    if (line.startsWith('#EXTVLCOPT:http-user-agent=')) {
      headers.userAgent = cleanHeader(line.slice(line.indexOf('=') + 1));
      continue;
    }
    if (!line || line.startsWith('#')) continue;
    const displayName = name;
    name = '';
    const url = publicUrl(line);
    const category = attributes['group-title'] || '未分类';
    const tvgId = attributes['tvg-id'] || '';
    if (
      !displayName ||
      !url ||
      isShoppingChannel({ name: `${displayName} ${tvgId}`, category })
    )
      continue;
    // Unlike extension-only filtering, this retains HLS endpoints with query/path dispatchers.
    if (/\.(?:mpd|mp3|aac|flv|ts)$/i.test(new URL(url).pathname)) continue;
    const country = (
      attributes['tvg-country']?.split(/[;,]/)[0] ||
      tvgId.match(/\.([a-z]{2})(?:@|$)/i)?.[1] ||
      ''
    ).toUpperCase();
    const normalizedName = displayName
      .replace(/\s*\((?:\d+p|[48]K)\)|\s*\[(?:Geo-blocked|Not 24\/7)\]/gi, '')
      .trim();
    const id = `iptv:${
      tvgId ||
      `unnamed-${stableHash(
        `${country}:${normalizedName}:${new URL(url).hostname}`
      )}`
    }`;
    const previous = channels.get(id);
    if (previous) {
      if (!previous.urls.includes(url)) previous.urls.push(url);
      if (url.startsWith('http:') || headers.referer || headers.userAgent)
        previous.relayRequired?.push(url);
      if (headers.referer || headers.userAgent)
        (previous.requestHeaders ||= {})[url] = { ...headers };
      continue;
    }
    channels.set(id, {
      id,
      tvgId,
      name: normalizedName,
      category,
      categories: category
        .split(';')
        .map((value) => value.trim())
        .filter(Boolean),
      country,
      countryName: countryName(country),
      languages: (attributes['tvg-language'] || '')
        .split(/[;,]/)
        .map((value) => value.trim())
        .filter(Boolean),
      language: attributes['tvg-language'] || '',
      logo: publicUrl(attributes['tvg-logo'] || ''),
      urls: [url],
      region: country === 'CN' ? 'domestic' : 'overseas',
      relayRequired:
        url.startsWith('http:') || headers.referer || headers.userAgent
          ? [url]
          : [],
      ...(headers.referer || headers.userAgent
        ? { requestHeaders: { [url]: { ...headers } } }
        : {}),
      sourceUrl: IPTV_SUBSCRIPTION_URL,
    });
  }
  abortIfNeeded(signal);
  return Array.from(channels.values()).map((channel) => ({
    ...channel,
    urls: channel.urls.sort(
      (a, b) => Number(a.startsWith('http:')) - Number(b.startsWith('http:'))
    ),
    relayRequired: Array.from(new Set(channel.relayRequired)),
  }));
}

let memory: IptvCatalog | null = null;
let pending: Promise<IptvCatalog> | null = null;
let retryAfter = 0;

function database(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => finish(null), 1500);
    try {
      const request = indexedDB.open('moontv-iptv-catalog', CACHE_VERSION);
      request.onupgradeneeded = () =>
        request.result.createObjectStore('catalog');
      request.onsuccess = () => finish(request.result);
      request.onerror = () => finish(null);
      request.onblocked = () => finish(null);
    } catch {
      finish(null);
    }
  });
}
async function readCached(): Promise<IptvCatalog | null> {
  const db = await database();
  if (!db) return null;
  return new Promise((resolve) => {
    const transaction = db.transaction('catalog', 'readonly');
    const request = transaction.objectStore('catalog').get('global');
    request.onsuccess = () => {
      const value = request.result as StoredCatalog | undefined;
      resolve(
        value?.version === CACHE_VERSION &&
          Array.isArray(value.channels) &&
          Number.isFinite(value.updatedAt)
          ? value
          : null
      );
    };
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => {
      db.close();
      resolve(null);
    };
  });
}
async function saveCached(value: IptvCatalog) {
  const db = await database();
  if (!db) return;
  try {
    const transaction = db.transaction('catalog', 'readwrite');
    transaction
      .objectStore('catalog')
      .put({ ...value, version: CACHE_VERSION }, 'global');
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => db.close();
  } catch {
    db.close();
  }
}
async function fetchPlaylist(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'default',
      credentials: url.startsWith('/') ? 'same-origin' : 'omit',
    });
    if (!response.ok) throw new Error(`订阅响应异常（${response.status}）`);
    const reader = response.body?.getReader();
    if (!reader) {
      const text = await response.text();
      if (text.length > MAX_BYTES) throw new Error('订阅过大');
      return text;
    }
    const chunks: Uint8Array[] = [];
    let size = 0;
    let chunk = await reader.read();
    while (!chunk.done) {
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error('订阅过大');
      }
      chunks.push(chunk.value);
      chunk = await reader.read();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return new TextDecoder().decode(bytes);
  } finally {
    clearTimeout(timeout);
  }
}

/** One fetch/parse per browser cache period; selecting a channel never calls this. */
export async function loadIptvCatalog(
  options: IptvCatalogOptions = {}
): Promise<IptvCatalog> {
  abortIfNeeded(options.signal);
  if (!memory) memory = await readCached().catch(() => null);
  abortIfNeeded(options.signal);
  const cached = memory;
  if (cached) {
    const stale =
      cached.stale || Date.now() - cached.updatedAt >= IPTV_CACHE_TTL;
    memory = { ...cached, stale };
    options.onCached?.(memory);
    if (!options.force && (!stale || Date.now() < retryAfter)) return memory;
  }
  if (!pending)
    pending = (async () => {
      // First visit: show the static directory without waiting for a remote timeout.
      // A late snapshot must never overwrite a successfully refreshed subscription.
      const snapshot = !memory
        ? fetchPlaylist(IPTV_SNAPSHOT_URL)
            .then((text) => parseIptvCatalog(text))
            .then((channels) => {
              if (!channels.length || memory) return;
              memory = {
                channels,
                updatedAt: 0,
                stale: true,
                source: 'snapshot',
                error: '正在使用备用频道目录，后台更新订阅中。',
              };
              if (!options.signal?.aborted) options.onCached?.(memory);
              void saveCached(memory);
            })
            .catch(() => undefined)
        : Promise.resolve();
      try {
        const channels = await parseIptvCatalog(
          await fetchPlaylist(IPTV_SUBSCRIPTION_URL)
        );
        if (!channels.length) throw new Error('订阅没有可用频道');
        memory = {
          channels,
          updatedAt: Date.now(),
          stale: false,
          source: 'subscription',
        };
        retryAfter = 0;
        void saveCached(memory);
        return memory;
      } catch {
        retryAfter = Date.now() + 60000;
        await snapshot;
        if (memory)
          return (memory = {
            ...memory,
            stale: true,
            error: '订阅暂时无法更新，正在使用已保存的频道。',
          });
        throw new Error('暂时无法加载直播频道，请稍后重试。');
      }
    })().finally(() => {
      pending = null;
    });
  const result = await pending;
  abortIfNeeded(options.signal);
  return result;
}
