/* eslint-disable @next/next/no-img-element */
'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import type { DoubanSubject } from '@/lib/douban-comments';
import { validDoubanId } from '@/lib/douban-comments';
import type { DoubanSubjectDetail } from '@/lib/douban-subject';
import { getBuiltinImageProxyUrl } from '@/lib/image-proxy';
import type { SearchResult } from '@/lib/types';
import { processImageUrl } from '@/lib/utils';

import DoubanComments from '@/components/DoubanComments';
import PageLayout from '@/components/PageLayout';

function DetailPageClient() {
  const searchParams = useSearchParams();
  const query = searchParams.toString();
  const title = searchParams.get('title') || '';
  const year = searchParams.get('year') || '';
  const [source, setSource] = useState<SearchResult | null>(null);
  const [subject, setSubject] = useState<DoubanSubjectDetail | null>(null);
  const [candidates, setCandidates] = useState<DoubanSubject[]>([]);
  const [chosenId, setChosenId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setChosenId('');
  }, [query]);
  useEffect(() => {
    const controller = new AbortController();
    setSubject(null);
    setSource(null);
    setCandidates([]);
    setError('');
    setLoading(true);
    async function load() {
      let fallback: SearchResult | null = null;
      const params = new URLSearchParams(query);
      const sourceId = params.get('id');
      const sourceKey = params.get('source');
      // Retain the selected source's synopsis when Douban is unavailable.
      if (sourceId && sourceKey) {
        try {
          const response = await fetch(
            `/api/detail?${new URLSearchParams({
              id: sourceId,
              source: sourceKey,
            })}`,
            { signal: controller.signal, cache: 'no-store' }
          );
          if (response.ok) {
            fallback = await response.json();
            if (!controller.signal.aborted) setSource(fallback);
          }
        } catch {
          /* Douban can still supply the details. */
        }
      }
      if (controller.signal.aborted) return;
      const supplied =
        chosenId ||
        params.get('douban_id') ||
        String(fallback?.douban_id || '');
      const request = new URLSearchParams({
        title: title || fallback?.title || '',
      });
      const releaseYear = year || fallback?.year || '';
      if (/^\d{4}$/.test(releaseYear)) request.set('year', releaseYear);
      if (validDoubanId(supplied)) request.set('id', supplied);
      try {
        const response = await fetch(`/api/douban/subject?${request}`, {
          signal: controller.signal,
        });
        if (!response.ok)
          throw new Error(
            response.status === 401
              ? '登录已过期，请刷新后重新登录。'
              : '豆瓣资料暂时无法获取，仍可直接播放。'
          );
        const data: {
          subject: DoubanSubjectDetail | null;
          candidates: DoubanSubject[];
        } = await response.json();
        if (!controller.signal.aborted) {
          setSubject(data.subject);
          setCandidates(data.candidates);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : '影片资料加载失败，仍可直接播放。'
          );
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [query, title, year, chosenId, retry]);

  const displayTitle = subject?.title || source?.title || title || '影片详情';
  const poster = subject?.poster
    ? getBuiltinImageProxyUrl(subject.poster) || ''
    : source?.poster
    ? getBuiltinImageProxyUrl(source.poster) || processImageUrl(source.poster)
    : searchParams.get('poster')
    ? getBuiltinImageProxyUrl(searchParams.get('poster') || '') ||
      processImageUrl(searchParams.get('poster') || '')
    : '';
  const intro = subject?.intro || source?.desc || '';
  // Forward every existing playback parameter, including source, prefer and search type.
  const playParams = new URLSearchParams(query);
  if (validDoubanId(chosenId)) playParams.set('douban_id', chosenId);
  else if (subject) playParams.set('douban_id', subject.id);
  const playbackLink = `/play?${playParams}`;

  return (
    <PageLayout activePath='/'>
      <div className='mx-auto max-w-6xl space-y-8 px-4 py-6 md:px-8 md:py-10'>
        <Link
          href='/'
          className='inline-flex text-sm text-gray-500 hover:text-green-600'
        >
          ← 返回浏览
        </Link>
        <section className='grid gap-6 md:grid-cols-[230px_1fr] md:gap-10'>
          <div className='mx-auto w-40 md:w-full'>
            {poster ? (
              <img
                key={poster}
                src={poster}
                alt={`${displayTitle}海报`}
                className='aspect-[2/3] w-full rounded-2xl bg-gray-100 object-cover shadow-lg dark:bg-gray-800'
                onError={(event) => {
                  event.currentTarget.style.visibility = 'hidden';
                }}
              />
            ) : (
              <div className='flex aspect-[2/3] items-center justify-center rounded-2xl bg-gray-100 text-gray-400 dark:bg-gray-800'>
                暂无海报
              </div>
            )}
          </div>
          <div className='min-w-0'>
            <p className='mb-2 text-xs font-semibold tracking-widest text-green-600'>
              影片详情
            </p>
            <h1 className='break-words text-3xl font-bold md:text-4xl'>
              {displayTitle}
            </h1>
            <p className='mt-3 text-sm text-gray-500'>
              {[
                subject?.year || source?.year || year,
                ...(subject?.genres || []),
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {subject && (
              <div className='mt-5 flex items-baseline gap-3'>
                <span className='text-3xl font-bold text-amber-500'>
                  {subject.rating !== null
                    ? subject.rating.toFixed(1)
                    : '暂无评分'}
                </span>
                <span className='text-sm text-gray-500'>
                  豆瓣评分
                  {subject.ratingCount > 0 &&
                    ` · ${subject.ratingCount.toLocaleString()} 人评价`}
                </span>
              </div>
            )}
            {subject?.directors.length ? (
              <p className='mt-4 text-sm leading-7 text-gray-600 dark:text-gray-300'>
                导演：{subject.directors.join(' / ')}
              </p>
            ) : null}
            {subject?.actors.length ? (
              <p className='mt-1 text-sm leading-7 text-gray-600 dark:text-gray-300'>
                主演：{subject.actors.join(' / ')}
              </p>
            ) : null}
            <Link
              href={playbackLink}
              className='mt-6 inline-flex items-center gap-2 rounded-xl bg-green-600 px-7 py-3 font-semibold text-white transition-colors hover:bg-green-700'
            >
              ▶ 立即播放
            </Link>
            <p className='mt-3 text-xs text-gray-500'>
              进入播放页后可选择剧集、切换片源。
            </p>
          </div>
        </section>
        <section>
          <h2 className='mb-4 text-xl font-semibold'>剧情简介</h2>
          {intro ? (
            <p className='whitespace-pre-line break-words text-sm leading-8 text-gray-600 dark:text-gray-300'>
              {intro}
            </p>
          ) : (
            <p className='text-sm text-gray-500'>
              {loading ? '正在加载影片资料…' : '暂无剧情简介，仍可进入播放。'}
            </p>
          )}
        </section>
        {error && (
          <p role='status' className='text-sm text-gray-500'>
            {error}{' '}
            <button
              onClick={() => setRetry((value) => value + 1)}
              className='text-green-600 hover:underline'
            >
              重试
            </button>
          </p>
        )}
        {!loading && !subject && (
          <section>
            <p className='text-sm text-gray-500'>
              {candidates.length
                ? '请选择对应的豆瓣影片，查看评分、剧照和短评：'
                : !error
                ? '未找到准确匹配的豆瓣影片。'
                : ''}
            </p>
            <div className='mt-3 flex flex-wrap gap-2'>
              {candidates.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setChosenId(item.id)}
                  className='rounded-lg border border-gray-300 px-3 py-2 text-sm hover:border-green-500 dark:border-gray-600'
                >
                  {item.title}（{item.year || '年份未知'}）
                </button>
              ))}
            </div>
          </section>
        )}
        {subject && (
          <section>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='text-xl font-semibold'>剧照</h2>
              <a
                href={`https://movie.douban.com/subject/${subject.id}/photos?type=S`}
                target='_blank'
                rel='noopener noreferrer'
                className='text-sm text-green-600 hover:underline'
              >
                豆瓣全部剧照 ↗
              </a>
            </div>
            {subject.photos.length ? (
              <div className='grid grid-cols-2 gap-3 md:grid-cols-3'>
                {subject.photos.map((photo, index) => (
                  <a
                    key={photo.id}
                    href={`https://movie.douban.com/photos/photo/${photo.id}/`}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    <img
                      src={getBuiltinImageProxyUrl(photo.url) || ''}
                      alt={`${displayTitle}剧照 ${index + 1}`}
                      loading='lazy'
                      className='aspect-video w-full rounded-xl bg-gray-100 object-cover dark:bg-gray-800'
                    />
                  </a>
                ))}
              </div>
            ) : (
              <p className='text-sm text-gray-500'>
                暂未获取到剧照，可前往豆瓣查看。
              </p>
            )}
          </section>
        )}
        {subject && (
          <DoubanComments
            title={subject.title}
            year={subject.year}
            doubanId={subject.id}
          />
        )}
      </div>
    </PageLayout>
  );
}
export default function DetailPage() {
  return (
    <Suspense
      fallback={<div className='p-8 text-gray-500'>正在加载影片详情…</div>}
    >
      <DetailPageClient />
    </Suspense>
  );
}
