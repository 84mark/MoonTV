'use client';

import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { useEffect, useRef, useState } from 'react';

import { LiveChannel } from '@/lib/live';
import { createLiveLoader } from '@/lib/live-loader';
import { DownloadMeter } from '@/lib/playback-stats';

import PlaybackStats from '@/components/PlaybackStats';

// This player owns recovery; Artplayer's default five URL reloads bypass HLS diagnostics.
class LiveArtplayer extends Artplayer {
  static RECONNECT_TIME_MAX = 0;
}
type ConnectionPhase =
  | 'authorize'
  | 'manifest'
  | 'segments'
  | 'decode'
  | 'playing'
  | 'buffering'
  | 'ready'
  | 'paused'
  | 'error';
type ConnectionEntry = { at: number; text: string; error: boolean };
const phaseLabels: Record<ConnectionPhase, string> = {
  authorize: '申请播放授权',
  manifest: '加载播放清单',
  segments: '下载视频分片',
  decode: '等待视频解码',
  playing: '正在播放',
  buffering: '等待缓冲恢复',
  ready: '等待点击播放',
  paused: '播放已暂停',
  error: '连接失败',
};
// Do not expose signed resource URLs or credentials in diagnostics.
const safeMessage = (value: string) =>
  value
    .replace(/https?:\/\/[^\s<>"']+/gi, '[资源地址]')
    .split('')
    .map((char) => (char.charCodeAt(0) < 32 ? ' ' : char))
    .join('')
    .slice(0, 240);

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
  const [connection, setConnection] = useState<{
    phase: ConnectionPhase;
    since: number;
    deadline?: number;
  }>({ phase: 'manifest', since: Date.now() });
  const [history, setHistory] = useState<ConnectionEntry[]>([]);
  const [now, setNow] = useState(Date.now());
  const logView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (['playing', 'ready', 'paused', 'error'].includes(connection.phase))
      return;
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(clock);
  }, [connection.phase]);
  useEffect(() => {
    const element = logView.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [history]);
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
    if (attempts.current.session !== session) {
      attempts.current = { session, paths: new Set() };
      setHistory([]);
    }
    const attemptKey = `${urls[line]}:${relayed ? 'relay' : 'direct'}`;
    const alreadyAttempted = attempts.current.paths.has(attemptKey);
    attempts.current.paths.add(attemptKey);
    const controller = new AbortController();
    const referer = JSON.parse(headerPolicy)[urls[line]]?.referer;
    const userAgent = JSON.parse(headerPolicy)[urls[line]]?.userAgent;
    let disposed = false;
    let firstFrame = false;
    const startupTimeout = relayed ? 30000 : 25000;
    let startupDeadline = Date.now() + startupTimeout;
    let hls: Hls | null = null;
    let player: Artplayer | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let switched = false;
    let bufferingDeadline = 0;
    let recoveredMedia = false;
    let currentPhase: ConnectionPhase = relayed ? 'authorize' : 'manifest';
    const log = (text: string, error = false) => {
      if (disposed) return;
      setHistory((previous) => [
        ...previous.slice(-79),
        { at: Date.now(), text: safeMessage(text), error },
      ]);
    };
    const phase = (
      next: ConnectionPhase,
      detail: string,
      deadline?: number
    ) => {
      if (disposed || switched) return;
      if (currentPhase !== next) log(detail);
      currentPhase = next;
      setNow(Date.now());
      setConnection((previous) => ({
        phase: next,
        since: previous.phase === next ? previous.since : Date.now(),
        deadline,
      }));
      setStatus(detail);
    };
    log(
      `线路 ${line + 1}/${urls.length} · ${
        relayed ? '独立 Worker 转发' : 'HTTPS 直连'
      } · ${new URL(urls[line]).hostname}`
    );
    setConnection({
      phase: currentPhase,
      since: Date.now(),
      deadline: startupDeadline,
    });
    setNow(Date.now());
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
      log(
        `线路 ${line + 1}（${relayed ? '独立 Worker' : '直连'}）：${reason}`,
        true
      );
      setConnection({ phase: 'error', since: Date.now() });
      clearTimeout(timer);
      hls?.stopLoad();
      if (
        builtIn &&
        mode === 'auto' &&
        !relayed &&
        !relayUnavailable &&
        urls[line].startsWith('https:')
      ) {
        log('直连失败，切换同一线路的独立 Worker 转发');
        setStatus('直连未成功，正在尝试 Cloudflare 兼容转发…');
        setRelayFallbacks((previous) =>
          Array.from(new Set([...previous, urls[line]]))
        );
      } else if (line + 1 < urls.length) {
        log(`当前线路失败，开始备用线路 ${line + 2}/${urls.length}`);
        setStatus('正在尝试备用线路…');
        setLine(line + 1);
      } else {
        setFailed(true);
        setStatus('当前线路暂时无法播放，请重试或选择其他频道。');
      }
    };
    const start = (playbackUrl: string) => {
      if (disposed || switched) return;
      startupDeadline = Date.now() + startupTimeout;
      phase('manifest', '正在请求播放清单…', startupDeadline);
      const LiveFetchLoader = createLiveLoader({
        isActive: () => !disposed && !switched,
        deadline: () => startupDeadline,
        log,
      });
      const loadPolicy = {
        default: {
          maxTimeToFirstByteMs: 10000,
          maxLoadTimeMs: 18000,
          timeoutRetry: {
            maxNumRetry: 2,
            retryDelayMs: 1500,
            maxRetryDelayMs: 4000,
          },
          errorRetry: {
            maxNumRetry: 2,
            retryDelayMs: 1500,
            maxRetryDelayMs: 4000,
          },
        },
      };
      player = new LiveArtplayer({
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
            if (Hls.isSupported()) {
              hls = new Hls({
                loader: LiveFetchLoader,
                manifestLoadPolicy: loadPolicy,
                playlistLoadPolicy: loadPolicy,
                fragLoadPolicy: loadPolicy,
                keyLoadPolicy: loadPolicy,
                fetchSetup: (context, init) =>
                  new Request(context.url, { ...init, cache: 'no-store' }),
                maxBufferLength: 12,
                backBufferLength: 0,
                liveSyncDurationCount: 3,
              });
              hls.on(Hls.Events.ERROR, (_, data) => {
                if (disposed || switched) return;
                const code = data.response?.code;
                const label = /manifest|level/i.test(data.details || '')
                  ? '播放清单加载失败'
                  : /frag|key/i.test(data.details || '')
                  ? '视频分片或密钥加载失败'
                  : /media|buffer/i.test(data.details || '')
                  ? '视频解码或缓冲异常'
                  : '连接失败';
                const reason = `${label}${code ? `（HTTP ${code}）` : ''} · ${
                  data.details || data.type || '未知错误'
                }`;
                if (data.fatal) {
                  if (
                    data.type &&
                    data.type === Hls.ErrorTypes?.MEDIA_ERROR &&
                    !recoveredMedia &&
                    hls
                  ) {
                    recoveredMedia = true;
                    log(`${reason}，正在重新初始化解码器（1/1）`, true);
                    phase(
                      'decode',
                      '正在恢复视频解码…',
                      firstFrame ? Date.now() + 20000 : startupDeadline
                    );
                    hls.recoverMediaError();
                    clearTimeout(timer);
                    timer = setTimeout(
                      () => fail('视频解码恢复超时'),
                      firstFrame
                        ? 20000
                        : Math.max(0, startupDeadline - Date.now())
                    );
                  } else fail(reason);
                } else if (/LoadError|LoadTimeOut/i.test(data.details || '')) {
                  log(
                    `${reason}；临时故障最多重试 2 次，间隔 1.5–4 秒，仍受连接时限约束`,
                    true
                  );
                  setStatus('资源暂未加载成功，正在等待重试…');
                } else if (/bufferStalled/i.test(data.details || '')) {
                  log('播放缓冲不足，等待新的视频分片');
                }
              });
              hls.on(Hls.Events.MANIFEST_LOADED, () => {
                if (!firstFrame) {
                  log('播放清单已返回，正在解析频道线路');
                  phase('segments', '正在加载视频分片…', startupDeadline);
                }
              });
              hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
                if (!firstFrame)
                  log(`清单解析完成，发现 ${data.levels.length} 档画质`);
              });
              meter.available = true;
              hls.on(Hls.Events.FRAG_LOADING, (_, data) => {
                if (disposed || switched) return;
                meter.track(data.frag.stats);
                if (!firstFrame && currentPhase === 'manifest')
                  phase(
                    'segments',
                    '清单已解析，正在下载视频分片…',
                    startupDeadline
                  );
              });
              hls.on(Hls.Events.FRAG_LOADED, (_, data) => {
                if (disposed || switched) return;
                meter.track(data.frag.stats);
                if (!firstFrame && currentPhase !== 'decode') {
                  log(
                    `视频分片已返回（${Math.round(
                      data.frag.stats.loaded / 1024
                    )} KiB），等待首帧`
                  );
                  phase('decode', '分片已收到，等待视频解码…', startupDeadline);
                }
              });
              hls.loadSource(url);
              hls.attachMedia(video);
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
              log(
                '使用浏览器原生 HLS；该浏览器不公开分片请求的 HTTP 状态，连接阶段以媒体事件为准'
              );
              video.src = url;
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
        if (disposed || switched) return;
        clearTimeout(timer);
        bufferingDeadline = 0;
        phase('playing', '正在直播');
        if (!firstFrame) setSeconds((performance.now() - started) / 1000);
        firstFrame = true;
        setStatus('正在直播');
      });
      player.on('video:error', () => {
        const error = player?.video.error;
        const reasons: Record<number, string> = {
          1: '视频加载已中止',
          2: '视频网络连接失败（可能为网络或跨域限制）',
          3: '浏览器视频解码失败，编码可能不受支持',
          4: '视频格式或源地址不受浏览器支持',
        };
        fail(
          `${
            error
              ? reasons[error.code] || '浏览器无法加载视频'
              : '浏览器无法加载或解码视频'
          }${error?.message ? ` · ${error.message}` : ''}`
        );
      });
      player.on('video:loadedmetadata', () => {
        if (!firstFrame)
          phase('decode', '视频信息已读取，等待首帧…', startupDeadline);
      });
      player.on('video:stalled', () => {
        if (!disposed && !switched)
          log('浏览器暂未收到新数据，继续等待至当前连接时限');
      });
      player.on('video:play', () => {
        if (disposed || switched || firstFrame || currentPhase !== 'ready')
          return;
        startupDeadline = Date.now() + startupTimeout;
        phase('decode', '正在开始播放，等待首帧…', startupDeadline);
        clearTimeout(timer);
        timer = setTimeout(() => fail(), startupTimeout);
      });
      player.on('video:canplay', () => {
        if (disposed || switched) return;
        if (player?.video.paused) {
          clearTimeout(timer);
          phase('ready', '已就绪，点击播放器开始播放');
        }
      });
      player.on('video:waiting', () => {
        if (disposed || switched) return;
        if (firstFrame && !bufferingDeadline)
          bufferingDeadline = Date.now() + 20000;
        const deadline = firstFrame ? bufferingDeadline : startupDeadline;
        if (firstFrame)
          phase('buffering', '正在缓冲，等待后续视频分片…', deadline);
        else setStatus('正在加载首帧，尚未超时…');
        clearTimeout(timer);
        timer = setTimeout(() => fail(), Math.max(0, deadline - Date.now()));
      });
      player.on('video:pause', () => {
        if (firstFrame && !switched && !disposed) {
          clearTimeout(timer);
          bufferingDeadline = 0;
          phase('paused', '播放已暂停，点击继续播放');
        }
      });
    };
    if (alreadyAttempted) {
      fail('该线路已尝试，正在查找下一线路');
    } else if (relayed) {
      phase('authorize', '正在申请独立 Worker 播放授权…', Date.now() + 10000);
      log('向本站请求播放票据，授权成功后才连接源站');
      timer = setTimeout(() => {
        controller.abort();
        fail('代理授权请求超时');
      }, 10000);
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
          const data = await response.json().catch(() => ({
            error: `播放授权失败（HTTP ${response.status}）${
              response.status === 401 ? '，请重新登录' : ''
            }`,
          }));
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
              log('独立代理尚未配置，尝试 HTTPS 直连', true);
            } else fail(data.error || '独立代理尚未配置');
            return;
          }
          if (!response.ok || typeof data.url !== 'string')
            throw new Error(data.error || '独立代理尚未配置');
          if (disposed || switched) return;
          clearTimeout(timer);
          log('播放授权已取得，开始连接独立 Worker');
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
          {connection.phase === 'playing'
            ? 'LIVE'
            : connection.phase === 'error'
            ? '连接失败'
            : '待播放'}
        </span>
      </div>
      <div className='relative'>
        <div
          ref={container}
          className='aspect-video w-full bg-black'
          aria-label={`${channel.name}直播播放器`}
        />
        {!['playing', 'paused', 'ready'].includes(connection.phase) && (
          <div className='pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/75 px-5 text-white'>
            <div className='max-w-md text-center'>
              <p className='text-base font-semibold'>
                {phaseLabels[connection.phase]}
              </p>
              <p className='mt-2 text-sm text-slate-200'>{status}</p>
              {connection.deadline && (
                <p className='mt-3 text-xs text-slate-300'>
                  本阶段已等待{' '}
                  {Math.max(0, (now - connection.since) / 1000).toFixed(1)} 秒 ·
                  剩余最多{' '}
                  {Math.max(0, (connection.deadline - now) / 1000).toFixed(0)}{' '}
                  秒
                </p>
              )}
              {connection.phase === 'error' && (
                <p className='mt-3 text-xs text-amber-200'>
                  下方连接过程保留了错误原因，可重新连接或选择其他频道。
                </p>
              )}
            </div>
          </div>
        )}
      </div>
      <div
        className='border-y border-slate-200/70 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-900'
        aria-label='播放连接过程'
      >
        <div className='mb-2 flex flex-wrap items-center justify-between gap-2 text-xs'>
          <span className='font-semibold text-slate-700 dark:text-slate-200'>
            连接过程 · 线路 {line + 1}/{channel.urls.length}
          </span>
          <span
            className={
              connection.phase === 'error'
                ? 'text-red-600 dark:text-red-400'
                : 'text-sky-600 dark:text-sky-400'
            }
          >
            {phaseLabels[connection.phase]}
          </span>
        </div>
        <div
          ref={logView}
          role='log'
          aria-label='连接事件'
          aria-live='polite'
          className='max-h-36 overflow-y-auto overscroll-contain rounded-lg bg-white p-2 text-xs dark:bg-slate-950'
        >
          <ol className='space-y-1.5'>
            {history.map((entry, index) => (
              <li
                key={index}
                className={`flex items-start gap-2 ${
                  entry.error
                    ? 'text-red-600 dark:text-red-400'
                    : 'text-slate-600 dark:text-slate-300'
                }`}
              >
                <time className='shrink-0 font-mono text-slate-400'>
                  {new Date(entry.at).toLocaleTimeString('zh-CN', {
                    hour12: false,
                  })}
                </time>
                <span className='min-w-0 break-words'>{entry.text}</span>
              </li>
            ))}
          </ol>
        </div>
        <p className='mt-2 text-[11px] text-slate-500'>
          只连接当前线路。临时网络错误会等待后重试；明确失败会记录原因，再尝试转发或备用线路。可随时从频道列表换台。
        </p>
      </div>
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
