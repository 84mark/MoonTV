import {
  firstMeasuredSource,
  measureSourceEpisodes,
  speedKBps,
} from './source-selection';
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
  await new Promise((resolve) => setTimeout(resolve, 0));
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

it('samples the requested and following episode and ranks by the slower speed', async () => {
  const series = {
    ...source('show'),
    episodes: ['one', 'two', 'three', 'four'],
  };
  const probe = jest.fn(async (url: string) =>
    result(url === 'three' ? '2 MB/s' : '400 KB/s')
  );
  const measured = await measureSourceEpisodes(series, probe, 2);
  expect(probe.mock.calls.map((call) => call[0])).toEqual(['three', 'four']);
  expect(measured.loadSpeed).toBe('400 KB/s');
  probe.mockClear();
  await measureSourceEpisodes(series, probe, 3);
  expect(probe.mock.calls.map((call) => call[0])).toEqual(['four']);
  probe.mockClear();
  expect((await measureSourceEpisodes(series, probe, 4)).loadSpeed).toBe(
    '未测得'
  );
  expect(probe).not.toHaveBeenCalled();
});

it('does not reject a measured current episode solely because the successor probe is inconclusive', async () => {
  const series = { ...source('show'), episodes: ['current', 'next'] };
  const probe = async (url: string) =>
    result(url === 'current' ? '1 MB/s' : '未测得');
  expect((await measureSourceEpisodes(series, probe)).loadSpeed).toBe('1 MB/s');
  const missingCurrent = async (url: string) =>
    result(url === 'current' ? '未测得' : '1 MB/s');
  expect((await measureSourceEpisodes(series, missingCurrent)).loadSpeed).toBe(
    '未测得'
  );
});

it('starts a measured current episode while another source remains pending and never probes the successor on the startup path', async () => {
  const slow = deferred();
  const probe = jest.fn((url: string) =>
    url === 'slow-current' ? slow.promise : Promise.resolve(result('1 MB/s'))
  );
  const selected = firstMeasuredSource(
    [
      { ...source('slow'), episodes: ['slow-current', 'slow-next'] },
      { ...source('ready'), episodes: ['ready-current', 'ready-next'] },
    ],
    probe,
    jest.fn(),
    0,
    true
  );
  await expect(selected).resolves.toMatchObject({ id: 'ready' });
  expect(probe.mock.calls.map((call) => call[0])).toEqual([
    'slow-current',
    'ready-current',
  ]);
  slow.resolve(result('10 MB/s'));
});
