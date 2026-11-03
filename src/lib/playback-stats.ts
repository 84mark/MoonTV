export function bufferedAhead(
  video: Pick<HTMLVideoElement, 'buffered' | 'currentTime'>
): number {
  for (let i = 0; i < video.buffered.length; i++) {
    if (
      video.buffered.start(i) <= video.currentTime &&
      video.buffered.end(i) >= video.currentTime
    )
      return Math.max(0, video.buffered.end(i) - video.currentTime);
  }
  return 0;
}
type DownloadStats = { loaded: number; loading: { end: number } };
/** Read HLS loader byte counters, including partial fragments, without another download. */
export class DownloadMeter {
  available = false;
  private samples = new Map<DownloadStats, number>();
  track(stats: DownloadStats) {
    if (!this.samples.has(stats)) this.samples.set(stats, 0);
  }
  sample(seconds: number): number {
    let bytes = 0;
    this.samples.forEach((previous, stats) => {
      bytes += Math.max(0, stats.loaded - previous);
      if (stats.loading.end) this.samples.delete(stats);
      else this.samples.set(stats, stats.loaded);
    });
    return seconds > 0 ? bytes / seconds : 0;
  }
  reset() {
    this.samples.clear();
    this.available = false;
  }
}
