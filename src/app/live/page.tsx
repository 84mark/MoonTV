'use client';

import {
  ArrowUpRight,
  CheckCircle2,
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

import { IptvChannel, loadIptvCatalog } from '@/lib/iptv-catalog';
import {
  isShoppingChannel,
  LIVE_STORAGE_KEY,
  LiveChannel,
  liveChannelRegion,
  LivePreferences,
  mergeLiveChannels,
  parseLiveM3u,
  readLivePreferences,
} from '@/lib/live';

import LivePlayer from '@/components/LivePlayer';
import PageLayout from '@/components/PageLayout';
import VirtualChannelList from '@/components/VirtualChannelList';

const initialPreferences: LivePreferences = {
  favorites: [],
  recent: [],
  customM3u: '',
};
function LivePageClient() {
  const [builtin, setBuiltin] = useState<LiveChannel[]>([]);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('全部地区');
  const [country, setCountry] = useState('');
  const [genre, setGenre] = useState('');
  const [library, setLibrary] = useState('全部频道');
  const [updatedAt, setUpdatedAt] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  const [selectedId, setSelectedId] = useState('');
  const [selectedChannel, setSelectedChannel] = useState<LiveChannel | null>(
    null
  );
  const [showImport, setShowImport] = useState(false);
  const [draft, setDraft] = useState('');
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState(false);
  const refreshBusy = useRef(false);
  const lastAttempt = useRef(0);
  const refreshVersion = useRef(0);
  const refresh = useCallback(async (signal?: AbortSignal, force = false) => {
    if (refreshBusy.current) return;
    refreshBusy.current = true;
    const version = ++refreshVersion.current;
    lastAttempt.current = Date.now();
    setUpdating(true);
    const display = (data: {
      channels: LiveChannel[];
      updatedAt: number;
      stale: boolean;
      error?: string;
    }) => {
      if (signal?.aborted) return;
      setBuiltin(data.channels);
      setUpdatedAt(data.updatedAt);
      setNotice(
        data.stale
          ? '正在使用已保存目录，联网后自动更新。'
          : `订阅已更新，共 ${data.channels.length.toLocaleString()} 个频道。`
      );
    };
    try {
      display(await loadIptvCatalog({ signal, force, onCached: display }));
    } catch {
      if (!signal?.aborted) setNotice('订阅暂时无法更新，请稍后重试。');
    } finally {
      if (version === refreshVersion.current) {
        refreshBusy.current = false;
        if (!signal?.aborted) setUpdating(false);
      }
    }
  }, []);
  useEffect(() => {
    setPreferences(readLivePreferences());
    setReady(true);
    const controller = new AbortController();
    void refresh(controller.signal);
    const refreshVisible = () => {
      // The loader owns the six-hour cache; avoid repeated attempts on tab switches.
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastAttempt.current >= 5 * 60 * 1000
      )
        void refresh(controller.signal);
    };
    document.addEventListener('visibilitychange', refreshVisible);
    const interval = window.setInterval(refreshVisible, 6 * 60 * 60 * 1000);
    return () => {
      controller.abort();
      refreshBusy.current = false;
      refreshVersion.current += 1;
      document.removeEventListener('visibilitychange', refreshVisible);
      window.clearInterval(interval);
    };
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
      mergeLiveChannels([
        ...builtin,
        ...parseLiveM3u(preferences.customM3u),
      ]).filter((channel) => !isShoppingChannel(channel)),
    [builtin, preferences.customM3u]
  );
  const selected = selectedId ? selectedChannel : null;
  const categories = ['全部地区', '国内频道', '海外频道'];
  const countryOptions = useMemo(() => {
    const values = new Map<string, string>();
    for (const channel of channels) {
      const item = channel as Partial<IptvChannel>;
      if (item.country)
        values.set(item.country, item.countryName || item.country);
    }
    return Array.from(values).sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
  }, [channels]);
  const genreOptions = useMemo(
    () =>
      Array.from(
        new Set(
          channels
            .flatMap(
              (channel) =>
                (channel as Partial<IptvChannel>).categories || [
                  channel.category,
                ]
            )
            .filter(Boolean)
        )
      ).sort(),
    [channels]
  );
  const filtered = useMemo(() => {
    const favorites = new Set(preferences.favorites);
    const recent = new Map(preferences.recent.map((id, index) => [id, index]));
    const text = query.trim().toLowerCase();
    return channels
      .filter((channel) => {
        const item = channel as Partial<IptvChannel>;
        const inRegion =
          category === '全部地区' ||
          liveChannelRegion(channel) ===
            (category === '海外频道' ? 'overseas' : 'domestic');
        const inLibrary =
          library === '全部频道' ||
          (library === '收藏'
            ? favorites.has(channel.id)
            : recent.has(channel.id));
        return (
          inRegion &&
          inLibrary &&
          (!country || item.country === country) &&
          (!genre || (item.categories || [channel.category]).includes(genre)) &&
          `${channel.name} ${channel.id} ${channel.category} ${
            channel.language || ''
          } ${item.countryName || ''} ${(item.languages || []).join(' ')}`
            .toLowerCase()
            .includes(text)
        );
      })
      .sort((a, b) =>
        library === '最近观看'
          ? (recent.get(a.id) || 0) - (recent.get(b.id) || 0)
          : 0
      );
  }, [
    channels,
    category,
    country,
    genre,
    library,
    preferences.favorites,
    preferences.recent,
    query,
  ]);
  const choose = (id: string) => {
    const channel = channels.find((item) => item.id === id);
    if (!channel) return;
    setSelectedChannel(channel);
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
      <div className='mx-auto max-w-[1800px] space-y-3 px-3 pb-28 pt-3 md:px-6 md:pt-16'>
        <header className='flex flex-wrap items-center justify-between gap-3'>
          <div className='flex items-center gap-3'>
            <span className='flex h-8 w-8 items-center justify-center rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400'>
              <Radio className='h-4 w-4' />
            </span>
            <div>
              <h1 className='text-lg font-bold tracking-tight'>电视直播</h1>
              <p className='text-[11px] text-slate-500'>IPTV · 全球频道</p>
            </div>
          </div>
          <div className='flex items-center gap-1 rounded-xl bg-white/50 p-1 dark:bg-slate-800/60'>
            <button
              onClick={() => void refresh(undefined, true)}
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
              粘贴完整 M3U 内容。支持 HTTP / HTTPS HLS
              线路，保存在当前浏览器。购物频道不会导入。
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
                    setNotice('未找到有效的非购物频道，请检查 M3U 内容。');
                    return;
                  }
                  setPreferences((value) => ({ ...value, customM3u: draft }));
                  setCategory(
                    liveChannelRegion(parsed[0]) === 'overseas'
                      ? '海外频道'
                      : '国内频道'
                  );
                  setLibrary('全部频道');
                  setCountry('');
                  setGenre('');
                  setQuery('');
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
                  setCategory('国内频道');
                  setLibrary('全部频道');
                  setCountry('');
                  setGenre('');
                  setQuery('');
                  setShowImport(false);
                }}
              >
                清除自定义频道
              </button>
            </div>
          </section>
        )}
        <div className='grid items-start gap-4 lg:grid-cols-[268px_minmax(0,1fr)] xl:grid-cols-[288px_minmax(0,1fr)]'>
          <div
            ref={stage}
            className='order-1 min-w-0 scroll-mt-4 space-y-3 lg:order-2 lg:sticky lg:top-4'
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
                      选择频道，开始观看
                    </h2>
                    <p className='mt-2 text-xs text-slate-400 md:text-sm'>
                      从频道列表选择直播，或点击下方快捷频道
                    </p>
                  </div>
                  <div className='flex flex-wrap justify-center gap-2'>
                    {filtered.slice(0, 2).map((channel) => (
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
            ) : null}
            <details className='px-1 text-xs text-slate-500'>
              <summary className='cursor-pointer py-2'>播放线路说明</summary>
              <p className='max-w-3xl pb-2 leading-6'>
                优先直接连接播放源，仅在需要时使用代理。目录自动更新，不会在浏览频道时下载视频或批量测速。
              </p>
            </details>
          </div>
          <section
            className='order-2 flex min-w-0 flex-col rounded-2xl border border-white/70 bg-white/70 p-3 shadow-sm dark:border-slate-700 dark:bg-slate-900/70 lg:order-1 lg:sticky lg:top-4 lg:max-h-[calc(100dvh-7rem)]'
            aria-label='频道列表'
          >
            <div className='shrink-0'>
              <div className='mb-3 flex shrink-0 items-center justify-between gap-3 px-1'>
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
              <div
                role='group'
                aria-label='按国内海外筛选'
                className='mt-3 grid min-h-[46px] grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800'
              >
                {categories.map((value) => (
                  <button
                    key={value}
                    aria-pressed={category === value}
                    onClick={() => {
                      setCategory(value);
                      setCountry('');
                    }}
                    className={`min-h-[38px] min-w-0 whitespace-nowrap rounded-lg px-2 text-xs font-semibold transition-colors ${
                      category === value
                        ? 'bg-white text-sky-700 shadow-sm dark:bg-slate-700 dark:text-sky-300'
                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </div>
              <div className='mt-2 grid grid-cols-2 gap-2'>
                <select
                  aria-label='按国家筛选'
                  value={country}
                  onChange={(event) => setCountry(event.target.value)}
                  className='h-9 min-w-0 rounded-lg border border-slate-200 bg-transparent px-2 text-xs dark:border-slate-700'
                >
                  <option value=''>所有国家</option>
                  {countryOptions.map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
                <select
                  aria-label='按分类筛选'
                  value={genre}
                  onChange={(event) => setGenre(event.target.value)}
                  className='h-9 min-w-0 rounded-lg border border-slate-200 bg-transparent px-2 text-xs dark:border-slate-700'
                >
                  <option value=''>所有分类</option>
                  {genreOptions.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </div>
              <div className='my-2 flex shrink-0 items-center justify-between gap-2 px-1'>
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
                  className='mb-2 px-1 text-[10px] leading-5 text-slate-400'
                >
                  {notice}
                </p>
              )}
            </div>
            {filtered.length > 0 && (
              <VirtualChannelList
                items={filtered}
                resetKey={[category, country, genre, library, query].join('|')}
                renderItem={(channel) => {
                  const active = channel.id === selectedId;
                  const fav = preferences.favorites.includes(channel.id);
                  return (
                    <div
                      key={channel.id}
                      className={`group relative flex min-w-0 items-center rounded-xl border transition-colors ${
                        active
                          ? 'border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/60'
                          : 'border-transparent hover:bg-slate-100/80 dark:hover:bg-slate-800'
                      }`}
                    >
                      <button
                        aria-label={`播放 ${channel.name}`}
                        aria-pressed={active}
                        onClick={() => choose(channel.id)}
                        className='flex min-h-[60px] min-w-0 flex-1 items-center gap-2.5 py-2 pl-2 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-500 rounded-xl'
                      >
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[10px] font-black tracking-tight ${
                            active
                              ? 'bg-sky-500 text-white'
                              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {wordmark(channel.name)}
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span
                            className={`block truncate text-[13px] font-semibold ${
                              active
                                ? 'text-sky-700 dark:text-sky-300'
                                : 'text-slate-800 dark:text-slate-100'
                            }`}
                          >
                            {channel.name}
                          </span>
                          <span className='mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400'>
                            <span className='truncate'>
                              {active
                                ? '正在观看'
                                : (channel as Partial<IptvChannel>)
                                    .countryName || channel.category}
                            </span>
                            <SourceBadge count={channel.urls.length} />
                          </span>
                        </span>
                      </button>
                      <button
                        aria-label={`${fav ? '取消收藏' : '收藏'} ${
                          channel.name
                        }`}
                        aria-pressed={fav}
                        onClick={() => favorite(channel.id)}
                        className={`flex h-11 w-9 shrink-0 items-center justify-center rounded-lg focus-visible:ring-2 focus-visible:ring-sky-500 ${
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
                }}
              />
            )}
            {!filtered.length && (
              <div className='flex min-h-[160px] flex-col items-center justify-center gap-2 px-4 text-center'>
                <Search className='h-6 w-6 text-slate-300' />
                <p className='text-sm font-medium text-slate-500'>
                  {updating && !channels.length
                    ? '正在载入频道目录…'
                    : library === '收藏'
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
