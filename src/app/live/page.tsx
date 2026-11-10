'use client';

import {
  ArrowUpRight,
  CheckCircle2,
  Globe2,
  Heart,
  History,
  ListVideo,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Search,
  Tv,
  X,
} from 'lucide-react';
import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  LIVE_STORAGE_KEY,
  LiveChannel,
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
  const [library, setLibrary] = useState('全部频道');
  const [updatedAt, setUpdatedAt] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
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
        if (!Array.isArray(data.channels))
          throw new Error('频道目录暂时不可用');
        setBuiltin(data.channels);
        setUpdatedAt(Number(data.updatedAt) || 0);
        setNotice(
          data.fallback
            ? '目录暂未更新，继续显示本地频道候选。'
            : '频道目录已更新。'
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
    '国际频道',
    '高清卫视',
    ...(channels.some((channel) => channel.category === '自定义')
      ? ['自定义']
      : []),
  ];
  const filtered = channels
    .filter((channel) => {
      const inCategory =
        category === '全部' ||
        (category === '国际频道'
          ? channel.id.startsWith('world:')
          : category === '高清卫视'
          ? /卫视/.test(channel.category)
          : channel.category === category);
      const inLibrary =
        library === '全部频道' ||
        (library === '收藏'
          ? preferences.favorites.includes(channel.id)
          : preferences.recent.includes(channel.id));
      return (
        inCategory &&
        inLibrary &&
        `${channel.name} ${channel.id} ${channel.category} ${
          channel.language || ''
        }`
          .toLowerCase()
          .includes(query.trim().toLowerCase())
      );
    })
    .sort((a, b) =>
      library === '最近观看'
        ? preferences.recent.indexOf(a.id) - preferences.recent.indexOf(b.id)
        : 0
    );
  const choose = (id: string) => {
    setSelectedId(id);
    setPreferences((p) => ({
      ...p,
      recent: [id, ...p.recent.filter((v) => v !== id)].slice(0, 20),
    }));
    if (window.matchMedia?.('(max-width: 1023px)').matches)
      stage.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
      <div className='mx-auto max-w-[1500px] space-y-5 px-4 pb-28 pt-6 md:px-8 md:pt-16'>
        <header className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <span className='flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/10 text-sky-600 dark:text-sky-400'>
              <Radio className='h-6 w-6' />
            </span>
            <div>
              <h1 className='text-2xl font-bold tracking-tight md:text-3xl'>
                电视直播
              </h1>
              <p className='mt-1 text-xs text-slate-400'>换个频道，发现世界</p>
            </div>
          </div>
          <div className='flex items-center gap-1 rounded-xl bg-white/50 p-1 dark:bg-slate-800/60'>
            <button
              onClick={() => void refresh()}
              disabled={updating}
              className='flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-white/80 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-700'
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${updating ? 'animate-spin' : ''}`}
              />
              {updating ? '更新中' : '更新频道'}
            </button>
            <button
              onClick={() => {
                setDraft(preferences.customM3u);
                setShowImport((value) => !value);
              }}
              className='flex min-h-[40px] items-center gap-2 rounded-lg px-3 text-xs font-medium text-slate-500 transition-colors hover:bg-white/80 dark:text-slate-300 dark:hover:bg-slate-700'
            >
              <Plus className='h-4 w-4' />
              导入频道
            </button>
          </div>
        </header>
        {showImport && (
          <section
            className='glass-panel space-y-3 rounded-2xl p-4 md:p-5'
            aria-label='导入频道'
          >
            <div className='flex items-center justify-between gap-3'>
              <h2 className='font-semibold'>导入自己的 M3U 频道</h2>
              <button
                aria-label='关闭频道导入'
                onClick={() => setShowImport(false)}
                className='flex h-11 w-11 items-center justify-center rounded-full hover:bg-slate-500/10'
              >
                <X className='h-4 w-4' />
              </button>
            </div>
            <p className='text-xs leading-6 text-slate-500'>
              粘贴完整 M3U 内容。仅导入 HTTPS 线路，保存在当前浏览器。
            </p>
            <textarea
              aria-label='M3U 内容'
              value={draft}
              maxLength={200000}
              onChange={(event) => setDraft(event.target.value)}
              rows={5}
              placeholder={
                '#EXTM3U\n#EXTINF:-1,我的频道\nhttps://example.com/live.m3u8'
              }
              className='w-full rounded-xl border border-slate-300 bg-transparent p-3 font-mono text-xs outline-none focus:border-sky-400 dark:border-slate-700'
            />
            <div className='flex flex-wrap gap-2'>
              <button
                className='min-h-[44px] rounded-xl bg-sky-600 px-5 text-sm font-semibold text-white'
                onClick={() => {
                  const parsed = parseLiveM3u(draft);
                  if (!parsed.length) {
                    setNotice('未找到有效的 HTTPS 频道，请检查 M3U 内容。');
                    return;
                  }
                  setPreferences((value) => ({ ...value, customM3u: draft }));
                  setCategory('自定义');
                  setLibrary('全部频道');
                  setShowImport(false);
                  setNotice(`已导入 ${parsed.length} 个频道。`);
                }}
              >
                保存频道
              </button>
              <button
                className='min-h-[44px] rounded-xl px-4 text-sm text-slate-500 hover:bg-slate-500/5'
                onClick={() => {
                  setPreferences((value) => ({ ...value, customM3u: '' }));
                  setDraft('');
                  setSelectedId('');
                  setCategory('全部');
                  setLibrary('全部频道');
                  setShowImport(false);
                }}
              >
                清除自定义频道
              </button>
            </div>
          </section>
        )}
        <div className='grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_390px]'>
          <div
            ref={stage}
            className='min-w-0 scroll-mt-5 space-y-4 xl:sticky xl:top-5'
          >
            {selected ? (
              <LivePlayer key={selected.id} channel={selected} />
            ) : (
              <section
                className='relative overflow-hidden rounded-3xl border border-white/10 bg-[#10192b] text-white shadow-xl shadow-slate-900/10'
                aria-label='直播播放区'
              >
                <div className='pointer-events-none absolute -right-12 -top-12 h-64 w-64 rounded-full bg-sky-500/15 blur-3xl' />
                <div className='pointer-events-none absolute -bottom-24 -left-12 h-64 w-64 rounded-full bg-violet-500/10 blur-3xl' />
                <div className='relative flex aspect-video flex-col items-center justify-center gap-3 px-5 text-center md:gap-5'>
                  <span className='flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 md:h-16 md:w-16'>
                    <Tv
                      className='h-6 w-6 text-sky-300 md:h-8 md:w-8'
                      strokeWidth={1.4}
                    />
                  </span>
                  <div>
                    <h2 className='text-lg font-semibold md:text-2xl'>
                      从一个好频道开始
                    </h2>
                    <p className='mt-2 text-xs text-slate-400 md:text-sm'>
                      新闻、文化与探索，选择频道即可连接
                    </p>
                  </div>
                  <div className='flex flex-wrap justify-center gap-2'>
                    {channels
                      .filter((channel) => channel.id.startsWith('world:'))
                      .slice(0, 2)
                      .map((channel) => (
                        <button
                          key={channel.id}
                          aria-label={`快速选择 ${channel.name}`}
                          onClick={() => choose(channel.id)}
                          className='inline-flex min-h-[40px] items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 text-xs font-medium text-slate-200 transition-colors hover:bg-white/15 md:px-4'
                        >
                          <Play className='h-3 w-3 fill-current' />
                          {channel.name}
                          <span className='text-[10px] text-slate-400'>
                            {channel.urls.length} 个源
                          </span>
                        </button>
                      ))}
                  </div>
                </div>
              </section>
            )}
            {selected ? (
              <section className='flex flex-wrap items-start justify-between gap-3 px-1'>
                <div className='min-w-0'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <h2 className='text-lg font-bold'>{selected.name}</h2>
                    <SourceBadge count={selected.urls.length} />
                  </div>
                  <p className='mt-1 text-xs text-slate-500'>
                    {[selected.category, selected.language, selected.quality]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                  <div className='mt-2 flex flex-wrap items-center gap-3'>
                    <Verification channel={selected} />
                    {safeWebsite(selected.website) && (
                      <a
                        href={safeWebsite(selected.website)}
                        target='_blank'
                        rel='noreferrer'
                        className='inline-flex min-h-[32px] items-center gap-1 text-xs font-medium text-sky-600 dark:text-sky-400'
                      >
                        频道官网
                        <ArrowUpRight className='h-3 w-3' />
                      </a>
                    )}
                  </div>
                </div>
                <button
                  aria-pressed={preferences.favorites.includes(selected.id)}
                  onClick={() => favorite(selected.id)}
                  className={`flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-sm font-medium ${
                    preferences.favorites.includes(selected.id)
                      ? 'bg-rose-500/10 text-rose-500'
                      : 'bg-slate-500/5 text-slate-500'
                  }`}
                >
                  <Heart
                    className={`h-4 w-4 ${
                      preferences.favorites.includes(selected.id)
                        ? 'fill-current'
                        : ''
                    }`}
                  />
                  {preferences.favorites.includes(selected.id)
                    ? '已收藏此频道'
                    : '收藏此频道'}
                </button>
              </section>
            ) : (
              <div className='flex flex-wrap items-center gap-x-5 gap-y-2 px-1 text-xs text-slate-400'>
                <span className='inline-flex items-center gap-1.5'>
                  <Globe2 className='h-3.5 w-3.5' />
                  国际官方频道候选
                </span>
                <span className='inline-flex items-center gap-1.5'>
                  <Tv className='h-3.5 w-3.5' />
                  高清卫视候选
                </span>
                <span>{channels.length} 个频道可选</span>
              </div>
            )}
            <details className='rounded-2xl border border-slate-200/60 bg-white/30 px-4 py-3 text-xs text-slate-500 dark:border-slate-700 dark:bg-slate-800/30'>
              <summary className='cursor-pointer font-medium'>
                频道说明与官方入口
              </summary>
              <p className='mt-3 leading-6'>
                频道来自官方页面候选及公开目录。标称画质以实际播放为准；候选不代表已经逐台实测，播放还可能受地区及源站状态影响。
              </p>
              <div className='mt-3 flex flex-wrap gap-2'>
                <a
                  href='https://plus.nasa.gov/'
                  target='_blank'
                  rel='noreferrer'
                  className='inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-white/60 px-3 font-medium dark:bg-slate-700'
                >
                  NASA+ 官方平台
                  <ArrowUpRight className='h-3 w-3' />
                </a>
                <a
                  href='https://www.arte.tv/fr/direct/'
                  target='_blank'
                  rel='noreferrer'
                  className='inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-white/60 px-3 font-medium dark:bg-slate-700'
                >
                  ARTE 官方直播
                  <ArrowUpRight className='h-3 w-3' />
                </a>
              </div>
              <p className='mt-2 text-[11px] text-slate-400'>
                以上官方链接在新窗口打开，不作为本站已验证播放源。
              </p>
            </details>
          </div>
          <section
            className='min-w-0 rounded-3xl border border-white/70 bg-white/60 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/60 md:p-4'
            aria-label='频道列表'
          >
            <div className='mb-4 flex items-center justify-between gap-3 px-1'>
              <h2 className='flex items-center gap-2 font-semibold'>
                <ListVideo className='h-4 w-4 text-sky-500' />
                选择频道
              </h2>
              <span className='text-[10px] text-slate-400'>
                {updatedAt
                  ? `目录 ${new Intl.DateTimeFormat('zh-CN', {
                      timeZone: 'Asia/Shanghai',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(updatedAt)}`
                  : '候选目录'}
              </span>
            </div>
            <label className='flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/70 px-3 dark:border-slate-700 dark:bg-slate-800'>
              <Search className='h-4 w-4 shrink-0 text-slate-400' />
              <input
                aria-label='搜索频道'
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder='搜索频道或语言'
                className='min-h-[44px] min-w-0 flex-1 bg-transparent text-sm outline-none'
              />
              {query && (
                <button
                  aria-label='清除频道搜索'
                  onClick={() => setQuery('')}
                  className='p-1'
                >
                  <X className='h-3.5 w-3.5' />
                </button>
              )}
            </label>
            <div className='mt-3 flex gap-1 overflow-x-auto rounded-xl bg-slate-100/80 p-1 dark:bg-slate-800'>
              {categories.map((value) => (
                <button
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={`min-h-[38px] flex-1 shrink-0 whitespace-nowrap rounded-lg px-3 text-xs font-semibold transition-colors ${
                    category === value
                      ? 'bg-white text-sky-700 shadow-sm dark:bg-slate-700 dark:text-sky-300'
                      : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                  }`}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className='my-3 flex items-center justify-between gap-2 px-1'>
              <div className='flex items-center gap-3'>
                {[
                  { label: '全部频道', icon: Radio },
                  { label: '收藏', icon: Heart },
                  { label: '最近观看', icon: History },
                ].map((item) => (
                  <button
                    key={item.label}
                    aria-pressed={library === item.label}
                    onClick={() => setLibrary(item.label)}
                    className={`inline-flex min-h-[36px] items-center gap-1 text-[11px] font-medium ${
                      library === item.label
                        ? 'text-sky-600 dark:text-sky-400'
                        : 'text-slate-400'
                    }`}
                  >
                    <item.icon className='h-3 w-3' />
                    {item.label}
                  </button>
                ))}
              </div>
              <span className='shrink-0 text-[11px] text-slate-400'>
                {filtered.length} 台
              </span>
            </div>
            {notice && (
              <p
                role='status'
                className='mb-3 rounded-lg bg-sky-500/5 px-3 py-2 text-[11px] leading-5 text-slate-400'
              >
                {notice}
              </p>
            )}
            <div className='grid grid-cols-2 gap-2 lg:grid-cols-3 xl:max-h-[65vh] xl:grid-cols-1 xl:overflow-y-auto xl:pr-1'>
              {filtered.map((channel) => {
                const active = channel.id === selectedId;
                const fav = preferences.favorites.includes(channel.id);
                return (
                  <div
                    key={channel.id}
                    className={`relative min-w-0 overflow-hidden rounded-2xl border transition-colors ${
                      active
                        ? 'border-sky-400 bg-sky-50 shadow-sm dark:border-sky-500 dark:bg-sky-950/50'
                        : 'border-slate-200/50 bg-white/60 hover:border-slate-300 dark:border-slate-700/60 dark:bg-slate-800/50 dark:hover:border-slate-500'
                    }`}
                  >
                    <button
                      aria-label={`播放 ${channel.name}`}
                      aria-pressed={active}
                      onClick={() => choose(channel.id)}
                      className='min-h-[116px] w-full p-3 pb-9 text-left xl:min-h-[92px] xl:pb-3 xl:pr-12'
                    >
                      <div className='mb-2 flex items-center gap-2'>
                        <span
                          className={`flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-[10px] font-black tracking-tight ${
                            active
                              ? 'bg-sky-500 text-white'
                              : channel.id.startsWith('world:')
                              ? 'bg-slate-900 text-white dark:bg-slate-200 dark:text-slate-900'
                              : 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                          }`}
                        >
                          {wordmark(channel.name)}
                        </span>
                        <span
                          className={`text-[10px] ${
                            active
                              ? 'font-semibold text-sky-600 dark:text-sky-400'
                              : 'text-slate-400'
                          }`}
                        >
                          {active ? '已选频道' : channel.category}
                        </span>
                      </div>
                      <span className='block text-[13px] font-semibold leading-6 text-slate-800 dark:text-slate-100'>
                        {channel.name}
                        <span className='ml-1.5 inline-block align-middle'>
                          <SourceBadge count={channel.urls.length} />
                        </span>
                      </span>
                      <span className='mt-1 block text-[10px] leading-4 text-slate-400'>
                        {[channel.language, channel.quality]
                          .filter(Boolean)
                          .join(' · ') || '自定义直播'}
                      </span>
                    </button>
                    <button
                      aria-label={`${fav ? '取消收藏' : '收藏'} ${
                        channel.name
                      }`}
                      aria-pressed={fav}
                      onClick={() => favorite(channel.id)}
                      className={`absolute bottom-1 right-1 flex h-11 w-11 items-center justify-center rounded-xl xl:bottom-auto xl:top-2 ${
                        fav
                          ? 'text-rose-500'
                          : 'text-slate-300 hover:text-rose-400 dark:text-slate-500'
                      }`}
                    >
                      <Heart
                        className={`h-3.5 w-3.5 ${fav ? 'fill-current' : ''}`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>
            {!filtered.length && (
              <div className='flex min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center'>
                <Search className='h-6 w-6 text-slate-300' />
                <p className='text-sm font-medium text-slate-500'>
                  {library === '收藏'
                    ? '还没有收藏频道'
                    : library === '最近观看'
                    ? '选一个频道开始观看'
                    : '没有找到匹配频道'}
                </p>
                <p className='text-xs text-slate-400'>
                  {library === '收藏'
                    ? '点击频道旁的爱心，留住喜欢的频道。'
                    : '试试其他分类或搜索词。'}
                </p>
              </div>
            )}
          </section>
        </div>
      </div>
    </PageLayout>
  );
}
function SourceBadge({ count }: { count: number }) {
  return (
    <span className='inline-flex whitespace-nowrap rounded-md bg-slate-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-4 text-slate-500 ring-1 ring-slate-400/15 dark:bg-slate-700/50 dark:text-slate-300'>
      {count} 个源
    </span>
  );
}
function wordmark(name: string) {
  const latin = name.match(/[A-Za-z0-9]+/g)?.join(' ') || '';
  if (latin)
    return latin.split(' ').slice(0, 2).join('').slice(0, 4).toUpperCase();
  return name.replace(/卫视|频道|电视台/g, '').slice(0, 2);
}
function safeWebsite(value?: string) {
  try {
    const url = new URL(value || '');
    return url.protocol === 'https:' ? url.href : '';
  } catch {
    return '';
  }
}
function Verification({ channel }: { channel: LiveChannel }) {
  const result = channel.verification;
  const verified =
    result?.checkedAt &&
    ['browser-decode', 'upstream-decode'].includes(result.method);
  return verified ? (
    <span className='inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400'>
      <CheckCircle2 className='h-3 w-3' />
      {result.method === 'browser-decode' ? '本站检测通过' : '上游检测通过'}
    </span>
  ) : (
    <span className='text-xs text-slate-400'>
      频道候选 · 播放状态以实际连接为准
    </span>
  );
}
export default function LivePage() {
  return (
    <Suspense
      fallback={
        <div className='p-8 text-sm text-slate-500'>正在加载电视直播…</div>
      }
    >
      <LivePageClient />
    </Suspense>
  );
}
