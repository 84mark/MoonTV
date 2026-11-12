'use client';

import Artplayer from 'artplayer';
import Hls, { FetchLoader } from 'hls.js';
import { useEffect, useRef, useState } from 'react';

import { LiveChannel } from '@/lib/live';
import { DownloadMeter } from '@/lib/playback-stats';

import PlaybackStats from '@/components/PlaybackStats';

const sound = { muted: true, volume: 0.7 };
type PlaybackMode = 'auto' | 'direct' | 'relay';
const isBuiltinChannel = (id: string) => /^(iptv|cn|hk|mo|tw|world):/.test(id);
type ChannelWithHeaders = LiveChannel & {
  requestHeaders?: Record<string, { referer?: string; userAgent?: string }>;
};

export default function LivePlayer({
  channel,
}: {
  channel: ChannelWithHeaders;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [line, setLine] = useState(0);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState('正在连接频道…');
  const [failed, setFailed] = useState(false);
  const [seconds, setSeconds] = useState<number | null>(null);
  const [meter] = useState(() => new DownloadMeter());
  const [statsTarget, setStatsTarget] = useState<{
    container: HTMLElement;
    video: HTMLVideoElement;
  } | null>(null);
  const [mode, setMode] = useState<PlaybackMode>('auto');
  const playlist = JSON.stringify(channel.urls);
  const builtIn = isBuiltinChannel(channel.id);
  const relayPolicy = JSON.stringify(
    Array.from(
      new Set([
        ...(channel.relayRequired || []),
        ...channel.urls.filter(
          (url) =>
            url.startsWith('http:') ||
            !!channel.requestHeaders?.[url]?.referer ||
            !!channel.requestHeaders?.[url]?.userAgent
        ),
      ])
    )
  );
  const [relayFallbacks, setRelayFallbacks] = useState<string[]>([]);
  const [relayUnavailable, setRelayUnavailable] = useState(false);
  const fallbackPolicy = JSON.stringify(relayFallbacks);
  const currentUrl = channel.urls[line] || '';
  const usingRelay =
    builtIn &&
    (mode === 'relay' ||
      (mode === 'auto' &&
        !relayUnavailable &&
        (JSON.parse(relayPolicy).includes(currentUrl) ||
          relayFallbacks.includes(currentUrl))));
  const headerPolicy = JSON.stringify(channel.requestHeaders || {});
  const [errors, setErrors] = useState<string[]>([]);
  const attempts = useRef({ session: '', paths: new Set<string>() });
  useEffect(() => {
    if (!container.current) return;
    const target = container.current;
    const urls: string[] = JSON.parse(playlist);
    if (line >= urls.length) {
      setLine(0);
      return;
    }
    if (!urls.length) return;
    const relayed = usingRelay;
    const session = `${channel.id}:${playlist}:${mode}:${retry}`;
    if (attempts.current.session !== session)
      attempts.current = { session, paths: new Set() };
    const attemptKey = `${urls[line]}:${relayed ? 'relay' : 'direct'}`;
    const alreadyAttempted = attempts.current.paths.has(attemptKey);
    attempts.current.paths.add(attemptKey);
    const controller = new AbortController();
    const referer = JSON.parse(headerPolicy)[urls[line]]?.referer;
    const userAgent = JSON.parse(headerPolicy)[urls[line]]?.userAgent;
    let disposed = false;
    let firstFrame = false;
    const startupTimeout = relayed ? 12000 : 8000;
    let startupDeadline = Date.now() + startupTimeout;
    let hls: Hls | null = null;
    let player: Artplayer | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let switched = false;
    meter.reset();
    setStatsTarget(null);
    const started = performance.now();
    setStatus(`正在连接线路 ${line + 1}…`);
    setFailed(false);
    setSeconds(null);
    const fail = (
      reason = firstFrame
        ? '缓冲等待超过 20 秒'
        : `首帧等待超过 ${startupTimeout / 1000} 秒`
    ) => {
      if (disposed || switched) return;
      switched = true;
      setErrors((previous) => [
        ...previous.slice(-4),
        `线路 ${line + 1}（${relayed ? 'Cloudflare' : '直连'}）：${reason}`,
      ]);
      clearTimeout(timer);
      hls?.stopLoad();
      if (
        builtIn &&
        mode === 'auto' &&
        !relayed &&
        !relayUnavailable &&
        urls[line].startsWith('https:')
      ) {
        setStatus('直连未成功，正在尝试 Cloudflare 兼容转发…');
        setRelayFallbacks((previous) =>
          Array.from(new Set([...previous, urls[line]]))
        );
      } else if (line + 1 < urls.length) {
        setStatus('正在尝试备用线路…');
        setLine(line + 1);
      } else {
        setFailed(true);
        setStatus('当前线路暂时无法播放，请重试或选择其他频道。');
      }
    };
    const start = (playbackUrl: string) => {
      if (disposed) return;
      startupDeadline = Date.now() + startupTimeout;
      player = new Artplayer({
        container: target,
        url: playbackUrl,
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
            if (video.canPlayType('application/vnd.apple.mpegurl')) {
              video.src = url;
            } else if (Hls.isSupported()) {
              hls = new Hls({
                loader: FetchLoader,
                fetchSetup: (context, init) =>
                  new Request(context.url, { ...init, cache: 'no-store' }),
                maxBufferLength: 12,
                backBufferLength: 0,
                liveSyncDurationCount: 3,
              });
              hls.on(Hls.Events.ERROR, (_, data) => {
                if (data.fatal) {
                  const code = data.response?.code;
                  const label = /manifest|level/i.test(data.details)
                    ? '播放列表加载失败'
                    : /frag|key/i.test(data.details)
                    ? '视频分片或密钥加载失败'
                    : /media|buffer/i.test(data.details)
                    ? '视频解码失败'
                    : '连接失败';
                  fail(
                    `${label}${code ? `（HTTP ${code}）` : ''} · ${
                      data.details || data.type
                    }`
                  );
                }
              });
              meter.available = true;
              hls.on(Hls.Events.FRAG_LOADING, (_, data) =>
                meter.track(data.frag.stats)
              );
              hls.on(Hls.Events.FRAG_LOADED, (_, data) =>
                meter.track(data.frag.stats)
              );
              hls.loadSource(url);
              hls.attachMedia(video);
            } else fail('当前浏览器不支持 HLS 播放');
          },
        },
      });
      if (player.template?.$player)
        setStatsTarget({
          container: player.template.$player,
          video: player.video,
        });
      timer = setTimeout(() => fail(), startupTimeout);
      player.on('video:playing', () => {
        if (disposed) return;
        clearTimeout(timer);
        if (!firstFrame) setSeconds((performance.now() - started) / 1000);
        firstFrame = true;
        setStatus('正在直播');
      });
      player.on('video:error', () => fail('浏览器无法加载或解码视频'));
      player.on('video:canplay', () => {
        if (player?.video.paused) {
          clearTimeout(timer);
          setStatus('已就绪，点击播放器开始播放');
        }
      });
      player.on('video:waiting', () => {
        if (disposed) return;
        setStatus('正在缓冲…');
        clearTimeout(timer);
        timer = setTimeout(
          () => fail(),
          firstFrame ? 20000 : Math.max(0, startupDeadline - Date.now())
        );
      });
      player.on('video:pause', () => {
        if (firstFrame) clearTimeout(timer);
      });
    };
    if (alreadyAttempted) {
      fail('该线路已尝试，正在查找下一线路');
    } else if (relayed) {
      setStatus('正在准备兼容线路…');
      timer = setTimeout(() => {
        controller.abort();
        fail('代理授权请求超时');
      }, 8000);
      void fetch('/api/live/ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urls[line],
          ...(referer ? { referer } : {}),
          ...(userAgent ? { userAgent } : {}),
        }),
        signal: controller.signal,
      })
        .then(async (response) => {
          const data = await response.json();
          if (disposed || switched) return;
          if (response.status === 503 && mode === 'auto') {
            clearTimeout(timer);
            setRelayUnavailable(true);
            if (
              urls[line].startsWith('https:') &&
              !referer &&
              !userAgent &&
              !JSON.parse(fallbackPolicy).includes(urls[line])
            ) {
              setErrors((previous) => [
                ...previous.slice(-4),
                '独立代理尚未配置，尝试 HTTPS 直连',
              ]);
            } else fail(data.error || '独立代理尚未配置');
            return;
          }
          if (!response.ok || typeof data.url !== 'string')
            throw new Error(data.error || '独立代理尚未配置');
          if (disposed || switched) return;
          clearTimeout(timer);
          start(data.url);
        })
        .catch((error) => {
          if (!disposed)
            fail(error instanceof Error ? error.message : '代理授权失败');
        });
    } else if (referer || userAgent) {
      fail('此线路要求特定请求头，需要启用独立代理');
    } else if (urls[line].startsWith('http:')) {
      fail('HTTP 线路需要启用兼容转发');
    } else {
      start(urls[line]);
    }
    return () => {
      disposed = true;
      clearTimeout(timer);
      controller.abort();
      if (player) {
        sound.muted = player.video.muted;
        sound.volume = player.video.volume;
      }
      hls?.destroy();
      player?.destroy(false);
      meter.reset();
      setStatsTarget(null);
    };
  }, [
    playlist,
    line,
    retry,
    mode,
    relayPolicy,
    fallbackPolicy,
    builtIn,
    channel.id,
    meter,
    usingRelay,
    headerPolicy,
    relayUnavailable,
  ]);
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
      {statsTarget && (
        <PlaybackStats
          container={statsTarget.container}
          video={statsTarget.video}
          meter={meter}
          episode={line + 1}
          total={channel.urls.length}
          mediaKey={`${channel.id}:${line}:${mode}:${relayPolicy}:${retry}`}
          label={`${channel.name} · 线路 ${line + 1}`}
        />
      )}
      <div className='flex flex-wrap items-center gap-2 p-4'>
        {builtIn && (
          <div className='flex w-full gap-2 pb-2'>
            {(
              [
                { value: 'auto', label: '自动选择' },
                { value: 'direct', label: '直连播放' },
                { value: 'relay', label: 'Cloudflare 转发' },
              ] as const
            ).map(({ value, label }) => (
              <button
                key={String(value)}
                aria-pressed={mode === value}
                onClick={() => {
                  setRelayFallbacks([]);
                  setRelayUnavailable(false);
                  setMode(value);
                  setRetry((v) => v + 1);
                }}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  mode === value
                    ? 'border-blue-500 text-blue-600'
                    : 'border-gray-300 dark:border-gray-700'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {channel.urls.map((_, index) => (
          <button
            key={index}
            aria-pressed={line === index}
            aria-label={`线路 ${index + 1}`}
            onClick={() => {
              setLine(index);
              setRetry((v) => v + 1);
            }}
            className={`min-h-[40px] max-w-full break-all rounded-lg border px-3 py-2 text-left text-xs ${
              line === index
                ? 'border-green-500 text-green-600'
                : 'border-gray-300 dark:border-gray-700'
            }`}
          >
            <span className='block'>
              线路 {index + 1} · {new URL(channel.urls[index]).hostname}
            </span>
          </button>
        ))}
        {failed && (
          <button
            className='rounded-lg bg-blue-600 px-4 py-2 text-sm text-white'
            onClick={() => {
              setRelayFallbacks([]);
              setRelayUnavailable(false);
              setLine(0);
              setRetry((v) => v + 1);
            }}
          >
            重新连接
          </button>
        )}
        {errors.length > 0 && (
          <details className='w-full text-xs text-amber-700 dark:text-amber-400'>
            <summary>连接诊断（{errors.length}）</summary>
            <ul className='mt-2 space-y-1'>
              {errors.map((error, index) => (
                <li key={index}>{error}</li>
              ))}
            </ul>
          </details>
        )}
        <p className='w-full text-xs text-gray-500'>
          当前线路：
          {usingRelay
            ? currentUrl.startsWith('http:')
              ? 'Cloudflare 兼容转发（HTTP 源）'
              : 'Cloudflare 转发'
            : '浏览器直连'}
          。只加载当前线路，失败后再尝试备用线路。首次静音，切台保留音量。
        </p>
      </div>
    </section>
  );
}
