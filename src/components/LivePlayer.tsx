'use client';

import Artplayer from 'artplayer';
import Hls, { FetchLoader } from 'hls.js';
import { useEffect, useRef, useState } from 'react';

import type { LiveChannel } from '@/lib/live';

const sound = { muted: true, volume: 0.7 };

export default function LivePlayer({ channel }: { channel: LiveChannel }) {
  const container = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState(0);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState('正在连接频道…');
  const [failed, setFailed] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const playlist = JSON.stringify(channel.urls);
  useEffect(() => {
    if (!container.current) return;
    const urls: string[] = JSON.parse(playlist);
    if (line >= urls.length) {
      setLine(0);
      return;
    }
    let disposed = false;
    let firstFrame = false;
    let hls: Hls | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let switched = false;
    const started = performance.now();
    setStatus(`正在连接线路 ${line + 1}…`);
    setFailed(false);
    setSeconds(null);
    const fail = () => {
      if (disposed || switched) return;
      switched = true;
      clearTimeout(timer);
      hls?.stopLoad();
      if (line + 1 < urls.length) {
        setStatus('正在尝试备用线路…');
        setLine(line + 1);
      } else {
        setFailed(true);
        setStatus('当前线路暂时无法播放，请重试或选择其他频道。');
      }
    };
    const player = new Artplayer({
      container: container.current,
      url: urls[line],
      type: 'm3u8',
      isLive: true,
      autoplay: true,
      muted: sound.muted,
      volume: sound.volume,
      fullscreen: true,
      fullscreenWeb: true,
      pip: true,
      playsInline: true,
      theme: '#22c55e',
      lang: 'zh-cn',
      setting: true,
      customType: {
        m3u8(video: HTMLVideoElement, url: string) {
          if (Hls.isSupported()) {
            hls = new Hls({
              loader: FetchLoader,
              fetchSetup: (context, init) =>
                new Request(context.url, { ...init, cache: 'no-store' }),
              maxBufferLength: 12,
              backBufferLength: 0,
              liveSyncDurationCount: 3,
            });
            hls.on(Hls.Events.ERROR, (_, data) => {
              if (data.fatal) fail();
            });
            hls.loadSource(url);
            hls.attachMedia(video);
          } else if (video.canPlayType('application/vnd.apple.mpegurl'))
            video.src = url;
          else fail();
        },
      },
    });
    timer = setTimeout(fail, 15000);
    player.on('video:playing', () => {
      if (disposed) return;
      clearTimeout(timer);
      if (!firstFrame) setSeconds((performance.now() - started) / 1000);
      firstFrame = true;
      setStatus('正在直播');
    });
    player.on('video:error', fail);
    player.on('video:waiting', () => {
      if (disposed) return;
      setStatus('正在缓冲…');
      clearTimeout(timer);
      timer = setTimeout(fail, 15000);
    });
    player.on('video:pause', () => {
      if (firstFrame) clearTimeout(timer);
    });
    return () => {
      disposed = true;
      clearTimeout(timer);
      sound.muted = player.video.muted;
      sound.volume = player.video.volume;
      hls?.destroy();
      player.destroy(false);
    };
  }, [playlist, line, retry]);
  return (
    <section className='glass-panel overflow-hidden rounded-2xl'>
      <div className='flex flex-wrap items-center justify-between gap-3 p-4'>
        <div>
          <h2 className='text-lg font-semibold'>{channel.name}</h2>
          <p role='status' className='mt-1 text-xs text-gray-500'>
            {status}
            {seconds !== null && ` · 启动 ${seconds.toFixed(1)} 秒`}
          </p>
        </div>
        <span className='rounded-full bg-green-500/10 px-3 py-1 text-xs text-green-600'>
          LIVE
        </span>
      </div>
      <div
        ref={container}
        className='aspect-video w-full bg-black'
        aria-label={`${channel.name}直播播放器`}
      />
      <div className='flex flex-wrap items-center gap-2 p-4'>
        {channel.urls.map((_, index) => (
          <button
            key={index}
            aria-pressed={line === index}
            onClick={() => {
              setLine(index);
              setRetry((v) => v + 1);
            }}
            className={`min-h-[40px] rounded-lg border px-3 text-xs ${
              line === index
                ? 'border-green-500 text-green-600'
                : 'border-gray-300 dark:border-gray-700'
            }`}
          >
            线路 {index + 1}
          </button>
        ))}
        {failed && (
          <button
            className='rounded-lg bg-blue-600 px-4 py-2 text-sm text-white'
            onClick={() => {
              setLine(0);
              setRetry((v) => v + 1);
            }}
          >
            重新连接
          </button>
        )}
        <p className='w-full text-xs text-gray-500'>
          首次静音播放，点击播放器音量开启声音，切台会保留音量。线路受地区、跨域和源站状态影响。
        </p>
      </div>
    </section>
  );
}
