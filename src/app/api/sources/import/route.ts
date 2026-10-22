import { NextRequest, NextResponse } from 'next/server';

import { canManageSources, isSameOrigin } from '@/lib/source-admin';
import { parseSourceImport } from '@/lib/sources';

export const runtime = 'edge';
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isSameOrigin(request) || !(await canManageSources(request))) {
    return NextResponse.json(
      { error: '需要管理权限' },
      { status: 403, headers }
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const body = await request.json();
    const url = new URL(body.url);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'raw.githubusercontent.com' ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw new Error(
        '订阅地址需使用 https://raw.githubusercontent.com 的原始 JSON 文件链接'
      );
    }
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`GitHub 返回 HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) throw new Error('订阅内容为空');
    let text = '',
      size = 0;
    const decoder = new TextDecoder();
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 1024 * 1024) {
        await reader.cancel();
        throw new Error('订阅不能超过 1 MiB');
      }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    return NextResponse.json({ sources: parseSourceImport(text) }, { headers });
  } catch (error) {
    return NextResponse.json(
      {
        error: controller.signal.aborted
          ? '读取 GitHub 超时，可下载 JSON 后手动导入'
          : error instanceof Error
          ? error.message
          : '导入失败',
      },
      { status: 400, headers }
    );
  } finally {
    clearTimeout(timer);
  }
}
