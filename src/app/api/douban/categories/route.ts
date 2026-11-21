import { NextResponse } from 'next/server';

import { getCacheTime } from '@/lib/config';
import { DoubanItem, DoubanResult } from '@/lib/types';

class DoubanRateLimitError extends Error {
  constructor(readonly retryAfter: string) {
    super('豆瓣 HTTP 429');
  }
}

interface DoubanCategoryApiResponse {
  total: number;
  items: Array<{
    id: string;
    title: string;
    card_subtitle: string;
    pic: {
      large: string;
      normal: string;
    };
    rating: {
      value: number;
    };
  }>;
}

async function fetchDoubanData(
  url: string
): Promise<DoubanCategoryApiResponse> {
  // 添加超时控制
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时

  // 设置请求选项，包括信号和头部
  const fetchOptions = {
    signal: controller.signal,
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      Referer: 'https://movie.douban.com/',
      Accept: 'application/json, text/plain, */*',
      Origin: 'https://movie.douban.com',
    },
  };

  try {
    for (let attempt = 0; ; attempt++) {
      let response: Response;
      try {
        response = await fetch(url, fetchOptions);
      } catch (error) {
        if (attempt > 0 || controller.signal.aborted) throw error;
        await new Promise((resolve) => setTimeout(resolve, 350));
        continue;
      }
      if (response.ok) {
        const data = await response.json();
        if (!Array.isArray(data?.items))
          throw new Error('豆瓣响应缺少分类列表');
        return data;
      }
      await response.body?.cancel();
      if (response.status === 429) {
        throw new DoubanRateLimitError(
          response.headers.get('Retry-After') || '30'
        );
      }
      if (attempt > 0 || ![500, 502, 503, 504].includes(response.status)) {
        throw new Error(`豆瓣 HTTP ${response.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

export const runtime = 'edge';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 获取参数
  const kind = searchParams.get('kind') || 'movie';
  const category = searchParams.get('category');
  const type = searchParams.get('type');
  const pageLimit = parseInt(searchParams.get('limit') || '20');
  const pageStart = parseInt(searchParams.get('start') || '0');

  // 验证参数
  if (!kind || !category || !type) {
    return NextResponse.json(
      { error: '缺少必要参数: kind 或 category 或 type' },
      { status: 400 }
    );
  }

  if (!['tv', 'movie'].includes(kind)) {
    return NextResponse.json(
      { error: 'kind 参数必须是 tv 或 movie' },
      { status: 400 }
    );
  }

  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
    return NextResponse.json(
      { error: 'pageSize 必须在 1-100 之间' },
      { status: 400 }
    );
  }

  if (!Number.isInteger(pageStart) || pageStart < 0) {
    return NextResponse.json(
      { error: 'pageStart 不能小于 0' },
      { status: 400 }
    );
  }

  const target = `https://m.douban.com/rexxar/api/v2/subject/recent_hot/${kind}?${new URLSearchParams(
    { start: String(pageStart), limit: String(pageLimit), category, type }
  )}`;

  try {
    // 调用豆瓣 API
    const doubanData = await fetchDoubanData(target);

    // 转换数据格式
    const list: DoubanItem[] = doubanData.items.map((item) => ({
      id: item.id,
      title: item.title,
      poster: item.pic?.normal || item.pic?.large || '',
      rate: item.rating?.value ? item.rating.value.toFixed(1) : '',
      year: item.card_subtitle?.match(/(\d{4})/)?.[1] || '',
    }));

    const response: DoubanResult = {
      code: 200,
      message: '获取成功',
      list: list,
    };

    const cacheTime = await getCacheTime().catch(() => 7200);
    return NextResponse.json(response, {
      headers: {
        'Cache-Control': `public, max-age=${cacheTime}, s-maxage=${cacheTime}`,
        'CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
        'Vercel-CDN-Cache-Control': `public, s-maxage=${cacheTime}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: '获取豆瓣数据失败', details: (error as Error).message },
      {
        status: error instanceof DoubanRateLimitError ? 429 : 502,
        headers: {
          'Cache-Control': 'no-store',
          ...(error instanceof DoubanRateLimitError
            ? { 'Retry-After': error.retryAfter }
            : {}),
        },
      }
    );
  }
}
