'use client';

import { ChevronLeft, ChevronRight, Heart, Radio, Search } from 'lucide-react';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';

import './style.css';

import {
  canReplay,
  chinaDate,
  DOMESTIC_CHANNELS,
  DomesticProgramme,
  parseDomesticEpg,
  programmeTime,
} from '@/lib/domestic-live';

import DomesticPlayer, { DomesticWindow } from '@/components/DomesticPlayer';
import PageLayout from '@/components/PageLayout';

function DomesticLive() {
  const [selected, setSelected] = useState('cgtn');
  const [query, setQuery] = useState('');
  const [playableOnly, setPlayableOnly] = useState(false);
  const [date, setDate] = useState(chinaDate);
  const [programmes, setProgrammes] = useState<DomesticProgramme[]>([]);
  const [epgStatus, setEpgStatus] = useState('');
  const [now, setNow] = useState(Date.now());
  const [window, setWindow] = useState<DomesticWindow | null>(null);
  const [seek, setSeek] = useState<{ unix: number; nonce: number } | null>(
    null
  );
  const [favorites, setFavorites] = useState<string[]>([]);
  const channel =
    DOMESTIC_CHANNELS.find((item) => item.id === selected) ||
    DOMESTIC_CHANNELS[20];
  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem('moontv_domestic_favorites_v1') || '[]'
      );
      if (Array.isArray(saved))
        setFavorites(saved.filter((item) => typeof item === 'string'));
    } catch {
      /* Favorites are optional. */
    }
    const clock = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(clock);
  }, []);
  useEffect(() => {
    setProgrammes([]);
    if (!channel.epgId) {
      setEpgStatus('该频道暂未提供可用的官方节目单');
      return;
    }
    let active = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    setEpgStatus('正在加载官方节目单…');
    const url = new URL('https://api.cntv.cn/epg/getEpgInfoByChannelNew');
    url.searchParams.set('c', channel.epgId);
    url.searchParams.set('serviceId', 'tvcctv');
    url.searchParams.set('d', date.replace(/-/g, ''));
    void fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`节目单 HTTP ${response.status}`);
        const data = parseDomesticEpg(
          await response.json(),
          channel.epgId || ''
        );
        if (!controller.signal.aborted) {
          setProgrammes(data);
          setEpgStatus(data.length ? '' : '当天暂无官方节目单');
        }
      })
      .catch(() => {
        if (active)
          setEpgStatus(
            controller.signal.aborted
              ? '节目单加载超时'
              : '官方节目单暂时无法加载'
          );
        else if (controller.signal.reason?.name === 'TimeoutError')
          setEpgStatus('节目单加载超时');
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      active = false;
      controller.abort();
      clearTimeout(timeout);
    };
  }, [channel.epgId, date]);
  const choose = (id: string) => {
    setSelected(id);
    setSeek(null);
    setWindow(null);
  };
  const favorite = () => {
    const next = favorites.includes(channel.id)
      ? favorites.filter((id) => id !== channel.id)
      : [...favorites, channel.id];
    setFavorites(next);
    try {
      localStorage.setItem(
        'moontv_domestic_favorites_v1',
        JSON.stringify(next)
      );
    } catch {
      /* Playback does not depend on storage. */
    }
  };
  const changeDay = (amount: number) => {
    const day = new Date(`${date}T12:00:00+08:00`);
    day.setUTCDate(day.getUTCDate() + amount);
    setDate(chinaDate(day));
  };
  const filtered = DOMESTIC_CHANNELS.filter(
    (item) =>
      (!playableOnly || item.streams.length) &&
      item.name.toLowerCase().includes(query.trim().toLowerCase())
  );
  return (
    <PageLayout activePath='/domestic-live'>
      <div className='domestic-live'>
        <header className='domestic-header'>
          <div>
            <h1>国内直播</h1>
            <span>官方直连 · 仅启用已验证线路</span>
          </div>
          <Link href='/live'>
            电视直播 <ChevronRight size={15} />
          </Link>
        </header>
        <div className='domestic-layout'>
          <section className='domestic-main' aria-label='国内直播播放器'>
            <DomesticPlayer
              key={channel.id}
              channel={channel}
              programmes={programmes}
              seek={seek}
              onWindow={setWindow}
            />
            <div className='domestic-below'>
              <div>
                <h2>{channel.name}</h2>
                <span>
                  {channel.streams.length ? '已验证官方直连' : '暂未开放播放'}
                </span>
              </div>
              <button
                onClick={favorite}
                aria-pressed={favorites.includes(channel.id)}
              >
                <Heart
                  size={18}
                  fill={
                    favorites.includes(channel.id) ? 'currentColor' : 'none'
                  }
                />
                {favorites.includes(channel.id) ? '已收藏' : '收藏'}
              </button>
            </div>
            <p className='domestic-replay-note'>
              时移仅限当前信号提供的直播窗口；节目单不代表可回放。未提供兼容直连线路的频道暂不播放。
            </p>
          </section>
          <aside className='domestic-channels' aria-label='国内直播频道列表'>
            <div className='domestic-channel-tools'>
              <label>
                <Search size={16} />
                <input
                  aria-label='搜索国内频道'
                  placeholder='搜索频道'
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                aria-pressed={playableOnly}
                onClick={() => setPlayableOnly(!playableOnly)}
              >
                {playableOnly ? '查看全部' : '仅可播放'}
              </button>
            </div>
            <div className='domestic-channel-scroll'>
              {filtered.map((item) => (
                <div
                  className={`domestic-channel ${
                    selected === item.id ? 'is-selected' : ''
                  }`}
                  key={item.id}
                >
                  <button
                    className='domestic-channel-select'
                    onClick={() => choose(item.id)}
                    aria-pressed={selected === item.id}
                  >
                    <span>{item.name}</span>
                    <small>{item.streams.length ? '可播放' : '暂不可用'}</small>
                  </button>
                  {selected === item.id && (
                    <div className='domestic-epg'>
                      <div className='domestic-date'>
                        <button
                          aria-label='前一天节目单'
                          onClick={() => changeDay(-1)}
                        >
                          <ChevronLeft size={16} />
                        </button>
                        <input
                          type='date'
                          aria-label='节目单日期'
                          value={date}
                          onChange={(event) => {
                            if (event.target.value) setDate(event.target.value);
                          }}
                        />
                        <button
                          aria-label='后一天节目单'
                          onClick={() => changeDay(1)}
                        >
                          <ChevronRight size={16} />
                        </button>
                      </div>
                      {epgStatus && (
                        <p role='status' className='domestic-epg-message'>
                          {epgStatus}
                        </p>
                      )}
                      <ol aria-label={`${item.name}节目单`}>
                        {programmes.map((programme) => {
                          const current =
                            programme.start <= now / 1000 &&
                            programme.end > now / 1000;
                          const replay =
                            item.streams.length > 0 &&
                            canReplay(programme, window);
                          return (
                            <li
                              key={programme.start}
                              className={current ? 'is-live' : ''}
                            >
                              <span className='domestic-programme-dot' />
                              <time>{programmeTime(programme.start)}</time>
                              <span
                                className='domestic-epg-title'
                                title={programme.title}
                              >
                                {programme.title}
                              </span>
                              {current ? (
                                <span className='domestic-epg-live'>
                                  <Radio size={12} />
                                  直播
                                </span>
                              ) : (
                                <button
                                  disabled={!replay}
                                  title={
                                    replay
                                      ? '在当前直播窗口回看'
                                      : programme.start > now / 1000
                                      ? '节目尚未播出'
                                      : '当前源不提供该时段回看'
                                  }
                                  onClick={() =>
                                    setSeek({
                                      unix: programme.start,
                                      nonce: Date.now(),
                                    })
                                  }
                                >
                                  回看
                                </button>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}
                </div>
              ))}
              {!filtered.length && (
                <p className='domestic-epg-message'>没有匹配的频道</p>
              )}
            </div>
          </aside>
        </div>
      </div>
    </PageLayout>
  );
}
export default function DomesticLivePage() {
  return (
    <Suspense fallback={<div className='p-8'>正在加载国内直播…</div>}>
      <DomesticLive />
    </Suspense>
  );
}
