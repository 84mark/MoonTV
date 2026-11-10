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

import PageLayout from '@/components/PageLayout';
import VideoCard from '@/components/VideoCard';

const PAGE_SIZE = 25;

const POSTER_CONCURRENCY = 6;
const posterCache = new Map<string, { url: string; expires: number }>();
const languages = [
  ['all', '所有语言'],
  ['zh-CN', '普通话'],
  ['en', '英语'],
  ['yue', '粤语'],
  ['ja', '日语'],
  ['ko', '韩语'],
  ['fr', '法语'],
  ['ru', '俄语'],
];

function KidsPageClient() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get('kind') === 'movie' ? 'movie' : 'tv';
  const language = params.get('language') || 'all';
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('全部');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [posters, setPosters] = useState<Record<string, string>>({});
  const posterQueue = useRef<KidsTitle[]>([]);
  const posterRequests = useRef(new Map<string, AbortController>());
  const mounted = useRef(false);
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
          } ${item.theme}`
            .toLowerCase()
            .includes(query.trim().toLowerCase())
      ),
    [titleSeeds, theme, query]
  );
  const pageSeeds = useMemo(
    () => matchingSeeds.slice(0, limit),
    [matchingSeeds, limit]
  );
  const idsKey = pageSeeds.map((item) => item.id).join('|');
  // Catalog cards never wait for a video-source search or poster metadata.
  // A single queue survives pagination; appending a page does not restart requests.
  const drainPosters = useCallback(function drain() {
    while (
      mounted.current &&
      posterRequests.current.size < POSTER_CONCURRENCY
    ) {
      const seed = posterQueue.current.shift();
      if (!seed) break;
      if (posterRequests.current.has(seed.id)) continue;
      const controller = new AbortController();
      posterRequests.current.set(seed.id, controller);
      void (async () => {
        const timer = setTimeout(() => controller.abort(), 8000);
        let url = '';
        try {
          const request = new URLSearchParams({
            title: seed.name,
            kind: seed.kind,
            posterOnly: '1',
          });
          if (seed.year) request.set('year', seed.year);
          const response = await fetch(`/api/douban/subject?${request}`, {
            signal: controller.signal,
          });
          if (response.ok) {
            const data = await response.json();
            url =
              typeof data.subject?.poster === 'string'
                ? data.subject.poster
                : '';
          }
        } catch {
          // Missing metadata must never block browsing or playback discovery.
        } finally {
          clearTimeout(timer);
          if (posterRequests.current.get(seed.id) === controller) {
            posterRequests.current.delete(seed.id);
            if (mounted.current) {
              if (posterCache.size >= 256)
                posterCache.delete(posterCache.keys().next().value as string);
              posterCache.set(seed.id, {
                url,
                expires: Date.now() + (url ? 30 * 60 * 1000 : 60 * 1000),
              });
              setPosters((previous) => ({ ...previous, [seed.id]: url }));
              drain();
            }
          }
        }
      })();
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const requests = posterRequests.current;
    return () => {
      mounted.current = false;
      posterQueue.current = [];
      requests.forEach((controller) => controller.abort());
      requests.clear();
    };
  }, []);
  useEffect(() => {
    const cached: Record<string, string> = {};
    posterQueue.current = idsKey
      .split('|')
      .filter(Boolean)
      .flatMap((id) => {
        const hit = posterCache.get(id);
        if (hit && hit.expires > Date.now()) {
          cached[id] = hit.url;
          return [];
        }
        if (posterRequests.current.has(id)) return [];
        const seed = KIDS_TITLES.find((item) => item.id === id);
        return seed ? [seed] : [];
      });
    setPosters((previous) => ({ ...previous, ...cached }));
    drainPosters();
  }, [idsKey, drainPosters]);
  const hasMore = matchingSeeds.length > limit;
  useEffect(() => {
    if (!hasMore || !loadingRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          observer.disconnect();
          setLimit((value) => value + PAGE_SIZE);
        }
      },
      { threshold: 0.1, rootMargin: '600px 0px' }
    );
    observer.observe(loadingRef.current);
    return () => observer.disconnect();
  }, [hasMore, limit]);
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
                播放语言
              </span>
              <div className='overflow-x-auto'>
                <div className='glass-segment inline-flex rounded-full p-0.5 sm:p-1'>
                  {languages.map(([code, label]) => (
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
                  ))}
                </div>
              </div>
              {language !== 'all' && (
                <span className='text-xs text-gray-500'>
                  进入详情后匹配所选语言
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
              {matchingSeeds.length} 部动画
            </p>
          </div>
          <section
            aria-label='动画海报'
            className='grid grid-cols-2 justify-start gap-x-3 gap-y-5 px-0 sm:grid-cols-[repeat(auto-fill,minmax(160px,1fr))] sm:gap-x-5 sm:gap-y-8 sm:px-2'
          >
            {pageSeeds.map((seed) => (
              <div key={seed.id} className='min-w-0'>
                <VideoCard
                  from='douban'
                  title={seed.name}
                  query={kidsSearchTitle(seed)}
                  poster={posters[seed.id] || ''}
                  year={seed.year}
                  type={seed.kind}
                  doubanType={seed.kind}
                  kidsId={seed.id}
                  kidsLanguage={language === 'all' ? undefined : language}
                />
              </div>
            ))}
          </section>
          {!pageSeeds.length && (
            <div className='rounded-3xl bg-white/60 p-10 text-center dark:bg-slate-800'>
              <Search className='mx-auto mb-3 h-8 w-8 text-sky-400' />
              <h3 className='font-bold'>还没找到这部动画</h3>
              <p className='mt-2 text-sm text-slate-500'>
                换个名字或主题，再找找吧。
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
          {hasMore && (
            <div
              ref={loadingRef}
              aria-label='加载更多动画'
              className='mt-12 flex justify-center py-8'
            />
          )}
          {!hasMore && pageSeeds.length > 0 && (
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
