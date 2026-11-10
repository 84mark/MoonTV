import { NextRequest, NextResponse } from 'next/server';

import { getConfig } from '@/lib/config';
import { searchFromApi } from '@/lib/downstream';
import { KIDS_TITLES } from '@/lib/kids';
import {
  groupKidsVariants,
  kidsSearchTitle,
  KidsVariant,
  matchesKidsTitle,
} from '@/lib/kids-resources';

export const runtime = 'edge';
interface Entry {
  variants: KidsVariant[];
  updatedAt: number;
  checkedAt: number;
  stale: boolean;
  nextOffset: number;
  sourceCount: number;
}
async function boundedSearch(
  site: Parameters<typeof searchFromApi>[0],
  query: string,
  deadline: number
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  try {
    return await Promise.race([
      searchFromApi(site, query, 2, controller.signal),
      new Promise<Awaited<ReturnType<typeof searchFromApi>>>((resolve) => {
        timer = setTimeout(
          () => resolve([]),
          Math.min(18000, Math.max(0, deadline - Date.now()))
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}
const cache = new Map<string, Entry>();
const pending = new Map<string, Promise<Entry>>();
const headers = { 'Cache-Control': 'private, no-store' };
const SOURCE_LIMIT = 12;
const SEARCH_BUDGET = 16; // At most two pages each, excluding HTTP redirects.
const DISCOVERY_TIMEOUT = 20000;

function initialOffset(id: string, count: number): number {
  if (count <= SOURCE_LIMIT) return 0;
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % count;
}

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
          const offset =
            previous?.nextOffset ?? initialOffset(item.id, allSources.length);
          const sources = Array.from(
            { length: Math.min(SOURCE_LIMIT, allSources.length) },
            (_, index) => allSources[(offset + index) % allSources.length]
          );
          const deadline = Date.now() + DISCOVERY_TIMEOUT;
          let cursor = 0;
          let calls = 0;
          const searched = new Set<string>();
          const results: Awaited<ReturnType<typeof searchFromApi>>[] = [];
          const retrySources: typeof sources = [];
          const search = async (
            site: (typeof sources)[number],
            query: string
          ) => {
            if (Date.now() >= deadline || calls >= SEARCH_BUDGET) return [];
            calls++;
            searched.add(site.key);
            try {
              return await boundedSearch(site, query, deadline);
            } catch {
              return [];
            }
          };
          // Give every selected source its primary search before spending budget
          // on aliases. A slow/empty source cannot monopolize discovery.
          await Promise.all(
            Array.from({ length: Math.min(4, sources.length) }, async () => {
              while (cursor < sources.length && Date.now() < deadline) {
                const site = sources[cursor++];
                const found = await search(site, kidsSearchTitle(item));
                results.push(found);
                if (!found.some((result) => matchesKidsTitle(item, result)))
                  retrySources.push(site);
              }
            })
          );
          const aliases = Array.from(new Set(item.aliases || []))
            .filter((alias) => alias !== kidsSearchTitle(item))
            .slice(0, 2);
          for (const alias of aliases) {
            let retryCursor = 0;
            await Promise.all(
              Array.from(
                { length: Math.min(4, retrySources.length) },
                async () => {
                  while (
                    retryCursor < retrySources.length &&
                    calls < SEARCH_BUDGET &&
                    Date.now() < deadline
                  ) {
                    const site = retrySources[retryCursor++];
                    if (
                      results.some((found) =>
                        found.some(
                          (result) =>
                            result.source === site.key &&
                            matchesKidsTitle(item, result)
                        )
                      )
                    )
                      continue;
                    results.push(await search(site, alias));
                  }
                }
              )
            );
          }
          const discovered = groupKidsVariants(item, results.flat());
          // Preserve previously discovered sources outside this rotating window.
          const variants = discovered.length
            ? groupKidsVariants(item, [
                ...results.flat(),
                ...(previous?.variants
                  .flatMap((variant) => variant.sources)
                  .filter((source) => !searched.has(source.source)) || []),
              ])
            : [];
          const updatedAt = variants.length
            ? Date.now()
            : previous?.updatedAt || 0;
          const next = {
            variants: variants.length ? variants : previous?.variants || [],
            updatedAt,
            checkedAt: Date.now(),
            stale: !variants.length,
            nextOffset: allSources.length
              ? (offset + searched.size) % allSources.length
              : 0,
            sourceCount: searched.size,
          };
          if (cache.size >= 256 && !cache.has(key))
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
        sourceCount: entry.sourceCount,
        hasMoreSources: allSources.length > entry.sourceCount,
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
