import { ExternalLink, Radio, Satellite } from 'lucide-react';
import Link from 'next/link';
import { Suspense } from 'react';

import PageLayout from '@/components/PageLayout';

import channels from './channels.json';

export default function DomesticLivePage() {
  return (
    <Suspense>
      <PageLayout activePath='/domestic-live'>
        <div className='mx-auto max-w-7xl space-y-8 px-4 pb-28 pt-6 sm:px-7 md:pt-20'>
          <header className='flex flex-wrap items-center justify-between gap-4'>
            <div>
              <h1 className='text-3xl font-semibold'>国内直播</h1>
              <p className='mt-2 text-sm text-slate-600 dark:text-slate-300'>
                选择频道，在新标签页打开直播入口。
              </p>
            </div>
            <Link
              href='/live'
              className='text-sm text-blue-700 dark:text-blue-300'
            >
              返回电视
            </Link>
          </header>
          {channels.map(({ title, items }, index) => {
            const Icon = index === 0 ? Radio : Satellite;
            return (
              <section key={title} aria-labelledby={`channel-group-${index}`}>
                <h2
                  id={`channel-group-${index}`}
                  className='mb-4 text-lg font-semibold'
                >
                  {title}
                </h2>
                <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5'>
                  {items.map(({ name, url, directory }) => (
                    <li key={name} className='min-w-0'>
                      <a
                        href={url}
                        target='_blank'
                        rel='noopener noreferrer'
                        className='glass-panel group flex h-full min-h-[76px] items-center gap-3 rounded-xl p-3 hover:ring-1 hover:ring-blue-400'
                      >
                        <span className='shrink-0 rounded-lg bg-blue-500/10 p-2 text-blue-700 dark:text-blue-300'>
                          <Icon size={18} aria-hidden='true' />
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span className='block text-sm font-medium'>
                            {name}
                          </span>
                          <span className='mt-1 block text-xs text-slate-600 dark:text-slate-300'>
                            {directory ? '频道导航' : '直播入口'}
                          </span>
                        </span>
                        <ExternalLink
                          size={13}
                          aria-label='在新标签打开'
                          className='hidden shrink-0 opacity-60 sm:block'
                        />
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </PageLayout>
    </Suspense>
  );
}
