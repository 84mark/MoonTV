import Hls from 'hls.js';

export interface VideoProbeResult {
  quality: string;
  loadSpeed: string;
  /** Compatibility field; 0 means unmeasured, never a real zero-latency result. */
  pingTime: number;
  status: 'playable' | 'reachable' | 'unknown';
  latencyKind: 'response' | 'metadata' | null;
  message: string;
}

const cache = new Map<string, { at: number; result: VideoProbeResult }>();
const pending = new Map<string, Promise<VideoProbeResult>>();
let active = 0;
const queue: (() => void)[] = [];

export function qualityForWidth(width: number): string {
  return width >= 3840
    ? '4K'
    : width >= 2560
    ? '2K'
    : width >= 1920
    ? '1080p'
    : width >= 1280
    ? '720p'
    : width >= 854
    ? '480p'
    : width > 0
    ? 'SD'
    : '未知';
}

/** Sample the same browser media path as playback; a missing measurement is not failure. */
function probe(url: string, timeoutMs: number): Promise<VideoProbeResult> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    let hls: Hls | null = null;
    let settled = false;
    let reachable = false;
    let playable = false;
    let recovered = false;
    let quality = '未知';
    let latency = 0;
    let latencyKind: VideoProbeResult['latencyKind'] = null;
    let totalBytes = 0;
    let totalMilliseconds = 0;
    let fragmentStarted = 0;
    let graceTimer: ReturnType<typeof setTimeout> | undefined;
    const started = performance.now();

    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      video.onloadedmetadata =
        video.onloadeddata =
        video.oncanplay =
        video.onerror =
          null;
      hls?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      const kbps =
        totalMilliseconds > 0
          ? totalBytes / 1024 / (totalMilliseconds / 1000)
          : 0;
      resolve({
        quality,
        loadSpeed:
          kbps > 0
            ? kbps >= 1024
              ? `${(kbps / 1024).toFixed(1)} MB/s`
              : `${kbps.toFixed(1)} KB/s`
            : '未测得',
        pingTime: latency,
        status: playable ? 'playable' : reachable ? 'reachable' : 'unknown',
        latencyKind,
        message: playable
          ? '首集预检可播放；测速为短时采样'
          : reachable
          ? '已取得播放列表或分片，尚未确认解码；可尝试播放'
          : '浏览器预检未完成，可能受跨域、超时或格式影响；可尝试播放',
      });
    };
    const timer = setTimeout(finish, timeoutMs);

    const metadata = () => {
      quality = qualityForWidth(video.videoWidth);
      reachable = true;
      if (!latency) {
        latency = Math.max(1, Math.round(performance.now() - started));
        latencyKind = 'metadata';
      }
    };
    const ready = () => {
      metadata();
      playable = true;
      // Native HLS cannot expose segment byte counts. Do not wait for a metric
      // the browser will never provide, or claim a made-up download speed.
      if (totalBytes || !hls) finish();
      else if (!graceTimer) graceTimer = setTimeout(finish, 600);
    };
    video.onloadedmetadata = metadata;
    video.onloadeddata = ready;
    video.oncanplay = ready;
    video.onerror = finish;

    try {
      // Match Artplayer's path: prefer hls.js where MSE is supported, so we can
      // observe actual segment timings; native HLS is the fallback on iOS etc.
      if (Hls.isSupported()) {
        hls = new Hls({
          maxBufferLength: 2,
          maxMaxBufferLength: 4,
          maxBufferSize: 2 * 1024 * 1024,
          backBufferLength: 0,
        });
        hls.on(Hls.Events.MANIFEST_LOADED, (_event, data) => {
          reachable = true;
          const { start, first } = data.stats.loading;
          if (first > start) {
            latency = Math.max(1, Math.round(first - start));
            latencyKind = 'response';
          }
        });
        hls.on(Hls.Events.FRAG_LOADING, () => {
          fragmentStarted = performance.now();
        });
        hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
          reachable = true;
          const { start, first, end } = data.frag.stats.loading;
          const duration =
            end > first && first >= start
              ? end - first
              : performance.now() - fragmentStarted;
          if (duration > 0) {
            totalBytes += data.payload.byteLength;
            totalMilliseconds += duration;
          }
          if (playable) finish();
        });
        hls.on(Hls.Events.FRAG_BUFFERED, () => {
          if (video.readyState >= 2) ready();
        });
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR && !recovered) {
            recovered = true;
            hls?.recoverMediaError();
          } else finish();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.load();
      } else finish();
    } catch {
      finish();
    }
  });
}

export function getVideoResolutionFromM3u8(
  url: string,
  options: { force?: boolean; timeoutMs?: number } = {}
): Promise<VideoProbeResult> {
  const saved = cache.get(url);
  const ttl = saved?.result.status === 'playable' ? 60000 : 10000;
  if (!options.force && saved && Date.now() - saved.at < ttl)
    return Promise.resolve(saved.result);
  const existing = pending.get(url);
  if (existing) return existing;
  const promise = (async () => {
    if (active >= 3) await new Promise<void>((resolve) => queue.push(resolve));
    else active++;
    try {
      const result = await probe(url, options.timeoutMs || 12000);
      if (cache.size >= 100) cache.delete(cache.keys().next().value as string);
      cache.set(url, { result, at: Date.now() });
      return result;
    } finally {
      const next = queue.shift();
      if (next) next();
      else active--;
      pending.delete(url);
    }
  })();
  pending.set(url, promise);
  return promise;
}
