import { speedKBps } from './source-selection';
import type { VideoProbeResult } from './video-probe';
import { getVideoResolutionFromM3u8 } from './video-probe';

const unmeasured = (): VideoProbeResult => ({
  quality: '未知',
  loadSpeed: '未测得',
  pingTime: 0,
  status: 'unknown',
  latencyKind: null,
  message: '本次直播短时采样未完成，可尝试直接播放',
});

/**
 * Reuse the film probe's real media-byte samples, three-slot queue and cache.
 * A short sample is not a sustained bandwidth guarantee. The first measured or
 * decoded source may start playback; later results update the source list only.
 * Cancel detaches this consumer without cancelling shared underlying probes.
 */
export function probeLiveSources(
  urls: string[],
  onResult: (index: number, result: VideoProbeResult) => void,
  options: { force?: boolean } = {}
): { ready: Promise<number | null>; cancel: () => void } {
  let cancelled = false;
  let remaining = urls.length;
  let resolveReady!: (index: number | null) => void;
  const ready = new Promise<number | null>((resolve) => {
    resolveReady = resolve;
  });
  if (!remaining) resolveReady(null);
  urls.forEach((url, index) => {
    void (async () => {
      let result: VideoProbeResult;
      try {
        result = await getVideoResolutionFromM3u8(url, {
          timeoutMs: 3500,
          force: options.force,
        });
      } catch {
        result = unmeasured();
      }
      if (cancelled) return;
      // Resolve before notifying so a consumer's rendering cannot delay startup.
      if (speedKBps(result.loadSpeed) > 0 || result.status === 'playable')
        resolveReady(index);
      if (--remaining === 0) resolveReady(null);
      onResult(index, result);
    })();
  });
  return {
    ready,
    cancel() {
      cancelled = true;
      resolveReady(null);
    },
  };
}
