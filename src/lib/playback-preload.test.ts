import { getPreparedPlayback, preparePlayback } from './playback-preload';
import type { SearchResult } from './types';
import type { VideoProbeResult } from './video-probe';
import { getVideoResolutionFromM3u8 } from './video-probe';

jest.mock('./video-probe', () => ({ getVideoResolutionFromM3u8: jest.fn() }));
const a: SearchResult = {
  id: '1',
  source: 'a',
  source_name: 'A',
  title: '测试影片',
  year: '2026',
  poster: '',
  episodes: ['a'],
};
const b = { ...a, source: 'b', source_name: 'B', episodes: ['b'] };
const result = (loadSpeed: string): VideoProbeResult => ({
  loadSpeed,
  quality: '720p',
  pingTime: 50,
  status: 'playable',
  latencyKind: 'response',
  message: '',
});
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const response = (results: SearchResult[]) => ({
  ok: true,
  json: async () => ({ results }),
});
const query = 'title=' + encodeURIComponent(a.title) + '&year=2026';
beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue(response([a, b]));
  (getVideoResolutionFromM3u8 as jest.Mock).mockReset();
});
it('keeps the first measured result while testing, chooses fastest after completion, and hands the snapshot to playback', async () => {
  let finishA!: (value: VideoProbeResult) => void;
  let finishB!: (value: VideoProbeResult) => void;
  (getVideoResolutionFromM3u8 as jest.Mock).mockImplementation(
    (url) =>
      new Promise((resolve) => {
        if (url === 'a') finishA = resolve;
        else finishB = resolve;
      })
  );
  const session = preparePlayback(query);
  const listener = jest.fn();
  const unsubscribe = session.subscribe(listener);
  expect(session.snapshot.status).toBe('searching');
  expect(session.snapshot.selected).toBeNull();
  await flush();
  expect(session.snapshot.status).toBe('testing');
  finishB(result('100 KB/s'));
  await flush();
  expect(session.snapshot.status).toBe('testing');
  expect(session.snapshot.selected?.source).toBe('b');
  finishA(result('2 MB/s'));
  await flush();
  expect(session.snapshot.status).toBe('complete');
  expect(session.snapshot.firstSource?.source).toBe('b');
  expect(session.snapshot.selected?.source).toBe('a');
  expect(getPreparedPlayback(session.id)?.snapshot).toBe(session.snapshot);
  expect(getVideoResolutionFromM3u8).toHaveBeenCalledTimes(2);
  unsubscribe();
  expect(listener).toHaveBeenCalled();
});
it('marks all-unmeasured results complete with no selected source and forces fresh probes on retry', async () => {
  (getVideoResolutionFromM3u8 as jest.Mock).mockResolvedValue(result('未测得'));
  const first = preparePlayback(query);
  await flush();
  expect(first.snapshot).toMatchObject({
    status: 'complete',
    selected: null,
    completed: 2,
  });
  const retry = preparePlayback(query, true);
  await flush();
  expect(retry.id).not.toBe(first.id);
  expect(getVideoResolutionFromM3u8).toHaveBeenCalledWith('a', { force: true });
});
it('keeps normal playback available on a search error and distinguishes an empty successful search', async () => {
  (fetch as jest.Mock).mockRejectedValueOnce(new Error('network'));
  const failed = preparePlayback(query);
  await flush();
  expect(failed.snapshot.status).toBe('error');
  (fetch as jest.Mock).mockResolvedValueOnce(response([]));
  const empty = preparePlayback(query);
  await flush();
  expect(empty.snapshot).toMatchObject({ status: 'complete', selected: null });
});
it('filters wrong years/titles and preserves a specifically selected source with detail fallback', async () => {
  (fetch as jest.Mock)
    .mockResolvedValueOnce(
      response([
        { ...a, year: '2025' },
        { ...b, title: '其他电影' },
      ])
    )
    .mockResolvedValueOnce({ ok: true, json: async () => a });
  (getVideoResolutionFromM3u8 as jest.Mock).mockResolvedValue(result('1 MB/s'));
  const session = preparePlayback(query + '&source=a&id=1');
  await flush();
  expect(session.snapshot.sources).toEqual([a]);
  expect(session.snapshot.selected?.source).toBe('a');
  expect(fetch).toHaveBeenLastCalledWith('/api/detail?source=a&id=1', {
    cache: 'no-store',
  });
});
