'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { bufferedAhead, DownloadMeter } from '@/lib/playback-stats';

type Mode = 'auto' | 'pinned' | 'closed';
interface Props {
  container: HTMLElement;
  video: HTMLVideoElement;
  meter: DownloadMeter;
  episode: number;
  total: number;
  mediaKey: string;
  label?: string;
}
export default function PlaybackStats({
  container,
  video,
  meter,
  episode,
  total,
  mediaKey,
  label,
}: Props) {
  const [mode, setMode] = useState<Mode>('auto');
  const [active, setActive] = useState(true);
  const [stats, setStats] = useState({
    speed: 0,
    buffered: 0,
    available: false,
    history: [] as number[],
  });
  useEffect(() => {
    try {
      const value = localStorage.getItem('playbackStatsMode');
      if (value === 'auto' || value === 'pinned' || value === 'closed')
        setMode(value);
    } catch {
      /* Preferences are optional. */
    }
  }, []);
  const changeMode = (value: Mode) => {
    setMode(value);
    try {
      localStorage.setItem('playbackStatsMode', value);
    } catch {
      /* ignore */
    }
  };
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const show = () => {
      setActive(true);
      clearTimeout(timer);
      timer = setTimeout(() => setActive(false), 4000);
    };
    show();
    container.addEventListener('pointermove', show);
    container.addEventListener('touchstart', show, { passive: true });
    container.addEventListener('focusin', show);
    return () => {
      clearTimeout(timer);
      container.removeEventListener('pointermove', show);
      container.removeEventListener('touchstart', show);
      container.removeEventListener('focusin', show);
    };
  }, [container, mode]);
  useEffect(() => {
    setStats({ speed: 0, buffered: 0, available: false, history: [] });
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const speed = meter.sample((now - last) / 1000);
      last = now;
      setStats((previous) => ({
        speed,
        buffered: bufferedAhead(video),
        available: meter.available,
        history: [...previous.history, speed].slice(-30),
      }));
    }, 1000);
    return () => clearInterval(timer);
  }, [video, meter, mediaKey]);
  const visible = mode === 'pinned' || active;
  const max = Math.max(1024, ...stats.history);
  const points = stats.history
    .map((value, index) => `${(index * 200) / 29},${36 - (value / max) * 32}`)
    .join(' ');
  return createPortal(
    <div
      className={`absolute left-3 top-3 z-[60] max-w-[calc(100%-24px)] text-xs text-white transition-opacity ${
        visible ? 'opacity-100' : 'pointer-events-none opacity-0'
      }`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {mode === 'closed' ? (
        <button
          onClick={() => changeMode('auto')}
          className='rounded-md bg-black/65 px-3 py-2'
        >
          显示播放信息
        </button>
      ) : (
        <div
          className='w-60 max-w-full rounded-lg bg-black/75 p-3 shadow-lg backdrop-blur-sm'
          aria-label='播放信息'
        >
          <div className='mb-2 flex items-center justify-between gap-3'>
            <strong>{label || `剧集（${episode}/${total}）`}</strong>
            <div className='flex gap-2'>
              <button
                aria-pressed={mode === 'pinned'}
                onClick={() =>
                  changeMode(mode === 'pinned' ? 'auto' : 'pinned')
                }
                className='text-green-300'
              >
                {mode === 'pinned' ? '取消常驻' : '常驻'}
              </button>
              <button
                aria-label='关闭播放信息'
                onClick={() => changeMode('closed')}
              >
                ×
              </button>
            </div>
          </div>
          <p>
            视频下行{' '}
            {stats.available
              ? `${(stats.speed / 1024).toFixed(1)} KB/s`
              : '当前浏览器暂不提供'}
          </p>
          <svg
            role='img'
            aria-label='最近30秒视频下载速率'
            viewBox='0 0 200 40'
            className='my-2 h-10 w-full'
          >
            <path d='M0 38H200' stroke='currentColor' opacity='.25' />
            <polyline
              points={points}
              fill='none'
              stroke='#4ade80'
              strokeWidth='2'
            />
          </svg>
          <p>已向前缓存 {stats.buffered.toFixed(1)} 秒</p>
          <p className='mt-1 text-[10px] text-white/60'>
            视频分片下载量 · 缓存充足时下行可为 0
          </p>
        </div>
      )}
    </div>,
    container
  );
}
