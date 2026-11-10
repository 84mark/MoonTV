'use client';

import { ArrowUpRight, BookOpen, Search, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';

import {
  filterKidsTitles,
  KIDS_AGE_GROUPS,
  KIDS_TITLES,
  kidsAgeGroup,
  kidsDetailHref,
} from '@/lib/kids';

import PageLayout from '@/components/PageLayout';

const colors = [
  'from-amber-100 to-orange-50 dark:from-amber-950/60 dark:to-orange-950/30',
  'from-sky-100 to-cyan-50 dark:from-sky-950/60 dark:to-cyan-950/30',
  'from-emerald-100 to-lime-50 dark:from-emerald-950/60 dark:to-lime-950/30',
  'from-violet-100 to-pink-50 dark:from-violet-950/60 dark:to-pink-950/30',
];
function KidsPageClient() {
  const params = useSearchParams();
  const router = useRouter();
  const age = kidsAgeGroup(params.get('age'));
  const [theme, setTheme] = useState('全部');
  const [query, setQuery] = useState('');
  const group =
    KIDS_AGE_GROUPS.find((item) => item.id === age) || KIDS_AGE_GROUPS[0];
  const themes = [
    '全部',
    ...Array.from(
      new Set(
        KIDS_TITLES.filter((item) => item.age === age).map((item) => item.theme)
      )
    ),
  ];
  const items = filterKidsTitles(age, theme, query);
  return (
    <PageLayout activePath='/kids'>
      <div className='mx-auto max-w-7xl space-y-7 px-4 py-8 md:px-8 md:pt-16'>
        <header className='glass-panel relative overflow-hidden rounded-3xl p-6 md:p-9'>
          <div className='pointer-events-none absolute -right-8 -top-12 h-48 w-48 rounded-full bg-amber-200/30 blur-2xl' />
          <p className='mb-3 flex items-center gap-2 text-xs font-semibold tracking-widest text-amber-600'>
            <Sparkles className='h-4 w-4' /> LITTLE DISCOVERIES
          </p>
          <h1 className='text-3xl font-bold md:text-4xl'>少儿频道</h1>
          <p className='mt-3 max-w-xl text-sm leading-7 text-gray-600 dark:text-gray-300'>
            陪孩子一起，从一个好故事开始探索。按年龄与主题挑选适合共看的内容。
          </p>
          <p className='mt-3 text-xs leading-6 text-gray-500'>
            适龄片单，播放来自当前站点可用片源。年龄为选片参考，非官方分级，请家长结合实际内容确认。
          </p>
        </header>
        <section
          aria-label='选择年龄段'
          className='grid grid-cols-3 gap-2 md:gap-4'
        >
          {KIDS_AGE_GROUPS.map((option) => (
            <button
              key={option.id}
              aria-pressed={age === option.id}
              onClick={() => {
                setTheme('全部');
                setQuery('');
                router.replace(`/kids?age=${option.id}`, { scroll: false });
              }}
              className={`rounded-2xl border p-3 text-left transition-colors md:p-5 ${
                age === option.id
                  ? 'border-amber-400 bg-amber-400/10'
                  : 'border-gray-200 bg-white/40 dark:border-gray-700 dark:bg-gray-800/30'
              }`}
            >
              <span className='block text-base font-bold md:text-xl'>
                {option.label}
              </span>
              <span className='mt-1 block text-xs text-gray-500 md:text-sm'>
                {option.title}
              </span>
            </button>
          ))}
        </section>
        <section aria-label='适龄片单' className='space-y-5'>
          <div className='flex flex-wrap items-end justify-between gap-4'>
            <div>
              <h2 className='text-xl font-bold'>{group.title}</h2>
              <p className='mt-2 text-sm text-gray-500'>{group.description}</p>
            </div>
            <label className='flex w-full items-center gap-2 rounded-xl border border-gray-300 bg-white/30 px-3 sm:w-72 dark:border-gray-700 dark:bg-gray-800/30'>
              <Search className='h-4 w-4 text-gray-400' />
              <input
                aria-label='搜索少儿片单'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='搜索片名或主题'
                className='min-w-0 flex-1 bg-transparent py-3 text-sm outline-none'
              />
            </label>
          </div>
          <div className='flex flex-wrap gap-2'>
            {themes.map((value) => (
              <button
                key={value}
                aria-pressed={theme === value}
                onClick={() => setTheme(value)}
                className={`min-h-[38px] rounded-full px-4 text-xs ${
                  theme === value
                    ? 'bg-amber-500 text-white'
                    : 'bg-gray-500/5 text-gray-500'
                }`}
              >
                {value}
              </button>
            ))}
          </div>
          <p className='text-xs text-gray-500'>
            {items.length} 部精选 · 点击查看详情与可用片源
          </p>
          <div className='grid gap-4 sm:grid-cols-2 xl:grid-cols-4'>
            {items.map((item, index) => (
              <Link
                key={item.id}
                href={kidsDetailHref(item, age)}
                aria-label={`查看 ${item.name} 的少儿片单详情`}
                className='glass-panel group overflow-hidden rounded-2xl border border-transparent transition-colors hover:border-amber-400 focus-visible:outline-amber-500'
              >
                <div
                  className={`flex h-32 items-center justify-between bg-gradient-to-br px-5 ${
                    colors[index % colors.length]
                  }`}
                >
                  <span className='text-5xl' aria-hidden='true'>
                    {item.symbol}
                  </span>
                  <span className='self-start rounded-full bg-white/65 px-3 py-1 text-xs text-gray-700 dark:bg-gray-900/45 dark:text-gray-200'>
                    {item.kind === 'movie' ? '电影' : '系列'}
                  </span>
                </div>
                <div className='p-5'>
                  <p className='mb-2 text-xs text-amber-700 dark:text-amber-400'>
                    {group.label} · {item.theme}
                  </p>
                  <h3 className='text-base font-semibold leading-6 group-hover:text-amber-600'>
                    {item.name}
                  </h3>
                  <p className='mt-3 text-xs leading-6 text-gray-500'>
                    {item.description}
                  </p>
                  <span className='mt-4 inline-flex items-center gap-1 text-xs font-medium text-blue-600'>
                    查看详情 <ArrowUpRight className='h-3 w-3' />
                  </span>
                </div>
              </Link>
            ))}
          </div>
          {!items.length && (
            <div className='glass-panel rounded-2xl px-6 py-12 text-center text-sm text-gray-500'>
              当前年龄段没有匹配内容，试试其他主题或关键词。
            </div>
          )}
        </section>
        <section
          className='glass-panel rounded-2xl p-6'
          aria-label='官方免费内容'
        >
          <h2 className='flex items-center gap-2 text-lg font-semibold'>
            <BookOpen className='h-5 w-5 text-emerald-600' />
            官方免费内容
          </h2>
          <p className='mt-2 text-xs leading-6 text-gray-500'>
            以下入口前往内容提供方官网观看，和站内影视片源分开提供。
          </p>
          <div className='mt-4 grid gap-3 md:grid-cols-3'>
            <a
              href='https://tv.cctv.com/cctv14/'
              target='_blank'
              rel='noreferrer'
              className='rounded-xl bg-gray-500/5 p-4'
            >
              <h3 className='text-sm font-semibold'>央视少儿 ↗</h3>
              <p className='mt-2 text-xs leading-6 text-gray-500'>
                中文少儿节目与动画，前往央视官网选择内容。
              </p>
            </a>
            <a
              href='https://pbskids.org/video/'
              target='_blank'
              rel='noreferrer'
              className='rounded-xl bg-gray-500/5 p-4'
            >
              <h3 className='text-sm font-semibold'>PBS KIDS 视频 ↗</h3>
              <p className='mt-2 text-xs leading-6 text-gray-500'>
                英语儿童节目；部分内容可能受地区限制。
              </p>
            </a>
            <a
              href='https://en.khanacademy.org/kids'
              target='_blank'
              rel='noreferrer'
              className='rounded-xl bg-gray-500/5 p-4'
            >
              <h3 className='text-sm font-semibold'>Khan Academy Kids ↗</h3>
              <p className='mt-2 text-xs leading-6 text-gray-500'>
                面向 2–8 岁的免费学习 App，非站内视频。
              </p>
            </a>
          </div>
        </section>
      </div>
    </PageLayout>
  );
}
export default function KidsPage() {
  return (
    <Suspense
      fallback={
        <div className='p-8 text-sm text-gray-500'>正在加载少儿频道…</div>
      }
    >
      <KidsPageClient />
    </Suspense>
  );
}
