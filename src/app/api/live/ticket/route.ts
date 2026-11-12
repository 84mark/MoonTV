import { NextRequest, NextResponse } from 'next/server';

import { validateLiveRelayUrl } from '@/lib/live-relay';

import { signProxyToken } from '../../../../../workers/live-proxy/token';

export const runtime = 'edge';
const headers = { 'Cache-Control': 'private, no-store' };

// Authentication is enforced by the existing site middleware. Only signed
// capabilities go to the Worker; it never receives the site's login cookie.
export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  if (origin && origin !== request.nextUrl.origin)
    return NextResponse.json(
      { error: '不允许跨站请求播放票据' },
      { status: 403, headers }
    );
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return NextResponse.json(
      { error: '请求格式无效' },
      { status: 415, headers }
    );
  const secret = process.env.LIVE_PROXY_SECRET || '';
  const endpoint = process.env.LIVE_PROXY_ORIGIN || '';
  let worker: URL;
  try {
    worker = validateLiveRelayUrl(endpoint);
    if (
      worker.protocol !== 'https:' ||
      worker.pathname !== '/' ||
      worker.search ||
      secret.length < 32
    )
      throw new Error('Invalid proxy configuration');
  } catch {
    return NextResponse.json(
      {
        error:
          '独立直播代理尚未配置，请配置 LIVE_PROXY_ORIGIN 和 LIVE_PROXY_SECRET；HTTPS 频道仍可尝试直连。',
      },
      { status: 503, headers }
    );
  }
  try {
    // Bound the request before parsing; a ticket is only a URL and Referer.
    const reader = request.body?.getReader();
    if (!reader) throw new Error('Empty body');
    const decoder = new TextDecoder();
    let body = '';
    let bytes = 0;
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 12000) {
        await reader.cancel();
        throw new Error('Body too large');
      }
      body += decoder.decode(part.value, { stream: true });
    }
    body += decoder.decode();
    const data = JSON.parse(body);
    if (
      typeof data.url !== 'string' ||
      data.url.length > 4096 ||
      (data.referer !== undefined &&
        (typeof data.referer !== 'string' || data.referer.length > 4096)) ||
      (data.userAgent !== undefined &&
        (typeof data.userAgent !== 'string' ||
          data.userAgent.length > 512 ||
          Array.from(data.userAgent as string).some(
            (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127
          )))
    )
      throw new Error('Invalid resource');
    const url = validateLiveRelayUrl(data.url).href;
    const referer = data.referer
      ? validateLiveRelayUrl(data.referer).href
      : undefined;
    const expires = Date.now() + 4 * 60 * 60 * 1000;
    const token = await signProxyToken(
      {
        url,
        playlist: true,
        expires,
        ...(referer ? { referer } : {}),
        ...(data.userAgent ? { userAgent: data.userAgent } : {}),
      },
      secret
    );
    return NextResponse.json(
      {
        url: `${worker.origin}/stream?token=${encodeURIComponent(token)}`,
        expires,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { error: '无效的直播资源地址或请求' },
      { status: 400, headers }
    );
  }
}
