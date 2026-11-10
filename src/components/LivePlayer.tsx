'use client';

import Artplayer from 'artplayer';
import Hls, { FetchLoader } from 'hls.js';
import { useEffect, useRef, useState } from 'react';

import type { LiveChannel } from '@/lib/live';
import { probeLiveSources } from '@/lib/live-probe';
import { DownloadMeter } from '@/lib/playback-stats';
import type { VideoProbeResult } from '@/lib/video-probe';

import PlaybackStats from '@/components/PlaybackStats';

const sound = { muted: true, volume: 0.7 };

export default function LivePlayer({ channel }: { channel: LiveChannel }) {
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
  const playlist = JSON.stringify(channel.urls);
  const builtIn = /^(cn|hk|mo|tw):/.test(channel.id);
  const [compatible, setCompatible] = useState(builtIn);
  const [errors, setErrors] = useState<string[]>([]);
  const [measurements, setMeasurements] = useState<
    Map<number, VideoProbeResult>
  >(new Map());
  const [preparing, setPreparing] = useState(
    builtIn && channel.urls.length > 1
  );
  const [probeVersion, setProbeVersion] = useState(0);
  const manualChoice = useRef(false);
  useEffect(() => {
    manualChoice.current = false;
    setMeasurements(new Map());
    const urls: string[] = JSON.parse(playlist);
    if (urls.length < 2) {
      setPreparing(false);
      return;
    }
    setPreparing(builtIn);
    const targets = urls.map((url, index) =>
      compatible && builtIn
        ? `/api/live/stream?${new URLSearchParams({
            channel: channel.id,
            line: String(index),
          })}`
        : url
    );
    let active = true;
    const session = probeLiveSources(
      targets,
      (index, result) => {
        if (active)
          setMeasurements((previous) => new Map(previous).set(index, result));
      },
      { force: probeVersion > 0 }
    );
    void session.ready.then((index) => {
      if (!active || manualChoice.current) return;
      if (index !== null) setLine(index);
      setPreparing(false);
    });
    return () => {
      active = false;
      session.cancel();
    };
  }, [playlist, compatible, builtIn, channel.id, probeVersion]);
  useEffect(() => {
    if (!container.current || preparing) return;
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
    meter.reset();
    setStatsTarget(null);
    const started = performance.now();
    setStatus(`正在连接线路 ${line + 1}…`);
    setFailed(false);
    setSeconds(null);
    const fail = (reason = '连接等待超过 20 秒') => {
      if (disposed || switched) return;
      switched = true;
      setErrors((previous) => [
        ...previous.slice(-4),
        `线路 ${line + 1}：${reason}`,
      ]);
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
      url:
        compatible && builtIn
          ? `/api/live/stream?${new URLSearchParams({
              channel: channel.id,
              line: String(line),
            })}`
          : urls[line],
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
    timer = setTimeout(() => fail(), 20000);
    player.on('video:playing', () => {
      if (disposed) return;
      clearTimeout(timer);
      if (!firstFrame) setSeconds((performance.now() - started) / 1000);
      firstFrame = true;
      setStatus('正在直播');
    });
    player.on('video:error', () => fail('浏览器无法加载或解码视频'));
    player.on('video:canplay', () => {
      clearTimeout(timer);
      if (player.video.paused) setStatus('已就绪，点击播放器开始播放');
    });
    player.on('video:waiting', () => {
      if (disposed) return;
      setStatus('正在缓冲…');
      clearTimeout(timer);
      timer = setTimeout(() => fail(), 20000);
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
      meter.reset();
      setStatsTarget(null);
    };
  }, [
    playlist,
    line,
    retry,
    compatible,
    builtIn,
    channel.id,
    preparing,
    meter,
  ]);
  return (
    <section className='glass-panel overflow-hidden rounded-2xl'>
      <div className='flex flex-wrap items-center justify-between gap-3 p-4'>
        <div>
          <h2 className='text-lg font-semibold'>{channel.name}</h2>
          <p role='status' className='mt-1 text-xs text-gray-500'>
            {preparing
              ? `正在检测线路 ${measurements.size}/${channel.urls.length}…`
              : status}
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
          mediaKey={`${channel.id}:${line}:${compatible}:${retry}`}
          label={`${channel.name} · 线路 ${line + 1}`}
        />
      )}
      <div className='flex flex-wrap items-center gap-2 p-4'>
        {builtIn && (
          <div className='flex w-full gap-2 pb-2'>
            {[true, false].map((value) => (
              <button
                key={String(value)}
                aria-pressed={compatible === value}
                onClick={() => {
                  setCompatible(value);
                  setRetry((v) => v + 1);
                }}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  compatible === value
                    ? 'border-blue-500 text-blue-600'
                    : 'border-gray-300 dark:border-gray-700'
                }`}
              >
                {value ? '兼容播放' : '直连播放'}
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
              manualChoice.current = true;
              setPreparing(false);
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
            <span className='mt-1 block text-[11px] opacity-75'>
              {measurements.has(index)
                ? `${measurements.get(index)?.quality} · ${
                    measurements.get(index)?.loadSpeed
                  } · ${
                    measurements.get(index)?.status === 'playable'
                      ? '预检可播放'
                      : '未确认解码'
                  }`
                : channel.urls.length > 1
                ? '等待测速'
                : '单线路'}
            </span>
          </button>
        ))}
        {channel.urls.length > 1 && (
          <button
            className='rounded-lg border border-gray-300 px-3 py-2 text-xs dark:border-gray-700'
            onClick={() => setProbeVersion((v) => v + 1)}
          >
            重新测速
          </button>
        )}
        {preparing && (
          <button
            className='rounded-lg bg-blue-600 px-3 py-2 text-sm text-white'
            onClick={() => {
              manualChoice.current = true;
              setPreparing(false);
            }}
          >
            跳过检测，直接播放
          </button>
        )}
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
          首次静音播放，切台保留音量。测速为目标线路短时媒体采样，速度不代表持续稳定性；可手动选源或跳过预检。
        </p>
      </div>
    </section>
  );
}
