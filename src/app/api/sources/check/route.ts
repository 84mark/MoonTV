import { NextRequest, NextResponse } from 'next/server';

import { canManageSources, isSameOrigin } from '@/lib/source-admin';
import { checkSource } from '@/lib/source-network';
import { normalizeSources } from '@/lib/sources';

export const runtime = 'edge';
export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'no-store' };
  if (!isSameOrigin(request) || !(await canManageSources(request))) {
    return NextResponse.json(
      { error: '需要管理权限' },
      { status: 403, headers }
    );
  }
  try {
    const text = await request.text();
    if (text.length > 10000) throw new Error('请求过大');
    const [source] = normalizeSources([JSON.parse(text).source]);
    return NextResponse.json(await checkSource(source), { headers });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '检测请求无效' },
      { status: 400, headers }
    );
  }
}
