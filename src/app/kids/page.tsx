/* eslint-disable @next/next/no-img-element */
'use client';

import {
  ChevronDown,
  Film,
  ImageIcon,
  Languages,
  Play,
  Search,
  Sparkles,
  Tv,
  X,
} from 'lucide-react';
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
  const [limit, setLimit] = useState(8);
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
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
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
    void Promise.all([worker(), worker()]);
    return () => controller.abort();
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
  const updateFilter = (nextKind: string, nextLanguage = language) => {
    setLimit(8);
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
      <div className='mx-auto max-w-7xl space-y-5 px-4 pb-28 pt-6 md:px-8 md:pt-16'>
        <header className='relative overflow-hidden rounded-[28px] border border-white/70 bg-gradient-to-r from-sky-100 via-cyan-50 to-amber-100 p-5 dark:border-slate-700 dark:from-sky-950 dark:via-slate-900 dark:to-amber-950 md:p-7'>
          <div className='pointer-events-none absolute -right-5 -top-12 h-40 w-40 rounded-full border-[20px] border-white/35' />
          <p className='mb-2 flex items-center gap-2 text-sm font-semibold text-sky-700 dark:text-sky-300'>
            <Sparkles className='h-4 w-4' />
            今天想和谁一起冒险？
          </p>
          <h1 className='relative text-3xl font-black tracking-tight text-slate-800 dark:text-white md:text-4xl'>
            动画小天地
          </h1>
          <p className='mt-2 text-sm text-slate-600 dark:text-slate-300'>
            挑一张喜欢的海报，再选听得懂的语言。
          </p>
        </header>
        <section className='grid grid-cols-2 gap-3' aria-label='动画类型'>
          {[
            {
              kind: 'tv',
              name: '动画剧集',
              hint: '一集一集，认识新朋友',
              icon: Tv,
            },
            {
              kind: 'movie',
              name: '动画电影',
              hint: '一起看一场大冒险',
              icon: Film,
            },
          ].map((item) => (
            <button
              key={item.kind}
              aria-pressed={kind === item.kind}
              onClick={() => updateFilter(item.kind, 'all')}
              className={`flex min-h-[76px] items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all sm:p-4 ${
                kind === item.kind
                  ? 'border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-500/15 dark:border-sky-500'
                  : 'border-transparent bg-white/70 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <span
                className={`rounded-xl p-2 ${
                  kind === item.kind ? 'bg-white/20' : 'bg-sky-500/10'
                }`}
              >
                <item.icon className='h-6 w-6' />
              </span>
              <span>
                <strong className='block text-base sm:text-lg'>
                  {item.name}
                </strong>
                <span
                  className={`mt-1 hidden text-xs sm:block ${
                    kind === item.kind ? 'text-sky-50' : 'text-slate-400'
                  }`}
                >
                  {item.hint}
                </span>
              </span>
            </button>
          ))}
        </section>
        <div className='flex items-center gap-3 rounded-2xl border border-white/70 bg-white/75 px-4 shadow-sm dark:border-slate-700 dark:bg-slate-800'>
          <Search className='h-5 w-5 shrink-0 text-sky-500' />
          <input
            aria-label='搜索动画'
            value={query}
            onChange={(event) => {
              setLimit(8);
              setQuery(event.target.value);
            }}
            placeholder='找找喜欢的动画…'
            className='min-h-[52px] min-w-0 flex-1 bg-transparent text-base outline-none'
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
        <section
          aria-label='选择动画语言'
          className='flex items-center gap-2 overflow-x-auto pb-1'
        >
          <Languages className='h-4 w-4 shrink-0 text-slate-400' />
          <button
            aria-pressed={language === 'all'}
            onClick={() => updateFilter(kind, 'all')}
            className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold ${
              language === 'all'
                ? 'bg-amber-300 text-amber-950'
                : 'bg-white/70 text-slate-500 dark:bg-slate-800'
            }`}
          >
            所有语言
          </button>
          {availableLanguages.map(([code, label]) => (
            <button
              key={code}
              aria-pressed={language === code}
              onClick={() => updateFilter(kind, code)}
              className={`min-h-[40px] shrink-0 rounded-full px-4 text-sm font-semibold ${
                language === code
                  ? 'bg-amber-300 text-amber-950'
                  : 'bg-white/70 text-slate-500 dark:bg-slate-800'
              }`}
            >
              {label}
            </button>
          ))}
          {language !== 'all' &&
            !availableLanguages.some(([code]) => code === language) && (
              <span className='shrink-0 text-sm text-slate-400'>
                {busy ? '正在查找这个语言版本…' : '暂未找到这个语言版本'}
              </span>
            )}
        </section>
        <div className='flex gap-2 overflow-x-auto pb-1' aria-label='动画主题'>
          {themes.map((value) => (
            <button
              key={value}
              aria-pressed={theme === value}
              onClick={() => {
                setTheme(value);
                setLimit(8);
              }}
              className={`min-h-[36px] shrink-0 rounded-xl px-3 text-xs ${
                theme === value
                  ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900'
                  : 'text-slate-500 dark:text-slate-400'
              }`}
            >
              {value === '全部' ? '全部动画' : value}
            </button>
          ))}
        </div>
        <div className='flex items-center justify-between gap-3'>
          <h2 className='text-lg font-bold'>
            {query ? '找到的动画' : kind === 'tv' ? '动画朋友们' : '大电影时间'}
          </h2>
          <p role='status' className='text-xs text-slate-400'>
            {busy
              ? '正在找动画和语言版本…'
              : `${cards.filter((card) => card.variant).length} 个资源版本`}
          </p>
        </div>
        <section
          aria-label='动画海报'
          className='grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
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
                className='group min-w-0 rounded-2xl text-left outline-none focus-visible:ring-4 focus-visible:ring-sky-400/50'
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
        {matchingSeeds.length > limit && (
          <div className='text-center'>
            <button
              className='inline-flex min-h-[48px] items-center gap-2 rounded-full bg-white px-7 font-bold text-sky-700 shadow-sm dark:bg-slate-800 dark:text-sky-300'
              onClick={() => setLimit((value) => value + 8)}
            >
              再看更多动画
              <ChevronDown className='h-4 w-4' />
            </button>
          </div>
        )}
        {pageSeeds.some(
          (seed) =>
            pools[seed.id] &&
            pools[seed.id].status !== 'loading' &&
            !pools[seed.id].variants.length
        ) && (
          <details className='rounded-2xl border border-slate-200/60 p-4 text-sm text-slate-500 dark:border-slate-700'>
            <summary className='cursor-pointer'>再找找其他动画</summary>
            <p className='mt-3 text-xs'>
              这些动画暂时没有找到片源，可以点片名重新查找。
            </p>
            <div className='mt-3 flex flex-wrap gap-2'>
              {pageSeeds
                .filter(
                  (seed) =>
                    pools[seed.id] &&
                    pools[seed.id].status !== 'loading' &&
                    !pools[seed.id].variants.length
                )
                .map((seed) => (
                  <button
                    key={seed.id}
                    className='min-h-[44px] rounded-xl bg-white/70 px-3 text-xs dark:bg-slate-800'
                    onClick={() => {
                      retrySeed(seed.id);
                      setSelection({ seedId: seed.id });
                    }}
                  >
                    {seed.name}
                  </button>
                ))}
            </div>
          </details>
        )}
        <details className='rounded-2xl border border-slate-200/60 p-4 text-sm text-slate-500 dark:border-slate-700'>
          <summary className='cursor-pointer font-medium'>家长入口</summary>
          <p className='mt-3 text-xs leading-6'>
            语言来自播放源标注，未明确标注的版本显示“语言待确认”。片源可用性会变化，请陪孩子一起选片。
          </p>
          <div className='mt-3 flex flex-wrap gap-3 text-xs'>
            <a
              href='https://tv.cctv.com/cctv14/'
              target='_blank'
              rel='noreferrer'
              className='rounded-lg bg-white/60 px-3 py-2 dark:bg-slate-800'
            >
              央视少儿 ↗
            </a>
            <a
              href='https://pbskids.org/video/'
              target='_blank'
              rel='noreferrer'
              className='rounded-lg bg-white/60 px-3 py-2 dark:bg-slate-800'
            >
              PBS KIDS（部分地区可用）↗
            </a>
            <a
              href='https://en.khanacademy.org/kids'
              target='_blank'
              rel='noreferrer'
              className='rounded-lg bg-white/60 px-3 py-2 dark:bg-slate-800'
            >
              Khan Academy Kids（学习 App）↗
            </a>
          </div>
        </details>
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
        <div className='p-8 text-sm text-slate-500'>正在打开动画小天地…</div>
      }
    >
      <KidsPageClient />
    </Suspense>
  );
}
