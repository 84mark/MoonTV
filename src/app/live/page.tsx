'use client';

import { Heart, Radio, Search } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import {
  LIVE_STORAGE_KEY,
  LivePreferences,
  mergeLiveChannels,
  parseLiveM3u,
  readLivePreferences,
  seededLiveChannels,
} from '@/lib/live';

import LivePlayer from '@/components/LivePlayer';
import PageLayout from '@/components/PageLayout';

const initialPreferences: LivePreferences = {
  favorites: [],
  recent: [],
  customM3u: '',
};
function LivePageClient() {
  const [builtin, setBuiltin] = useState(seededLiveChannels);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部');
  const [selectedId, setSelectedId] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState(false);
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setUpdating(true);
    try {
      const response = await fetch('/api/live', { cache: 'no-store', signal });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? '登录已过期，请重新登录。'
            : '频道更新失败，继续使用内置列表。'
        );
      const data = await response.json();
      if (!signal?.aborted) {
        setBuiltin(data.channels);
        setNotice(
          data.fallback
            ? '部分订阅暂时不可用，已使用内置频道列表。'
            : '频道列表已更新，播放可用性以实际连接为准。'
        );
      }
    } catch (error) {
      if (!signal?.aborted)
        setNotice(
          error instanceof Error
            ? error.message
            : '频道更新失败，可继续使用内置频道。'
        );
    } finally {
      if (!signal?.aborted) setUpdating(false);
    }
  }, []);
  useEffect(() => {
    setPreferences(readLivePreferences());
    setReady(true);
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(LIVE_STORAGE_KEY, JSON.stringify(preferences));
    } catch {
      setNotice('浏览器无法保存设置，本次仍可正常观看。');
    }
  }, [preferences, ready]);
  const channels = useMemo(
    () =>
      mergeLiveChannels([...builtin, ...parseLiveM3u(preferences.customM3u)]),
    [builtin, preferences.customM3u]
  );
  const selected = channels.find((c) => c.id === selectedId);
  const categories = [
    '全部',
    '收藏',
    '最近观看',
    ...Array.from(new Set(channels.map((c) => c.category))),
  ];
  const filtered = channels
    .filter((c) => {
      const match =
        category === '全部' ||
        (category === '收藏'
          ? preferences.favorites.includes(c.id)
          : category === '最近观看'
          ? preferences.recent.includes(c.id)
          : c.category === category);
      return (
        match &&
        `${c.name} ${c.id}`.toLowerCase().includes(query.trim().toLowerCase())
      );
    })
    .sort((a, b) =>
      category === '最近观看'
        ? preferences.recent.indexOf(a.id) - preferences.recent.indexOf(b.id)
        : 0
    );
  const choose = (id: string) => {
    setSelectedId(id);
    setPreferences((p) => ({
      ...p,
      recent: [id, ...p.recent.filter((v) => v !== id)].slice(0, 20),
    }));
  };
  const favorite = (id: string) =>
    setPreferences((p) => ({
      ...p,
      favorites: p.favorites.includes(id)
        ? p.favorites.filter((v) => v !== id)
        : [...p.favorites, id],
    }));
  return (
    <PageLayout activePath='/live'>
      <div className='mx-auto max-w-7xl space-y-6 px-4 py-8 md:px-8 md:pt-16'>
        <header className='flex flex-wrap items-center justify-between gap-4'>
          <div>
            <p className='mb-2 text-xs font-semibold tracking-widest text-green-600'>
              LIVE TELEVISION
            </p>
            <h1 className='text-3xl font-bold'>电视直播</h1>
            <p className='mt-2 text-sm text-gray-500'>
              看正在发生的故事 · {channels.length} 个频道
            </p>
          </div>
          <div className='flex gap-2'>
            <button
              onClick={() => void refresh()}
              disabled={updating}
              className='rounded-xl border border-gray-300 px-4 py-2 text-sm disabled:opacity-50 dark:border-gray-700'
            >
              {updating ? '更新中…' : '更新频道'}
            </button>
            <button
              onClick={() => {
                setDraft(preferences.customM3u);
                setShowImport(!showImport);
              }}
              className='rounded-xl bg-blue-600 px-4 py-2 text-sm text-white'
            >
              导入频道
            </button>
          </div>
        </header>
        {notice && (
          <p role='status' className='text-xs text-gray-500'>
            {notice}
          </p>
        )}
        {showImport && (
          <section className='glass-panel space-y-3 p-5'>
            <h2 className='font-semibold'>自定义 M3U 频道</h2>
            <p className='text-sm text-gray-500'>
              粘贴完整的 M3U 内容，仅导入 HTTPS
              线路。保存在当前浏览器，可随时替换或清除。
            </p>
            <textarea
              aria-label='M3U 内容'
              value={draft}
              maxLength={200000}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              placeholder={
                '#EXTM3U\n#EXTINF:-1 tvg-id="my-channel",我的频道\nhttps://example.com/live.m3u8'
              }
              className='w-full rounded-xl border border-gray-300 bg-transparent p-3 font-mono text-xs dark:border-gray-700'
            />
            <div className='flex gap-3'>
              <button
                className='rounded-lg bg-blue-600 px-4 py-2 text-sm text-white'
                onClick={() => {
                  const parsed = parseLiveM3u(draft);
                  if (!parsed.length) {
                    setNotice('未找到有效的 HTTPS 频道，请检查 M3U 内容。');
                    return;
                  }
                  setPreferences((p) => ({ ...p, customM3u: draft }));
                  setCategory('自定义');
                  setShowImport(false);
                  setNotice(`已导入 ${parsed.length} 个频道。`);
                }}
              >
                保存频道
              </button>
              <button
                onClick={() => {
                  setPreferences((p) => ({ ...p, customM3u: '' }));
                  setDraft('');
                  setSelectedId('');
                  setCategory('全部');
                  setShowImport(false);
                }}
              >
                清除自定义频道
              </button>
            </div>
          </section>
        )}
        <div className='grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]'>
          <div className='space-y-4 lg:sticky lg:top-6'>
            {selected ? (
              <LivePlayer key={selected.id} channel={selected} />
            ) : (
              <div className='glass-panel flex aspect-video flex-col items-center justify-center rounded-2xl px-6 text-center'>
                <Radio className='mb-5 h-12 w-12 text-green-500' />
                <h2 className='text-xl font-semibold'>选择频道，开始观看</h2>
                <p className='mt-3 text-sm text-gray-500'>
                  浏览下方频道，或搜索频道名称。
                </p>
              </div>
            )}
            {selected && (
              <button
                aria-pressed={preferences.favorites.includes(selected.id)}
                onClick={() => favorite(selected.id)}
                className='flex min-h-[44px] items-center gap-2 text-sm'
              >
                <Heart
                  className={`h-4 w-4 ${
                    preferences.favorites.includes(selected.id)
                      ? 'fill-red-500 text-red-500'
                      : ''
                  }`}
                />
                {preferences.favorites.includes(selected.id)
                  ? '已收藏此频道'
                  : '收藏此频道'}
              </button>
            )}
            <p className='text-xs leading-6 text-gray-500'>
              频道列表来自 iptv-org 公开订阅，仅收录 HTTPS
              线路。部分频道有地区或网络限制；连接失败会尝试备用线路。
              <a
                href='https://github.com/iptv-org/iptv'
                target='_blank'
                rel='noreferrer'
                className='ml-1 text-blue-600'
              >
                查看来源 ↗
              </a>
            </p>
          </div>
          <section
            className='glass-panel min-w-0 rounded-2xl p-4'
            aria-label='频道列表'
          >
            <label className='flex items-center gap-2 rounded-xl border border-gray-300 px-3 dark:border-gray-700'>
              <Search className='h-4 w-4 text-gray-400' />
              <input
                aria-label='搜索频道'
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder='搜索频道，如 CCTV、湖南'
                className='min-w-0 flex-1 bg-transparent py-3 text-sm outline-none'
              />
            </label>
            <div className='my-4 flex flex-wrap gap-2'>
              {categories.map((value) => (
                <button
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={`min-h-[36px] rounded-lg px-3 text-xs ${
                    category === value
                      ? 'bg-green-500/15 font-semibold text-green-700 dark:text-green-400'
                      : 'bg-gray-500/5 text-gray-500'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className='mb-3 text-xs text-gray-500'>
              {filtered.length} 个频道
            </p>
            <div className='max-h-[65vh] space-y-2 overflow-y-auto pr-1'>
              {filtered.map((channel) => (
                <div
                  key={channel.id}
                  className={`flex items-center gap-2 rounded-xl border p-2 ${
                    channel.id === selectedId
                      ? 'border-green-500 bg-green-500/10'
                      : 'border-transparent bg-gray-500/5'
                  }`}
                >
                  <button
                    aria-label={`播放 ${channel.name}`}
                    aria-pressed={channel.id === selectedId}
                    onClick={() => choose(channel.id)}
                    className='min-h-[44px] min-w-0 flex-1 text-left'
                  >
                    <span className='block truncate text-sm font-medium'>
                      {channel.name}
                    </span>
                    <span className='mt-1 block text-xs text-gray-500'>
                      {channel.category} · {channel.urls.length} 条线路
                    </span>
                  </button>
                  <button
                    aria-label={`${
                      preferences.favorites.includes(channel.id)
                        ? '取消收藏'
                        : '收藏'
                    } ${channel.name}`}
                    aria-pressed={preferences.favorites.includes(channel.id)}
                    onClick={() => favorite(channel.id)}
                    className='flex h-11 w-11 shrink-0 items-center justify-center rounded-lg'
                  >
                    <Heart
                      className={`h-4 w-4 ${
                        preferences.favorites.includes(channel.id)
                          ? 'fill-red-500 text-red-500'
                          : 'text-gray-400'
                      }`}
                    />
                  </button>
                </div>
              ))}
              {!filtered.length && (
                <p className='py-10 text-center text-sm text-gray-500'>
                  {category === '收藏'
                    ? '还没有收藏频道，点击爱心即可收藏。'
                    : category === '最近观看'
                    ? '选择一个频道后会出现在这里。'
                    : '没有匹配的频道，试试其他分类或搜索词。'}
                </p>
              )}
            </div>
          </section>
        </div>
      </div>
    </PageLayout>
  );
}

export default function LivePage() {
  return (
    <Suspense
      fallback={
        <div className='p-8 text-sm text-gray-500'>正在加载电视直播…</div>
      }
    >
      <LivePageClient />
    </Suspense>
  );
}
