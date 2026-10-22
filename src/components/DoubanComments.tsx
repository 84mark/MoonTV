'use client';

import { useEffect, useRef, useState } from 'react';

import type { DoubanCommentsResult } from '@/lib/douban-comments';
import { validDoubanId } from '@/lib/douban-comments';

export default function DoubanComments({
  title,
  year,
  doubanId,
  kind,
}: {
  title: string;
  year: string;
  doubanId: string;
  kind?: string;
}) {
  const [selection, setSelection] = useState('');
  const [result, setResult] = useState<DoubanCommentsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const identity = `${title}\0${year}\0${doubanId}\0${kind || ''}`;
  const previousIdentity = useRef(identity);
  const id = validDoubanId(selection)
    ? selection
    : validDoubanId(doubanId)
    ? doubanId
    : '';

  async function load(start: number, append = false) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setLoading(true);
    setError('');
    const params = new URLSearchParams({ title, start: String(start) });
    if (/^\d{4}$/.test(year)) params.set('year', year);
    const subjectId = append ? result?.subject?.id : id;
    if (subjectId) params.set('id', subjectId);
    const contentKind = result?.subject?.kind || kind;
    if (contentKind === 'tv' || contentKind === 'movie')
      params.set('kind', contentKind);
    try {
      const response = await fetch(`/api/douban/comments?${params}`, {
        signal: current.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? '登录已过期，请刷新后重新登录。'
            : '豆瓣短评暂时无法获取，可以重试或前往豆瓣查看。'
        );
      const data: DoubanCommentsResult = await response.json();
      if (current.signal.aborted) return;
      setResult((previous) =>
        append && previous
          ? {
              ...data,
              comments: [
                ...previous.comments,
                ...data.comments.filter(
                  (item) => !previous.comments.some((old) => old.id === item.id)
                ),
              ],
            }
          : data
      );
    } catch (cause) {
      if (!current.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : '短评加载失败，请稍后重试。'
        );
    } finally {
      if (!current.signal.aborted) setLoading(false);
    }
  }

  useEffect(() => {
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity;
      if (selection) {
        setSelection('');
        return;
      }
    }
    setResult(null);
    if (title || id) void load(0);
    return () => controller.current?.abort();
    // load is tied to these inputs; pagination is explicitly triggered below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, selection, retry]);

  const linkId = result?.subject?.id || id;
  const doubanUrl = linkId
    ? `https://movie.douban.com/subject/${linkId}/comments?status=P&sort=new_score`
    : `https://www.douban.com/search?q=${encodeURIComponent(title)}`;
  return (
    <section
      className='glass-panel comments-panel p-4 md:p-6'
      aria-label='豆瓣短评'
    >
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <h2 className='text-xl font-semibold'>豆瓣短评</h2>
        <a
          href={doubanUrl}
          target='_blank'
          rel='noopener noreferrer'
          className='text-sm text-blue-600 hover:underline'
        >
          去豆瓣查看 ↗
        </a>
      </div>
      {result?.subject && (
        <p className='mt-2 text-sm text-gray-500'>
          {result.subject.title}{' '}
          {result.subject.year && `（${result.subject.year}）`} · 热门短评 ·
          来自豆瓣，较长短评显示摘要
        </p>
      )}
      {!loading && result && !result.subject && (
        <div className='mt-4'>
          <p className='text-sm text-gray-500'>
            {result.candidates.length
              ? '请选择对应的影片，避免同名影片的短评混淆：'
              : '暂未找到匹配的豆瓣影片，可前往豆瓣搜索。'}
          </p>
          <div className='mt-3 flex flex-wrap gap-2'>
            {result.candidates.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelection(item.id)}
                className='rounded-lg border border-gray-300 px-3 py-2 text-sm hover:border-blue-500 dark:border-gray-600'
              >
                {item.title} {item.year && `（${item.year}）`}
              </button>
            ))}
          </div>
        </div>
      )}
      <ul className='mt-4 divide-y divide-gray-200 dark:divide-gray-700'>
        {result?.comments.map((item) => (
          <li key={item.id} className='py-4'>
            <div className='flex flex-wrap items-center gap-x-3 gap-y-1 text-sm'>
              <span className='font-medium'>{item.author}</span>
              {item.rating !== null && (
                <span
                  className='text-amber-500'
                  aria-label={`${item.rating}星`}
                >
                  {'★'.repeat(item.rating)}
                  {'☆'.repeat(5 - item.rating)}
                </span>
              )}
              <span className='text-gray-500'>{item.time}</span>
            </div>
            <p className='mt-2 whitespace-pre-line break-words text-sm leading-7'>
              {item.text}
            </p>
            <div className='mt-2 flex items-center justify-between text-xs text-gray-500'>
              <span>{item.votes} 人觉得有用</span>
              <a
                href={`https://movie.douban.com/subject/${result.subject?.id}/comments?comment_id=${item.id}`}
                target='_blank'
                rel='noopener noreferrer'
                className='hover:text-blue-600'
              >
                豆瓣原文 ↗
              </a>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <p role='status' className='mt-3 text-sm text-gray-500'>
          {error}{' '}
          <button
            onClick={() =>
              result?.subject
                ? void load(result.nextStart ?? 0, result.nextStart !== null)
                : setRetry((value) => value + 1)
            }
            className='text-blue-600 hover:underline'
          >
            重试
          </button>
        </p>
      )}
      {loading && (
        <p role='status' className='py-3 text-sm text-gray-500'>
          正在加载豆瓣短评…
        </p>
      )}
      {!loading &&
        !error &&
        result?.subject &&
        result.comments.length === 0 && (
          <p className='py-3 text-sm text-gray-500'>
            这部影片暂时没有可展示的短评。
          </p>
        )}
      {!loading &&
        !error &&
        result?.nextStart !== null &&
        result?.nextStart !== undefined && (
          <button
            onClick={() => void load(result.nextStart as number, true)}
            className='mt-2 rounded-lg border border-gray-300 px-4 py-2 text-sm hover:border-blue-500 dark:border-gray-600'
          >
            加载更多短评
          </button>
        )}
    </section>
  );
}
