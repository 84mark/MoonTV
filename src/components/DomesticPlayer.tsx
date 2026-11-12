'use client';

import type {
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';
import Hls from 'hls.js';
import {
  Maximize,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import {
  DomesticChannel,
  DomesticProgramme,
  isOfficialDirectUrl,
  programmeTime,
} from '@/lib/domestic-live';
import { createLiveLoader } from '@/lib/live-loader';

export interface DomesticWindow {
  start: number;
  end: number;
}
const safeError = (text: string) =>
  text.replace(/https?:\/\/[^\s<>"']+/gi, '[资源地址]').slice(0, 240);
const duration = (seconds: number) =>
  `${Math.floor(Math.max(0, seconds) / 60)}:${String(
    Math.floor(Math.max(0, seconds) % 60)
  ).padStart(2, '0')}`;

export default function DomesticPlayer({
  channel,
  programmes,
  seek,
  onWindow,
}: {
  channel: DomesticChannel;
  programmes: DomesticProgramme[];
  seek: { unix: number; nonce: number } | null;
  onWindow: (window: DomesticWindow | null) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const engine = useRef<Hls | null>(null);
  const [node] = useState(0);
  const [retry, setRetry] = useState(0);
  const [status, setStatus] = useState('正在连接官方直播…');
  const [failed, setFailed] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.7);
  const [quality, setQuality] = useState(-1);
  const [levels, setLevels] = useState<{ height: number; bitrate: number }[]>(
    []
  );
  const [position, setPosition] = useState({
    start: 0,
    end: 0,
    current: 0,
    wall: 0,
  });
  const [events, setEvents] = useState<string[]>([]);
  const [pip, setPip] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const stream = channel.streams[node];
  const currentProgramme = programmes.find(
    (item) => item.start <= Date.now() / 1000 && item.end > Date.now() / 1000
  );
  const nextProgramme = currentProgramme
    ? programmes.find((item) => item.start >= currentProgramme.end)
    : undefined;

  useEffect(() => {
    const media = video.current;
    onWindow(null);
    setPosition({ start: 0, end: 0, current: 0, wall: 0 });
    setEvents([]);
    setFailed(false);
    setPlaying(false);
    setLevels([]);
    setQuality(-1);
    setElapsed(0);
    if (!media || !stream) return;
    let closed = false;
    let started = false;
    let ended = false;
    let bufferDeadline = 0;
    let recovered = false;
    const start = Date.now();
    const deadline = start + 30000;
    let timer: ReturnType<typeof setTimeout>;
    const log = (message: string) => {
      if (!closed)
        setEvents((previous) => [...previous.slice(-19), safeError(message)]);
    };
    const fail = (message: string) => {
      if (closed || ended) return;
      ended = true;
      clearTimeout(timer);
      setStatus(safeError(message));
      setFailed(true);
      setPlaying(false);
      log(message);
      engine.current?.stopLoad();
      media.pause();
    };
    const update = () => {
      if (closed || ended) return;
      const ranges = media.seekable;
      const first = ranges.length ? ranges.start(ranges.length - 1) : 0;
      const last = ranges.length ? ranges.end(ranges.length - 1) : 0;
      const wall = engine.current?.playingDate?.getTime() || 0;
      setPosition({
        start: first,
        end: last,
        current: media.currentTime,
        wall,
      });
      onWindow(
        wall && last > first
          ? {
              start: wall / 1000 + first - media.currentTime,
              end: wall / 1000 + last - media.currentTime,
            }
          : null
      );
      if (!started) setElapsed((Date.now() - start) / 1000);
    };
    const onPlaying = () => {
      if (closed || ended) return;
      clearTimeout(timer);
      bufferDeadline = 0;
      setPlaying(true);
      setStatus('正在直播');
      if (!started)
        log(`首帧已播放 · ${((Date.now() - start) / 1000).toFixed(1)} 秒`);
      started = true;
      update();
    };
    const onPause = () => {
      if (!closed) setPlaying(false);
    };
    const onWaiting = () => {
      if (closed || ended) return;
      setStatus(started ? '正在缓冲，等待后续分片…' : '正在缓冲，等待首帧…');
      if (started && !bufferDeadline) bufferDeadline = Date.now() + 20000;
      clearTimeout(timer);
      timer = setTimeout(
        () =>
          fail(
            started
              ? '缓冲恢复超过 20 秒，请重试或切换频道'
              : '连接超过 30 秒，暂未收到可播放画面'
          ),
        Math.max(0, (started ? bufferDeadline : deadline) - Date.now())
      );
    };
    const onReady = () => {
      if (closed || ended || started || !media.paused) return;
      clearTimeout(timer);
      setStatus('画面已就绪，点击播放');
    };
    const onMediaError = () => {
      if (!engine.current)
        fail(`浏览器无法播放此线路（媒体错误 ${media.error?.code || '未知'}）`);
    };
    media.addEventListener('playing', onPlaying);
    media.addEventListener('pause', onPause);
    media.addEventListener('waiting', onWaiting);
    media.addEventListener('canplay', onReady);
    media.addEventListener('error', onMediaError);
    media.muted = true;
    media.volume = 0.7;
    setMuted(true);
    setVolume(0.7);
    setPip(!!document.pictureInPictureEnabled);
    setStatus('正在连接官方直播…');
    log(`直连 ${new URL(stream.url).hostname} · 连接时限 30 秒`);
    if (!isOfficialDirectUrl(stream.url)) fail('线路不符合官方 HTTPS 直连要求');
    else if (Hls.isSupported()) {
      const BaseLoader = createLiveLoader({
        isActive: () => !closed && !ended,
        deadline: () => deadline,
        log,
      });
      class DirectLoader extends BaseLoader {
        load(
          context: LoaderContext,
          config: LoaderConfiguration,
          callbacks: LoaderCallbacks<LoaderContext>
        ) {
          if (!isOfficialDirectUrl(context.url)) {
            callbacks.onError(
              { code: 400, text: '此资源不属于已核验的官方直连域名' },
              context,
              null,
              this.stats
            );
            return;
          }
          super.load(context, config, callbacks);
        }
      }
      const policy = {
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
      const hls = new Hls({
        loader: DirectLoader,
        fetchSetup: (context, init) =>
          new Request(context.url, {
            ...init,
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
          }),
        maxBufferLength: 12,
        backBufferLength: 30,
        liveSyncDurationCount: 3,
        manifestLoadPolicy: policy,
        playlistLoadPolicy: policy,
        fragLoadPolicy: policy,
      });
      engine.current = hls;
      hls.on(Hls.Events.MANIFEST_LOADED, () => {
        if (!closed && !ended) {
          setStatus('清单已返回，正在加载视频…');
          log('官方播放清单已返回');
        }
      });
      hls.on(Hls.Events.MANIFEST_PARSED, (_, data) => {
        if (!closed)
          setLevels(
            data.levels.map((level) => ({
              height: level.height,
              bitrate: level.bitrate,
            }))
          );
      });
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (closed || ended) return;
        const reason = `${
          /frag|key/i.test(data.details)
            ? '视频分片'
            : /manifest|level/i.test(data.details)
            ? '播放清单'
            : '视频解码'
        }异常${data.response?.code ? `（HTTP ${data.response.code}）` : ''} · ${
          data.details
        }`;
        if (data.fatal) {
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true;
            log(`${reason}，尝试恢复解码器`);
            hls.recoverMediaError();
          } else fail(reason);
        } else if (/LoadError|LoadTimeOut/.test(data.details)) log(reason);
      });
      hls.attachMedia(media);
      hls.loadSource(stream.url);
    } else if (media.canPlayType('application/vnd.apple.mpegurl')) {
      media.src = stream.url;
      log('使用浏览器原生 HLS 播放');
    } else fail('当前浏览器不支持此直播格式');
    if (!ended) {
      timer = setTimeout(
        () => fail('连接超过 30 秒，暂未收到可播放画面'),
        30000
      );
      void media.play().catch(() => {
        if (!closed) setStatus('点击播放按钮开始观看');
      });
    }
    const clock = setInterval(update, 500);
    return () => {
      closed = true;
      clearTimeout(timer);
      clearInterval(clock);
      media.removeEventListener('playing', onPlaying);
      media.removeEventListener('pause', onPause);
      media.removeEventListener('waiting', onWaiting);
      media.removeEventListener('canplay', onReady);
      media.removeEventListener('error', onMediaError);
      engine.current?.destroy();
      engine.current = null;
      media.pause();
      media.removeAttribute('src');
      media.load();
    };
  }, [channel.id, stream, retry, onWindow]);

  useEffect(() => {
    const media = video.current;
    if (!media || !seek || !position.wall) return;
    const target =
      media.currentTime + (seek.unix * 1000 - position.wall) / 1000;
    const range = media.seekable;
    if (
      range.length &&
      target >= range.start(range.length - 1) &&
      target < range.end(range.length - 1)
    ) {
      media.currentTime = target;
      void media.play().catch(() => undefined);
    }
    // A programme click is a one-off seek, not a command to repeat on every clock tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seek]);

  const toggle = () => {
    const media = video.current;
    if (!media) return;
    if (media.paused)
      void media.play().catch(() => setStatus('浏览器暂未允许播放，请重试'));
    else media.pause();
  };
  const available = !!stream;
  const hasWindow = available && position.end - position.start > 2;
  const atLive = position.end - position.current < 8;
  return (
    <div className='domestic-player' ref={root}>
      <div className='domestic-picture'>
        {available && (
          <video
            ref={video}
            muted
            playsInline
            autoPlay
            aria-label={`${channel.name}直播画面`}
          />
        )}
        <span className='domestic-channel-watermark'>{channel.name}</span>
        {pip && available && (
          <button
            className='domestic-pip'
            onClick={() => {
              const media = video.current;
              if (media?.readyState && media.requestPictureInPicture)
                void media
                  .requestPictureInPicture()
                  .catch(() => setStatus('当前浏览器暂不允许画中画'));
            }}
          >
            <PictureInPicture2 size={19} />
            画中画
          </button>
        )}
        {!available ? (
          <div className='domestic-message'>
            <span className='domestic-unavailable'>暂无可用直连</span>
            <h2>{channel.name}</h2>
            <p>{channel.unavailableReason}</p>
            <p className='domestic-message-hint'>
              可从右侧选择标有“可播放”的频道。节目单仍可查看。
            </p>
          </div>
        ) : (
          !playing && (
            <div className='domestic-message' aria-live='polite'>
              <h2>{failed ? '连接暂未成功' : status}</h2>
              {failed ? (
                <p role='alert'>{status}。此栏目不会转发播放信号。</p>
              ) : (
                <p>已等待 {elapsed.toFixed(1)} 秒 · 官方直连</p>
              )}
              <button
                className='domestic-big-play'
                aria-label={failed ? '重试官方线路' : '播放直播'}
                onClick={() =>
                  failed ? setRetry((value) => value + 1) : toggle()
                }
              >
                {failed ? (
                  <RotateCcw size={30} />
                ) : (
                  <Play fill='currentColor' size={30} />
                )}
              </button>
            </div>
          )
        )}
        <div className='domestic-video-bottom'>
          <div className='domestic-timeline-heading'>
            <span>
              {position.wall
                ? programmeTime(position.wall / 1000)
                : '直播时间轴'}
            </span>
            <span>
              {hasWindow
                ? `可回看当前直播窗口 · ${duration(
                    position.end - position.start
                  )}`
                : '当前暂无可回看窗口'}
            </span>
          </div>
          <input
            aria-label='直播时移进度'
            className='domestic-seek'
            type='range'
            min={position.start}
            max={Math.max(position.end, position.start + 1)}
            step='0.1'
            value={Math.max(
              position.start,
              Math.min(position.current, position.end || 1)
            )}
            disabled={!hasWindow}
            onChange={(event) => {
              if (video.current)
                video.current.currentTime = Number(event.target.value);
            }}
          />
          <div className='domestic-programme-strip'>
            <span className='domestic-today'>
              今日
              <br />
              {chinaMonthDay()}
            </span>
            <span className='domestic-programme-current'>
              {currentProgramme?.title ||
                (available ? channel.name : '暂无站内播放线路')}
            </span>
            <span>
              {nextProgramme ? `接下来 · ${nextProgramme.title}` : '官方直播'}
            </span>
          </div>
          <div className='domestic-controls'>
            <button
              aria-label={playing ? '暂停直播' : '播放直播'}
              disabled={!available || failed}
              onClick={toggle}
            >
              {playing ? (
                <Pause fill='currentColor' size={22} />
              ) : (
                <Play fill='currentColor' size={22} />
              )}
            </button>
            <span className='domestic-live-state'>
              {available
                ? playing
                  ? '正在播放'
                  : failed
                  ? '连接失败'
                  : '等待播放'
                : '暂不可用'}
            </span>
            <button
              className='domestic-return-live'
              disabled={!hasWindow}
              onClick={() => {
                if (video.current) {
                  video.current.currentTime = Math.max(
                    position.start,
                    position.end - 2
                  );
                  void video.current.play().catch(() => undefined);
                }
              }}
            >
              {!hasWindow || atLive ? '直播' : '返回直播'}
            </button>
            <select
              aria-label='选择直播画质'
              disabled={!levels.length}
              value={quality}
              onChange={(event) => {
                const value = Number(event.target.value);
                setQuality(value);
                if (engine.current) engine.current.currentLevel = value;
              }}
            >
              <option value={-1}>自动</option>
              {levels.map((level, index) => (
                <option value={index} key={index}>
                  {level.height
                    ? `${level.height}P`
                    : `${Math.round(level.bitrate / 1000)}K`}
                </option>
              ))}
            </select>
            <button
              aria-label={muted ? '开启直播声音' : '静音直播'}
              disabled={!available}
              onClick={() => {
                if (video.current) {
                  video.current.muted = !muted;
                  setMuted(!muted);
                }
              }}
            >
              {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input
              className='domestic-volume'
              type='range'
              min='0'
              max='1'
              step='0.05'
              value={muted ? 0 : volume}
              disabled={!available}
              aria-label='直播音量'
              onChange={(event) => {
                const value = Number(event.target.value);
                setVolume(value);
                setMuted(value === 0);
                if (video.current) {
                  video.current.volume = value;
                  video.current.muted = value === 0;
                }
              }}
            />
            <button
              aria-label='全屏播放'
              onClick={() => {
                if (document.fullscreenElement)
                  void document.exitFullscreen().catch(() => undefined);
                else
                  void root.current
                    ?.requestFullscreen?.()
                    .catch(() => undefined);
              }}
            >
              <Maximize size={20} />
            </button>
          </div>
        </div>
      </div>
      <div className='domestic-player-footer'>
        <span>
          <span className='domestic-direct-dot' />
          官方直连
        </span>
        <span>
          {stream
            ? `${new URL(stream.url).hostname} · ${status}`
            : '播放能力待验证'}
        </span>
        {available && (
          <details>
            <summary>连接记录</summary>
            <ol>
              {events.map((event, index) => (
                <li key={index}>{event}</li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </div>
  );
}
function chinaMonthDay() {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
