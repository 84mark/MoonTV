import { bufferedAhead, DownloadMeter } from './playback-stats';

it('counts actual bytes per elapsed second including partial downloads and idle gaps', () => {
  const meter = new DownloadMeter();
  const stats = { loaded: 1024, loading: { end: 0 } };
  meter.track(stats);
  expect(meter.sample(1)).toBe(1024);
  stats.loaded = 4096;
  expect(meter.sample(2)).toBe(1536);
  expect(meter.sample(1)).toBe(0);
  stats.loaded = 5120;
  stats.loading.end = 100;
  expect(meter.sample(1)).toBe(1024);
  expect(meter.sample(1)).toBe(0);
  meter.available = true;
  meter.reset();
  expect(meter.available).toBe(false);
});
it('reports only contiguous buffer ahead of playback, excluding future gaps and watched time', () => {
  const buffered = {
    length: 2,
    start: (i: number) => [0, 30][i],
    end: (i: number) => [20, 40][i],
  };
  expect(bufferedAhead({ buffered, currentTime: 12 })).toBe(8);
  expect(bufferedAhead({ buffered, currentTime: 25 })).toBe(0);
  expect(bufferedAhead({ buffered, currentTime: 35 })).toBe(5);
});
