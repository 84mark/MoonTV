import { NextRequest, NextResponse } from 'next/server';

import { getLiveCatalog } from '@/lib/live-catalog';
import {
  rewriteLivePlaylist,
  validateLiveRelayUrl,
  verifyLiveRelayToken,
} from '@/lib/live-relay';

export const runtime = 'edge';
const noStore = { 'Cache-Control': 'private, no-store' };
export async function GET(request: NextRequest) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  let streaming = false;
  try {
    const secret = process.env.PASSWORD || '';
    if (!secret)
      return NextResponse.json(
        { error: '直播转发尚未配置站点密钥' },
        { status: 503, headers: noStore }
      );
    let resource: { url: string; playlist: boolean };
    const token = request.nextUrl.searchParams.get('token');
    if (token) {
      try {
        resource = await verifyLiveRelayToken(token, secret);
      } catch (error) {
        return NextResponse.json(
          {
            error: error instanceof Error ? error.message : '直播资源签名无效',
          },
          { status: 403, headers: noStore }
        );
      }
    } else {
      const id = request.nextUrl.searchParams.get('channel');
      const rawLine = request.nextUrl.searchParams.get('line') || '0';
      if (!id || !/^(0|[1-9]\d{0,3})$/.test(rawLine))
        return NextResponse.json(
          { error: '请指定有效的内置频道和线路' },
          { status: 400, headers: noStore }
        );
      const catalog = await getLiveCatalog();
      const channel = catalog.channels.find(
        (c) => c.id === id && /^(cn|hk|mo|tw):/.test(c.id)
      );
      const url = channel?.urls[Number(rawLine)];
      if (!url)
        return NextResponse.json(
          { error: '该频道或线路不在内置频道列表中' },
          { status: 404, headers: noStore }
        );
      resource = { url, playlist: true };
    }
    let target = validateLiveRelayUrl(resource.url);
    const headers = new Headers();
    const range = request.headers.get('Range');
    if (range) {
      if (!/^bytes=\d*-\d*$/.test(range))
        return NextResponse.json(
          { error: '不支持该范围请求' },
          { status: 400, headers: noStore }
        );
      headers.set('Range', range);
    }
    let response: Response | undefined;
    for (let hop = 0; hop <= 4; hop++) {
      response = await fetch(target.href, {
        headers,
        redirect: 'manual',
        signal: controller.signal,
        cache: 'no-store',
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('Location');
      await response.body?.cancel();
      if (!location || hop === 4) throw new Error('直播源重定向过多或地址无效');
      target = validateLiveRelayUrl(new URL(location, target).href);
    }
    if (!response?.ok) {
      await response?.body?.cancel();
      return NextResponse.json(
        { error: `直播源响应异常（HTTP ${response?.status || 502}）` },
        { status: response?.status === 416 ? 416 : 502, headers: noStore }
      );
    }
    const type = response.headers.get('Content-Type') || '';
    if (
      resource.playlist ||
      /mpegurl/i.test(type) ||
      /\.m3u8$/i.test(target.pathname)
    ) {
      const reader = response.body?.getReader();
      let text = '';
      const decoder = new TextDecoder();
      let size = 0;
      if (reader) {
        let chunk = await reader.read();
        while (!chunk.done) {
          size += chunk.value.byteLength;
          if (size > 1024 * 1024) {
            await reader.cancel();
            throw new Error('直播播放列表过大');
          }
          text += decoder.decode(chunk.value, { stream: true });
          chunk = await reader.read();
        }
        text += decoder.decode();
      }
      const playlist = await rewriteLivePlaylist(text, target.href, secret);
      return new Response(playlist, {
        headers: {
          ...noStore,
          'Content-Type': 'application/vnd.apple.mpegurl; charset=utf-8',
        },
      });
    }
    const outgoing = new Headers(noStore);
    for (const name of ['Content-Type', 'Content-Range', 'Accept-Ranges']) {
      const value = response.headers.get(name);
      if (value) outgoing.set(name, value);
    }
    const reader = response.body?.getReader();
    if (!reader)
      return new Response(null, { status: response.status, headers: outgoing });
    const body = new ReadableStream({
      async pull(stream) {
        try {
          const next = await reader.read();
          if (next.done) {
            clearTimeout(timeout);
            stream.close();
          } else stream.enqueue(next.value);
        } catch (error) {
          clearTimeout(timeout);
          stream.error(error);
        }
      },
      async cancel() {
        clearTimeout(timeout);
        controller.abort();
        await reader.cancel();
      },
    });
    streaming = true;
    return new Response(body, { status: response.status, headers: outgoing });
  } catch (error) {
    return NextResponse.json(
      {
        error: controller.signal.aborted
          ? '直播源连接超时，请尝试其他线路'
          : error instanceof Error
          ? error.message
          : '直播源暂时不可用',
      },
      { status: controller.signal.aborted ? 504 : 502, headers: noStore }
    );
  } finally {
    if (!streaming) clearTimeout(timeout);
  }
}
