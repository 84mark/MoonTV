import type { SearchResult } from './types';
import type { VideoProbeResult } from './video-probe';

export function speedKBps(value?: string): number {
  const match = value?.trim().match(/^(\d+(?:\.\d+)?)\s*(KB\/s|MB\/s)$/i);
  if (!match) return 0;
  const speed =
    Number(match[1]) * (match[2].toUpperCase() === 'MB/S' ? 1024 : 1);
  return Number.isFinite(speed) && speed > 0 ? speed : 0;
}

const unmeasured = (): VideoProbeResult => ({
  quality: '未知',
  loadSpeed: '未测得',
  pingTime: 0,
  status: 'unknown',
  latencyKind: null,
  message: '目标集未测得速度',
});

/** Compare the requested episode and its successor, using the slower sample. */
export async function measureSourceEpisodes(
  source: SearchResult,
  probe: (url: string) => Promise<VideoProbeResult>,
  episodeIndex = 0
): Promise<VideoProbeResult> {
  if (!source.episodes[episodeIndex]) return unmeasured();
  const urls = source.episodes.slice(episodeIndex, episodeIndex + 2);
  try {
    const results = await Promise.all(
      urls.map((url) => probe(url).catch(unmeasured))
    );
    // An unmeasurable successor must not suppress a measured current episode.
    if (speedKBps(results[0].loadSpeed) <= 0) return results[0];
    return results
      .filter((result) => speedKBps(result.loadSpeed) > 0)
      .reduce((slowest, result) =>
        speedKBps(result.loadSpeed) < speedKBps(slowest.loadSpeed)
          ? result
          : slowest
      );
  } catch {
    return unmeasured();
  }
}

/** Start every candidate through the probe's bounded queue; resolve at the first measured result. */
export function firstMeasuredSource(
  sources: SearchResult[],
  probe: (url: string) => Promise<VideoProbeResult>,
  onResult: (source: SearchResult, result: VideoProbeResult) => void,
  episodeIndex = 0
): Promise<SearchResult | null> {
  return new Promise((resolve) => {
    if (!sources.length) {
      resolve(null);
      return;
    }
    let remaining = sources.length;
    for (const source of sources) {
      void (async () => {
        const result = await measureSourceEpisodes(source, probe, episodeIndex);
        onResult(source, result);
        if (speedKBps(result.loadSpeed) > 0) resolve(source);
        if (--remaining === 0) resolve(null);
      })();
    }
  });
}
