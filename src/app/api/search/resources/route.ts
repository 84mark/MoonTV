import { NextResponse } from 'next/server';

import { getAvailableApiSites, getCacheTime, sourceCacheHeaders } from '@/lib/config';

export const runtime = 'edge';

// OrionTV 兼容接口
export async function GET() {
  try {
    const apiSites = await getAvailableApiSites();
    const cacheTime = await getCacheTime();

    return NextResponse.json(apiSites, {
      headers: sourceCacheHeaders(cacheTime),
    });
  } catch (error) {
    return NextResponse.json({ error: '获取资源失败' }, { status: 500 });
  }
}
