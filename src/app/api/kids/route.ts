import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { KIDS_TITLES } from '@/lib/kids';
import {
  groupKidsVariants,
  kidsSearchTitle,
  KidsVariant,
} from '@/lib/kids-resources';

export const runtime = 'edge';
interface Entry {
  variants: KidsVariant[];
  updatedAt: number;
  checkedAt: number;
  stale: boolean;
}
async function boundedSearch(
  site: Parameters<typeof searchFromApi>[0],
  query: string
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      searchFromApi(site, query, 1),
      new Promise<Awaited<ReturnType<typeof searchFromApi>>>((resolve) => {
        timer = setTimeout(() => resolve([]), 10000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET(request: NextRequest) {
  const item = KIDS_TITLES.find(
    (title) => title.id === request.nextUrl.searchParams.get('id')
  );
  if (!item)
    return NextResponse.json(
      { error: '请选择少儿资源池中的动画' },
      { status: 400, headers }
    );
  try {
    const config = await getConfig();
    const allSources = config.SourceConfig.filter((site) => !site.disabled);
    const sources = allSources.slice(0, 8);
    // Include the complete effective catalog (and auth-bearing API URLs) privately
    // in the cache key. Results from a different permitted catalog cannot leak.
    const key = JSON.stringify([
      item.id,
      allSources.map((s) => [s.key, s.api, s.detail || '']),
    ]);
    let entry = cache.get(key);
    if (
      !entry ||
      Date.now() - entry.checkedAt >= (entry.stale ? 30000 : 10 * 60 * 1000)
    ) {
      let update = pending.get(key);
      if (!update) {
        const previous = entry;
        update = (async () => {
          let cursor = 0;
          const results: Awaited<ReturnType<typeof searchFromApi>>[] = [];
          await Promise.all(
            Array.from({ length: Math.min(4, sources.length) }, async () => {
              while (cursor < sources.length) {
                const site = sources[cursor++];
                try {
                  results.push(
                    await boundedSearch(site, kidsSearchTitle(item))
                  );
                } catch {
                  results.push([]);
                }
              }
            })
          );
          const variants = groupKidsVariants(item, results.flat());
          const updatedAt = variants.length
            ? Date.now()
            : previous?.updatedAt || 0;
          const next = {
            variants: variants.length ? variants : previous?.variants || [],
            updatedAt,
            checkedAt: Date.now(),
            stale: !variants.length,
          };
          if (cache.size >= 64 && !cache.has(key))
            cache.delete(cache.keys().next().value as string);
          cache.set(key, next);
          return next;
        })().finally(() => pending.delete(key));
        pending.set(key, update);
      }
      entry = await update;
    }
    return NextResponse.json(
      {
        variants: entry.variants,
        updatedAt: entry.updatedAt,
        stale: entry.stale,
        sourceCount: sources.length,
        hasMoreSources: allSources.length > sources.length,
      },
      { headers }
    );
  } catch {
    return NextResponse.json(
      { variants: [], error: '资源池暂时无法更新，请稍后重试' },
      { status: 503, headers }
    );
  }
}
