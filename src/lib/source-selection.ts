import type { SearchResult } from './types';
import type { VideoProbeResult } from './video-probe';

export function speedKBps(value?: string): number {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(KB\/s|MB\/s)$/i);
  if (!match) return 0;
  const speed =
    Number(match[1]) * (match[2].toUpperCase() === 'MB/S' ? 1024 : 1);
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

/** Start every candidate through the probe's bounded queue; resolve at the first measured result. */
export function firstMeasuredSource(
  sources: SearchResult[],
  probe: (url: string) => Promise<VideoProbeResult>,
  onResult: (source: SearchResult, result: VideoProbeResult) => void
): Promise<SearchResult | null> {
  return new Promise((resolve) => {
    if (!sources.length) {
      resolve(null);
      return;
    }
    let remaining = sources.length;
    for (const source of sources) {
      void (async () => {
        let result: VideoProbeResult;
        try {
          if (!source.episodes[0]) throw new Error('Missing playlist');
          result = await probe(source.episodes[0]);
        } catch {
          result = {
            quality: '未知',
            loadSpeed: '未测得',
            pingTime: 0,
            status: 'unknown',
            latencyKind: null,
            message: '未测得速度',
          };
        }
        onResult(source, result);
        if (speedKBps(result.loadSpeed) > 0) resolve(source);
        if (--remaining === 0) resolve(null);
      })();
    }
  });
}
