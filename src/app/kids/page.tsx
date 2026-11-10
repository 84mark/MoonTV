/* eslint-disable @next/next/no-img-element */
'use client';

import { ImageIcon, Languages, Play, Search, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { getBuiltinImageProxyUrl } from '@/lib/image-proxy';
import { KIDS_TITLES, KidsTitle } from '@/lib/kids';
import type { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import PageLayout from '@/components/PageLayout';

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
function Poster({
  url,
  name,
  pending,
  fallbackUrls = [],
}: {
  url: string;
  name: string;
  pending?: boolean;
  fallbackUrls?: string[];
}) {
  const [attempt, setAttempt] = useState(0);
  const src = url ? getBuiltinImageProxyUrl(url) || processImageUrl(url) : '';
  const alternative = url ? processImageUrl(url) : '';
  const candidates = Array.from(
    new Set(
      [
        src,
        alternative !== src ? alternative : url,
        ...fallbackUrls.map(
          (value) => getBuiltinImageProxyUrl(value) || processImageUrl(value)
        ),
      ].filter(Boolean)
    )
  );
  const candidatesKey = candidates.join('|');
  useEffect(() => setAttempt(0), [candidatesKey]);
  return candidates[attempt] ? (
    <img
      src={candidates[attempt]}
      alt={`${name}海报`}
      loading='lazy'
      decoding='async'
      referrerPolicy='no-referrer'
      className='h-full w-full object-cover transition-transform duration-300 group-hover:scale-105'
      onError={() => setAttempt((value) => value + 1)}
    />
  ) : (
    <div className='flex h-full w-full flex-col items-center justify-center gap-3 bg-slate-100 px-3 text-center text-slate-400 dark:bg-slate-800'>
      <ImageIcon className='h-9 w-9' strokeWidth={1.2} />
      <span className='line-clamp-2 text-sm font-semibold'>{name}</span>
      <span className='text-xs'>{pending ? '正在找海报…' : '海报暂缺'}</span>
    </div>
  );
}
function detailHref(
  source: SearchResult,
  variant: Variant,
  seed: KidsTitle,
  kind: string,
  language: string,
  fallbackPoster = ''
) {
  const returnParams = new URLSearchParams({ kind });
  if (language !== 'all') returnParams.set('language', language);
  const params = new URLSearchParams({
    source: source.source,
    id: source.id,
    title: source.title,
    stype: variant.kind,
    douban_type: variant.kind,
    kids_language: variant.language.code,
    kids_id: seed.id,
    returnTo: `/kids?${returnParams}`,
  });
  if (/^\d{4}$/.test(source.year || '')) params.set('year', source.year);
  const poster = source.poster || variant.poster || fallbackPoster;
  if (poster) params.set('poster', poster);
  return `/detail?${params}`;
}
function KidsPageClient() {
  const params = useSearchParams();
  const router = useRouter();
  const kind = params.get('kind') === 'movie' ? 'movie' : 'tv';
  const language = params.get('language') || 'all';
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState('全部');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [retry, setRetry] = useState(0);
  const [pools, setPools] = useState<Record<string, Pool>>({});
  const [posters, setPosters] = useState<Record<string, string>>({});
  const cache = useRef<Record<string, Pool>>({});
  const posterCache = useRef<Record<string, string>>({});
  const [selection, setSelection] = useState<{
    seedId: string;
    variantId?: string;
  } | null>(null);
  const modal = useRef<HTMLDivElement>(null);
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
          `${item.name} ${item.id} ${item.description} ${item.theme} ${
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
  }, [idsKey, retry, storePool]);
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
  }, [idsKey, retry]);
  const selectedSeedId = selection?.seedId;
  useEffect(() => {
    if (!selectedSeedId) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    modal.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelection(null);
      if (event.key === 'Tab') {
        const nodes = modal.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input, [tabindex="0"]'
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === modal.current)
        ) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [selectedSeedId]);
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
      // One recognizable poster per cartoon/audio language; seasons stay in the picker.
      const versions = new Map<string, Variant[]>();
      pool.variants
        .filter((v) => language === 'all' || v.language.code === language)
        .forEach((variant) => {
          versions.set(variant.language.code, [
            ...(versions.get(variant.language.code) || []),
            variant,
          ]);
        });
      return Array.from(versions.values()).map((values) => {
        values.sort(
          (a, b) =>
            Number(a.season.match(/\d+/)?.[0] || 0) -
              Number(b.season.match(/\d+/)?.[0] || 0) ||
            Number(Boolean(b.poster)) - Number(Boolean(a.poster)) ||
            Number(Boolean(b.year)) - Number(Boolean(a.year))
        );
        return { seed, variant: values[0] };
      });
    }
    const loading = !pool || pool.status === 'loading';
    return loading && (language === 'all' || language === 'unknown')
      ? [{ seed, variant: undefined }]
      : [];
  });
  const selectedSeed = selection
    ? KIDS_TITLES.find((item) => item.id === selection.seedId)
    : undefined;
  const selectedPool = selectedSeed ? pools[selectedSeed.id] : undefined;
  const selectedVariant =
    selectedPool?.variants.find((v) => v.id === selection?.variantId) ||
    selectedPool?.variants[0];
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
  const retrySeed = (id: string) => {
    const next = { ...cache.current };
    delete next[id];
    cache.current = next;
    setPools(next);
    const images = { ...posterCache.current };
    delete images[id];
    posterCache.current = images;
    setPosters(images);
    setRetry((v) => v + 1);
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
            {cards.map(({ seed, variant }) => {
              const pool = pools[seed.id];
              const title = variant?.title || seed.name;
              const pending = !pool || pool.status === 'loading';
              return (
                <button
                  key={variant?.id || seed.id}
                  onClick={() =>
                    setSelection({ seedId: seed.id, variantId: variant?.id })
                  }
                  aria-label={`选择 ${title} · ${
                    variant?.language.label || '查找版本'
                  }`}
                  className='poster-card group min-w-0 text-left outline-none focus-visible:ring-4 focus-visible:ring-sky-400/50'
                >
                  <div className='relative aspect-[2/3] overflow-hidden rounded-2xl bg-slate-100 shadow-md transition-transform group-hover:-translate-y-1 dark:bg-slate-800'>
                    <Poster
                      url={
                        variant?.poster ||
                        variant?.sources.find((source) => source.poster)
                          ?.poster ||
                        posters[seed.id] ||
                        ''
                      }
                      name={title}
                      fallbackUrls={[
                        posters[seed.id] || '',
                        ...(variant?.sources.map((source) => source.poster) ||
                          []),
                      ].filter(Boolean)}
                      pending={
                        pending ||
                        (!variant?.poster &&
                          !variant?.sources.some((source) => source.poster) &&
                          !(seed.id in posters))
                      }
                    />
                    <div className='absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/25 to-transparent px-2 pb-2 pt-12'>
                      <span
                        className={`inline-flex max-w-full items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-bold shadow-sm sm:text-xs ${
                          variant
                            ? variant.language.code === 'unknown'
                              ? 'bg-amber-100 text-amber-900'
                              : 'bg-white text-slate-800'
                            : 'bg-black/50 text-white'
                        }`}
                      >
                        <Languages className='h-3 w-3 shrink-0' />
                        <span className='truncate'>
                          {variant?.language.label ||
                            (pending
                              ? '正在找版本…'
                              : pool?.status === 'error'
                              ? '点我再试试'
                              : '暂未找到片源')}
                        </span>
                      </span>
                    </div>
                    {variant && (
                      <span className='absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-sky-600 shadow-sm'>
                        <Play className='ml-0.5 h-4 w-4 fill-current' />
                      </span>
                    )}
                  </div>
                  <h3 className='mt-2 line-clamp-2 text-sm font-bold leading-5 text-slate-800 dark:text-slate-100 sm:text-base'>
                    {title}
                  </h3>
                  <p className='mt-1 truncate text-xs text-slate-400'>
                    {variant
                      ? [
                          variant.season,
                          variant.year,
                          `${
                            pools[seed.id].variants.filter(
                              (value) =>
                                value.language.code === variant.language.code
                            ).length
                          } 个季 / 版本可选`,
                        ]
                          .filter(Boolean)
                          .join(' · ')
                      : pending
                      ? '马上就好'
                      : '看看详情，或重新找一找'}
                  </p>
                </button>
              );
            })}
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
      {selection && selectedSeed && (
        <div
          className='fixed inset-0 z-[1000] flex items-end justify-center bg-slate-950/55 p-0 backdrop-blur-sm sm:items-center sm:p-5'
          onClick={(event) => {
            if (event.target === event.currentTarget) setSelection(null);
          }}
        >
          <div
            ref={modal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='kids-version-title'
            tabIndex={-1}
            className='max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl outline-none dark:bg-slate-900 sm:rounded-3xl sm:p-6'
          >
            <div className='flex items-start justify-between gap-3'>
              <div>
                <p className='mb-1 text-xs font-semibold text-sky-600'>
                  选好语言，就出发！
                </p>
                <h2 id='kids-version-title' className='text-xl font-bold'>
                  {selectedSeed.name}
                </h2>
              </div>
              <button
                aria-label='关闭版本选择'
                onClick={() => setSelection(null)}
                className='flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-100 dark:bg-slate-800'
              >
                <X className='h-5 w-5' />
              </button>
            </div>
            {selectedPool?.variants.length ? (
              <>
                <div
                  className='my-5 flex flex-wrap gap-2'
                  aria-label='动画语言版本'
                >
                  {selectedPool.variants.map((variant) => (
                    <button
                      key={variant.id}
                      aria-pressed={selectedVariant?.id === variant.id}
                      onClick={() =>
                        setSelection({
                          seedId: selectedSeed.id,
                          variantId: variant.id,
                        })
                      }
                      className={`min-h-[44px] rounded-xl border-2 px-3 py-2 text-sm font-semibold ${
                        selectedVariant?.id === variant.id
                          ? 'border-sky-400 bg-sky-50 text-sky-800 dark:bg-sky-950 dark:text-sky-200'
                          : 'border-slate-100 text-slate-500 dark:border-slate-700'
                      }`}
                    >
                      {variant.language.label}
                      {variant.season ? ` · ${variant.season}` : ''}
                    </button>
                  ))}
                </div>
                {selectedVariant && (
                  <div>
                    <p className='mb-3 flex items-center gap-2 text-sm font-semibold'>
                      <Languages className='h-4 w-4 text-sky-500' />
                      {selectedVariant.language.label}
                      <span className='text-xs font-normal text-slate-400'>
                        · {selectedVariant.title}
                      </span>
                    </p>
                    <div className='space-y-2'>
                      {selectedVariant.sources.map((source, index) => (
                        <Link
                          key={`${source.source}:${source.id}`}
                          href={detailHref(
                            source,
                            selectedVariant,
                            selectedSeed,
                            kind,
                            language,
                            posters[selectedSeed.id] || ''
                          )}
                          className='flex min-h-[56px] items-center justify-between gap-3 rounded-2xl bg-sky-500 px-4 py-3 text-white transition-colors hover:bg-sky-600'
                        >
                          <span>
                            <strong className='block text-sm'>
                              {index === 0 ? '就看这个版本' : '换一个播放来源'}
                            </strong>
                            <span className='mt-1 block text-xs text-sky-100'>
                              {source.source_name} · {source.episodes.length}{' '}
                              {selectedVariant.kind === 'movie' ? '段' : '集'}
                            </span>
                          </span>
                          <Play className='h-5 w-5 shrink-0 fill-current' />
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div className='py-8 text-center'>
                <p className='text-sm text-slate-500'>
                  {!selectedPool || selectedPool.status === 'loading'
                    ? '正在资源池里找这部动画…'
                    : selectedPool.error || '暂时还没有找到可选的播放版本'}
                </p>
                <button
                  onClick={() => retrySeed(selectedSeed.id)}
                  className='mt-4 rounded-xl bg-sky-500 px-5 py-3 font-semibold text-white'
                >
                  再找一次
                </button>
              </div>
            )}
          </div>
        </div>
      )}
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
