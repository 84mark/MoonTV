import { firstMeasuredSource, speedKBps } from './source-selection';
import type { SearchResult } from './types';
import type { VideoProbeResult } from './video-probe';
const source = (id: string): SearchResult => ({
  id,
  source: id,
  source_name: id,
  title: '电影',
  year: '',
  poster: '',
  episodes: [id],
});
const result = (loadSpeed: string): VideoProbeResult => ({
  loadSpeed,
  quality: '未知',
  pingTime: 0,
  status: 'reachable',
  latencyKind: null,
  message: '',
});
function deferred() {
  let resolve!: (value: VideoProbeResult) => void;
  const promise = new Promise<VideoProbeResult>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
it('compares KB/s and MB/s numerically and rejects missing/zero speeds', () => {
  expect(speedKBps('1.5 MB/s')).toBe(1536);
  expect(speedKBps('900 KB/s')).toBe(900);
  for (const value of [
    '未测得',
    '未知',
    '0 KB/s',
    '-1 MB/s',
    'NaN MB/s',
    undefined,
  ])
    expect(speedKBps(value)).toBe(0);
});
it('starts every source and selects the first measured completion instead of waiting for the first array item', async () => {
  const a = deferred();
  const b = deferred();
  const c = deferred();
  const d = deferred();
  const pending = [a, b, c, d];
  const probe = jest.fn((url: string) => pending[Number(url)].promise);
  const updates = jest.fn();
  const chosen = firstMeasuredSource(
    ['0', '1', '2', '3'].map(source),
    probe,
    updates
  );
  expect(probe).toHaveBeenCalledTimes(4);
  a.resolve(result('未测得'));
  d.resolve(result('100 KB/s'));
  await expect(chosen).resolves.toMatchObject({ id: '3' });
  b.resolve(result('5 MB/s'));
  c.resolve(result('1 MB/s'));
  await Promise.resolve();
  expect(updates).toHaveBeenCalledTimes(4);
  await expect(chosen).resolves.toMatchObject({ id: '3' });
});
it('waits for all results before declaring every source unavailable', async () => {
  const a = deferred();
  const b = deferred();
  const finished = jest.fn();
  const chosen = firstMeasuredSource(
    [source('a'), source('b')],
    (url) => (url === 'a' ? a.promise : b.promise),
    jest.fn()
  );
  chosen.then(finished);
  a.resolve(result('未测得'));
  await Promise.resolve();
  expect(finished).not.toHaveBeenCalled();
  b.resolve(result('0 MB/s'));
  await expect(chosen).resolves.toBeNull();
});
it('handles rejected probes and an empty source list', async () => {
  await expect(
    firstMeasuredSource(
      [source('a')],
      async () => {
        throw new Error('network');
      },
      jest.fn()
    )
  ).resolves.toBeNull();
  await expect(
    firstMeasuredSource([], jest.fn(), jest.fn())
  ).resolves.toBeNull();
});
