export interface LiveRelayResource {
  url: string;
  playlist: boolean;
  expires: number;
}
const LIFETIME = 10 * 60 * 1000;
// HLS clients keep polling the same child-playlist URL for long sessions.
const PLAYLIST_LIFETIME = 24 * 60 * 60 * 1000;
const encoder = new TextEncoder();

/** Reject local/reserved literal addresses before every outbound fetch. */
export function validateLiveRelayUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('直播资源地址不合法');
  if (
    !host ||
    host.includes(':') ||
    host.startsWith('[') ||
    !host.includes('.') ||
    /(^|\.)(localhost|local|internal|lan|home|test|invalid|example)$/.test(
      host
    ) ||
    host === 'metadata.google.internal' ||
    host === 'metadata.goog'
  )
    throw new Error('不允许访问本地或保留地址');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b, c] = host.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    )
      throw new Error('不允许访问私网或保留地址');
  }
  url.hash = '';
  return url;
}
function encode(value: Uint8Array): string {
  return btoa(
    Array.from(value)
      .map((v) => String.fromCharCode(v))
      .join('')
  )
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
function decode(value: string): Uint8Array {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error('直播资源签名无效');
  const str = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(str, (c) => c.charCodeAt(0));
}
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;
async function signingKey(secret: string) {
  if (!secret) throw new Error('直播转发缺少站点密钥');
  if (cachedKey?.secret === secret) return cachedKey.key;
  const key = crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
  cachedKey = { secret, key };
  return key;
}
export async function signLiveRelayToken(
  url: string,
  secret: string,
  playlist = false
): Promise<string> {
  const payload = encode(
    encoder.encode(
      JSON.stringify({
        url: validateLiveRelayUrl(url).href,
        playlist,
        expires: Date.now() + (playlist ? PLAYLIST_LIFETIME : LIFETIME),
      })
    )
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(secret),
    encoder.encode(payload)
  );
  return `${payload}.${encode(new Uint8Array(signature))}`;
}
export async function verifyLiveRelayToken(
  token: string,
  secret: string
): Promise<LiveRelayResource> {
  if (token.length > 16000) throw new Error('直播资源签名无效');
  const parts = token.split('.');
  if (
    parts.length !== 2 ||
    !(await crypto.subtle.verify(
      'HMAC',
      await signingKey(secret),
      decode(parts[1]),
      encoder.encode(parts[0])
    ))
  )
    throw new Error('直播资源签名无效');
  const data = JSON.parse(
    new TextDecoder().decode(decode(parts[0]))
  ) as LiveRelayResource;
  if (
    !Number.isFinite(data.expires) ||
    data.expires < Date.now() ||
    data.expires >
      Date.now() + (data.playlist ? PLAYLIST_LIFETIME : LIFETIME) + 1000 ||
    typeof data.playlist !== 'boolean'
  )
    throw new Error('直播资源签名已过期，请重新连接');
  validateLiveRelayUrl(data.url);
  return data;
}
export async function rewriteLivePlaylist(
  text: string,
  baseUrl: string,
  secret: string
): Promise<string> {
  if (text.length > 1024 * 1024 || !text.trimStart().startsWith('#EXTM3U'))
    throw new Error('源站未返回有效的 HLS 播放列表');
  let variant = false;
  const output: string[] = [];
  const relay = async (value: string, playlist: boolean) => {
    const url = new URL(value, baseUrl).href;
    return `/api/live/stream?token=${encodeURIComponent(
      await signLiveRelayToken(
        url,
        secret,
        playlist || /\.m3u8(?:$|\?)/i.test(url)
      )
    )}`;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const isPlaylist =
        /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line);
      let rewritten = raw;
      const matches = Array.from(raw.matchAll(/\bURI="([^"]+)"/g));
      for (const match of matches)
        rewritten = rewritten.replace(
          match[0],
          `URI="${await relay(match[1], isPlaylist)}"`
        );
      output.push(rewritten);
      if (line.startsWith('#EXT-X-STREAM-INF:')) variant = true;
    } else if (line) {
      output.push(await relay(line, variant));
      variant = false;
    } else output.push(raw);
  }
  return output.join('\n');
}
