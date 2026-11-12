import { ProxyResource, signProxyToken, verifyProxyToken } from './token';
import { validateLiveRelayUrl } from '../../src/lib/live-relay';

export interface ProxyEnvironment {
  LIVE_PROXY_SECRET: string;
  ALLOWED_ORIGINS: string;
}
const MAX_PLAYLIST_BYTES = 1024 * 1024;
const SEGMENT_LIFETIME = 10 * 60 * 1000;

export async function rewriteProxyPlaylist(
  text: string,
  baseUrl: string,
  workerOrigin: string,
  resource: ProxyResource,
  secret: string
): Promise<string> {
  if (
    text.length > MAX_PLAYLIST_BYTES ||
    !text.trimStart().startsWith('#EXTM3U')
  )
    throw new Error('Invalid HLS playlist');
  const links = new Map<string, Promise<string>>();
  function relay(value: string, playlist: boolean): Promise<string> {
    const url = validateLiveRelayUrl(new URL(value, baseUrl).href).href;
    const isPlaylist = playlist || /\.m3u8(?:$|\?)/i.test(url);
    const id = `${isPlaylist}:${url}`;
    if (!links.has(id))
      links.set(
        id,
        signProxyToken(
          {
            url,
            playlist: isPlaylist,
            expires: isPlaylist
              ? resource.expires
              : Math.min(resource.expires, Date.now() + SEGMENT_LIFETIME),
            ...(resource.referer ? { referer: resource.referer } : {}),
            ...(resource.userAgent ? { userAgent: resource.userAgent } : {}),
          },
          secret
        ).then(
          (token) => `${workerOrigin}/stream?token=${encodeURIComponent(token)}`
        )
      );
    const pending = links.get(id);
    if (!pending) throw new Error('Missing resource ticket');
    return pending;
  }
  let nextIsPlaylist = false;
  const output: Promise<string>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('#')) {
      const playlist =
        /^#EXT-X-(MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/.test(line);
      output.push(
        (async () => {
          let result = raw;
          for (const match of Array.from(raw.matchAll(/\bURI="([^"]+)"/g)))
            result = result.replace(
              match[0],
              `URI="${await relay(match[1], playlist)}"`
            );
          return result;
        })()
      );
      if (line.startsWith('#EXT-X-STREAM-INF:')) nextIsPlaylist = true;
    } else if (line) {
      output.push(relay(line, nextIsPlaylist));
      nextIsPlaylist = false;
    } else output.push(Promise.resolve(raw));
  }
  return (await Promise.all(output)).join('\n');
}

function corsHeaders(origin: string | null, allowed: string[]): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    Vary: 'Origin',
    'X-Content-Type-Options': 'nosniff',
    'Access-Control-Expose-Headers':
      'Content-Length, Content-Range, Accept-Ranges',
  });
  if (origin && allowed.includes(origin))
    headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

export async function handleProxyRequest(
  request: Request,
  env: ProxyEnvironment
): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const headers = corsHeaders(origin, allowed);
  const json = (value: unknown, status = 200) => {
    const resultHeaders = new Headers(headers);
    resultHeaders.set('Content-Type', 'application/json');
    return new Response(JSON.stringify(value), {
      status,
      headers: resultHeaders,
    });
  };
  const fail = (message: string, status: number) =>
    json({ error: message }, status);
  if (origin && !allowed.includes(origin))
    return fail('Origin is not allowed', 403);
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Range');
    headers.set('Access-Control-Max-Age', '86400');
    return new Response(null, { status: 204, headers });
  }
  if (request.method !== 'GET') return fail('Method not allowed', 405);
  if (url.pathname === '/health')
    return json({
      ok: true,
      configured: !!env.LIVE_PROXY_SECRET && env.LIVE_PROXY_SECRET.length >= 32,
    });
  if (url.pathname !== '/stream') return fail('Not found', 404);
  if (!env.LIVE_PROXY_SECRET || env.LIVE_PROXY_SECRET.length < 32)
    return fail('Proxy is not configured', 503);
  let resource: ProxyResource;
  try {
    resource = await verifyProxyToken(
      url.searchParams.get('token') || '',
      env.LIVE_PROXY_SECRET
    );
  } catch {
    return fail('Invalid or expired playback ticket', 403);
  }
  const upstreamHeaders = new Headers();
  const range = request.headers.get('Range');
  if (range) {
    if (!/^bytes=\d*-\d*$/.test(range) || range === 'bytes=-')
      return fail('Invalid range', 400);
    upstreamHeaders.set('Range', range);
  }
  if (resource.referer) {
    upstreamHeaders.set('Referer', resource.referer);
    upstreamHeaders.set('Origin', new URL(resource.referer).origin);
  }
  if (resource.userAgent) upstreamHeaders.set('User-Agent', resource.userAgent);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let streaming = false;
  try {
    let target = validateLiveRelayUrl(resource.url);
    let response: Response | undefined;
    for (let hop = 0; hop <= 4; hop++) {
      response = await fetch(target.href, {
        headers: upstreamHeaders,
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('Location');
      await response.body?.cancel();
      if (!location || hop === 4) throw new Error('Invalid upstream redirect');
      target = validateLiveRelayUrl(new URL(location, target).href);
    }
    if (!response?.ok) {
      await response?.body?.cancel();
      return fail(
        `Upstream HTTP ${response?.status || 502}`,
        response?.status === 416 ? 416 : 502
      );
    }
    const type = response.headers.get('Content-Type') || '';
    if (
      resource.playlist ||
      /mpegurl/i.test(type) ||
      /\.m3u8$/i.test(target.pathname)
    ) {
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Empty upstream playlist');
      const chunks: Uint8Array[] = [];
      let size = 0;
      let chunk = await reader.read();
      while (!chunk.done) {
        size += chunk.value.byteLength;
        if (size > MAX_PLAYLIST_BYTES) {
          await reader.cancel();
          throw new Error('Playlist is too large');
        }
        chunks.push(chunk.value);
        chunk = await reader.read();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const text = await rewriteProxyPlaylist(
        new TextDecoder().decode(bytes),
        target.href,
        url.origin,
        resource,
        env.LIVE_PROXY_SECRET
      );
      headers.set(
        'Content-Type',
        'application/vnd.apple.mpegurl; charset=utf-8'
      );
      return new Response(text, { headers });
    }
    for (const name of [
      'Content-Type',
      'Content-Length',
      'Content-Range',
      'Accept-Ranges',
    ]) {
      const value = response.headers.get(name);
      if (value) headers.set(name, value);
    }
    const reader = response.body?.getReader();
    if (!reader)
      return new Response(null, { status: response.status, headers });
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const chunk = await reader.read();
          if (chunk.done) {
            clearTimeout(timeout);
            stream.close();
          } else stream.enqueue(chunk.value);
        } catch (error) {
          clearTimeout(timeout);
          controller.abort();
          stream.error(error);
        }
      },
      async cancel(reason) {
        clearTimeout(timeout);
        controller.abort();
        await reader.cancel(reason);
      },
    });
    streaming = true;
    return new Response(body, { status: response.status, headers });
  } catch {
    return fail(
      controller.signal.aborted
        ? 'Upstream timed out'
        : 'Upstream stream could not be loaded',
      502
    );
  } finally {
    if (!streaming) clearTimeout(timeout);
  }
}

const worker = { fetch: handleProxyRequest };
export default worker;
