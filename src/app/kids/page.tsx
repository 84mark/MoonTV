'use client';

import { Search, X } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { KIDS_TITLES, KidsTitle } from '@/lib/kids';
import { kidsSearchTitle } from '@/lib/kids-resources';
import type { SearchResult } from '@/lib/types';

import DoubanCardSkeleton from '@/components/DoubanCardSkeleton';
import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

const PAGE_SIZE = 25;

interface Variant {
  id: string;
  title: string;
  poster: string;
  language: { code: string; label: string };
  sources: SearchResult[];
  season: string;
  year: string;
  kind: 'movie' | 'tv';
}
interface Pool {
  status: 'loading' | 'ready' | 'error';
  variants: Variant[];
  error?: string;
}
function KidsPageClient() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get('kind') === 'movie' ? 'movie' : 'tv';
  const language = params.get('language') || 'all';
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('全部');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [pools, setPools] = useState<Record<string, Pool>>({});
  const [posters, setPosters] = useState<Record<string, string>>({});
  const cache = useRef<Record<string, Pool>>({});
  const posterCache = useRef<Record<string, string>>({});
  const loadingRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setLimit(PAGE_SIZE);
  }, [kind, language, theme, query]);
  const titleSeeds = useMemo(
    () => KIDS_TITLES.filter((item) => item.kind === kind),
    [kind]
  );
  const themes = useMemo(
    () => [
      '全部',
      ...Array.from(new Set(titleSeeds.map((item) => item.theme))),
    ],
    [titleSeeds]
  );
  const matchingSeeds = useMemo(
    () =>
      titleSeeds.filter(
        (item) =>
          (theme === '全部' || item.theme === theme) &&
          `${item.name} ${(item.aliases || []).join(' ')} ${item.id} ${
            item.description
          } ${item.theme} ${
            pools[item.id]?.variants
              .map((variant) => variant.title)
              .join(' ') || ''
          }`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
      ),
    [titleSeeds, theme, query, pools]
  );
  const pageSeeds = useMemo(
    () => matchingSeeds.slice(0, limit),
    [matchingSeeds, limit]
  );
  const idsKey = pageSeeds.map((item) => item.id).join('|');
  const storePool = useCallback((id: string, value: Pool) => {
    cache.current = { ...cache.current, [id]: value };
    setPools(cache.current);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const seeds = idsKey
      .split('|')
      .filter(Boolean)
      .map((id) => KIDS_TITLES.find((item) => item.id === id))
      .filter((item): item is KidsTitle => Boolean(item));
    let cursor = 0;
    async function worker() {
      while (cursor < seeds.length && !controller.signal.aborted) {
        const seed = seeds[cursor++];
        if (
          cache.current[seed.id]?.status === 'ready' ||
          cache.current[seed.id]?.status === 'error'
        )
          continue;
        storePool(seed.id, { status: 'loading', variants: [] });
        try {
          const response = await fetch(
            `/api/kids?${new URLSearchParams({ id: seed.id })}`,
            { signal: controller.signal, cache: 'no-store' }
          );
          if (!response.ok)
            throw new Error(
              response.status === 401
                ? '请重新登录后找动画'
                : '这次没找到，请再试一次'
            );
          const data = await response.json();
          if (!Array.isArray(data.variants))
            throw new Error('这次没找到，请再试一次');
          if (!controller.signal.aborted)
            storePool(seed.id, { status: 'ready', variants: data.variants });
        } catch (error) {
          if (!controller.signal.aborted)
            storePool(seed.id, {
              status: 'error',
              variants: [],
              error:
                error instanceof Error ? error.message : '找动画遇到一点问题',
            });
        }
      }
    }
    const timer = setTimeout(() => {
      void Promise.all([worker(), worker()]);
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [idsKey, storePool]);
  // Posters are metadata only: their original language never labels a playable version.
  useEffect(() => {
    const controller = new AbortController();
    const seeds = idsKey
      .split('|')
      .filter(Boolean)
      .map((id) => KIDS_TITLES.find((item) => item.id === id))
      .filter((item): item is KidsTitle => Boolean(item));
    let cursor = 0;
    async function worker() {
      while (cursor < seeds.length && !controller.signal.aborted) {
        const seed = seeds[cursor++];
        if (
          seed.id in posterCache.current ||
          cache.current[seed.id]?.variants.some((item) => item.poster)
        )
          continue;
        try {
          const response = await fetch(
            `/api/douban/subject?${new URLSearchParams({
              title: seed.name,
              kind: seed.kind,
              posterOnly: '1',
            })}`,
            { signal: controller.signal }
          );
          if (!response.ok) throw new Error('Metadata unavailable');
          const data = await response.json();
          if (!controller.signal.aborted) {
            posterCache.current = {
              ...posterCache.current,
              [seed.id]: data.subject?.poster || '',
            };
            setPosters(posterCache.current);
          }
        } catch {
          if (!controller.signal.aborted) {
            posterCache.current = { ...posterCache.current, [seed.id]: '' };
            setPosters(posterCache.current);
          }
        }
      }
    }
    const timer = setTimeout(() => {
      void Promise.all([worker(), worker()]);
    }, 100);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [idsKey]);
  const availableLanguages = useMemo(() => {
    const labels = new Map<string, string>();
    titleSeeds.forEach((seed) =>
      pools[seed.id]?.variants.forEach((v) =>
        labels.set(v.language.code, v.language.label)
      )
    );
    return Array.from(labels.entries());
  }, [pools, titleSeeds]);
  const cards = pageSeeds.flatMap<{
    seed: KidsTitle;
    variant: Variant | undefined;
  }>((seed) => {
    const pool = pools[seed.id];
    if (pool?.variants.length) {
      return pool.variants
        .filter(
          (variant) => language === 'all' || variant.language.code === language
        )
        .map((variant) => ({ seed, variant }));
    }
    const loading = !pool || pool.status === 'loading';
    return loading && (language === 'all' || language === 'unknown')
      ? [{ seed, variant: undefined }]
      : [];
  });
  const busy = pageSeeds.some(
    (seed) => !pools[seed.id] || pools[seed.id].status === 'loading'
  );
  const hasMore = matchingSeeds.length > limit;
  useEffect(() => {
    if (!hasMore || busy || !loadingRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          setLimit((value) => value + PAGE_SIZE);
        }
      },
      { threshold: 0.1 }
    );
    observer.observe(loadingRef.current);
    return () => observer.disconnect();
  }, [hasMore, busy, limit]);
  const updateFilter = (nextKind: string, nextLanguage = language) => {
    setLimit(PAGE_SIZE);
    if (nextKind !== kind) {
      setTheme('全部');
      setQuery('');
    }
    const search = new URLSearchParams({ kind: nextKind });
    if (nextLanguage !== 'all') search.set('language', nextLanguage);
    router.replace(`/kids?${search}`, { scroll: false });
  };
  return (
    <PageLayout activePath='/kids'>
      <div className='catalog-page overflow-visible'>
        <div className='mb-6 space-y-4 sm:mb-8 sm:space-y-6'>
          <header>
            <h1 className='mb-1 text-2xl font-bold text-gray-800 dark:text-gray-200 sm:mb-2 sm:text-3xl'>
              少儿
            </h1>
            <p className='text-sm text-gray-600 dark:text-gray-400 sm:text-base'>
              精选动画剧集与电影
            </p>
          </header>
          <div className='glass-panel space-y-4 p-4 sm:space-y-6 sm:p-6'>
            <div
              className='flex flex-col gap-2 sm:flex-row sm:items-center'
              aria-label='动画类型'
            >
              <span className='min-w-[48px] text-xs font-medium text-gray-600 dark:text-gray-400 sm:text-sm'>
                分类
              </span>
              <div className='glass-segment inline-flex w-fit rounded-full p-0.5 sm:p-1'>
                {[
                  { kind: 'tv', name: '动画剧集' },
                  { kind: 'movie', name: '动画电影' },
                ].map((item) => (
                  <button
                    key={item.kind}
                    aria-pressed={kind === item.kind}
                    onClick={() => updateFilter(item.kind, 'all')}
                    className={`rounded-full px-2 py-1 text-xs font-medium transition-all sm:px-4 sm:py-2 sm:text-sm ${
                      kind === item.kind
                        ? 'glass-segment-indicator text-gray-900 dark:text-gray-100'
                        : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                    }`}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            </div>
            <div
              className='flex flex-col gap-2 sm:flex-row sm:items-center'
              aria-label='选择动画语言'
            >
              <span className='min-w-[48px] text-xs font-medium text-gray-600 dark:text-gray-400 sm:text-sm'>
                语言
              </span>
              <div className='overflow-x-auto'>
                <div className='glass-segment inline-flex rounded-full p-0.5 sm:p-1'>
                  {[['all', '所有语言'], ...availableLanguages].map(
                    ([code, label]) => (
                      <button
                        key={code}
                        aria-pressed={language === code}
                        onClick={() => updateFilter(kind, code)}
                        className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-all sm:px-4 sm:py-2 sm:text-sm ${
                          language === code
                            ? 'glass-segment-indicator text-gray-900 dark:text-gray-100'
                            : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                        }`}
                      >
                        {label}
                      </button>
                    )
                  )}
                </div>
              </div>
              {language !== 'all' &&
                !availableLanguages.some(([code]) => code === language) && (
                  <span className='text-xs text-gray-500'>
                    {busy ? '正在查找这个语言版本…' : '暂未找到这个语言版本'}
                  </span>
                )}
            </div>
            <div
              className='flex flex-col gap-2 sm:flex-row sm:items-center'
              aria-label='动画主题'
            >
              <span className='min-w-[48px] text-xs font-medium text-gray-600 dark:text-gray-400 sm:text-sm'>
                主题
              </span>
              <div className='overflow-x-auto'>
                <div className='glass-segment inline-flex rounded-full p-0.5 sm:p-1'>
                  {themes.map((value) => (
                    <button
                      key={value}
                      aria-pressed={theme === value}
                      onClick={() => {
                        setTheme(value);
                        setLimit(PAGE_SIZE);
                      }}
                      className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium transition-all sm:px-4 sm:py-2 sm:text-sm ${
                        theme === value
                          ? 'glass-segment-indicator text-gray-900 dark:text-gray-100'
                          : 'text-gray-700 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100'
                      }`}
                    >
                      {value === '全部' ? '全部动画' : value}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className='flex items-center gap-3 rounded-xl border border-gray-200/60 bg-white/50 px-3 dark:border-gray-700 dark:bg-gray-900/30'>
              <Search className='h-4 w-4 shrink-0 text-gray-400' />
              <input
                aria-label='搜索动画'
                value={query}
                onChange={(event) => {
                  setLimit(PAGE_SIZE);
                  setQuery(event.target.value);
                }}
                placeholder='搜索动画名称'
                className='min-h-[40px] min-w-0 flex-1 bg-transparent text-sm outline-none'
              />
              {query && (
                <button
                  aria-label='清除搜索'
                  onClick={() => setQuery('')}
                  className='p-2'
                >
                  <X className='h-4 w-4' />
                </button>
              )}
            </div>
          </div>
        </div>
        <div className='mx-auto mt-8 max-w-[95%] overflow-visible'>
          <div className='mb-4 flex items-center justify-between gap-3'>
            <h2 className='text-lg font-bold'>
              {query ? '搜索结果' : kind === 'tv' ? '动画剧集' : '动画电影'}
            </h2>
            <p role='status' className='text-xs text-slate-400'>
              {busy
                ? '正在找动画和语言版本…'
                : `${cards.filter((card) => card.variant).length} 个资源版本`}
            </p>
          </div>
          <section
            aria-label='动画海报'
            className='grid grid-cols-2 justify-start gap-x-3 gap-y-5 px-0 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-5 sm:gap-y-8 sm:px-2'
          >
            {cards.map(({ seed, variant }) =>
              variant ? (
                <div key={variant.id} className='min-w-0'>
                  <VideoCard
                    from='douban'
                    title={variant.title}
                    query={kidsSearchTitle(seed)}
                    source={variant.sources[0]?.source}
                    id={variant.sources[0]?.id}
                    poster={
                      variant.poster ||
                      variant.sources.find((source) => source.poster)?.poster ||
                      posters[seed.id] ||
                      ''
                    }
                    year={variant.year}
                    type={variant.kind}
                    doubanType={variant.kind}
                    kidsId={seed.id}
                    kidsLanguage={variant.language.code}
                  />
                  <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
                    {[variant.language.label, variant.season]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
              ) : (
                <DoubanCardSkeleton key={seed.id} />
              )
            )}
          </section>
          {!cards.length && (
            <div className='rounded-3xl bg-white/60 p-10 text-center dark:bg-slate-800'>
              <Search className='mx-auto mb-3 h-8 w-8 text-sky-400' />
              <h3 className='font-bold'>还没找到这部动画</h3>
              <p className='mt-2 text-sm text-slate-500'>
                换个名字或语言，再找找吧。
              </p>
              <button
                className='mt-4 rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white'
                onClick={() => {
                  setQuery('');
                  setTheme('全部');
                  updateFilter(kind, 'all');
                }}
              >
                看看全部动画
              </button>
            </div>
          )}
          {(hasMore || busy) && (
            <div
              ref={loadingRef}
              aria-label='加载更多动画'
              className='mt-12 flex justify-center py-8'
            >
              {busy && (
                <div
                  role='status'
                  className='flex items-center gap-2 text-gray-600 dark:text-gray-400'
                >
                  <div className='h-6 w-6 animate-spin rounded-full border-b-2 border-green-500' />
                  加载中...
                </div>
              )}
            </div>
          )}
          {!hasMore && !busy && cards.length > 0 && (
            <div className='py-8 text-center text-gray-500'>已加载全部内容</div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
export default function KidsPage() {
  return (
    <Suspense
      fallback={
        <div className='p-8 text-sm text-slate-500'>正在打开少儿频道…</div>
      }
    >
      <KidsPageClient />
    </Suspense>
  );
}
