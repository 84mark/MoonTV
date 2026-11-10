import { probeLiveSources } from './live-probe';
import type { VideoProbeResult } from './video-probe';
import { getVideoResolutionFromM3u8 } from './video-probe';

jest.mock('./video-probe', () => ({ getVideoResolutionFromM3u8: jest.fn() }));
const probe = getVideoResolutionFromM3u8 as jest.Mock;
const result = (
  loadSpeed: string,
  status: VideoProbeResult['status'] = 'reachable'
): VideoProbeResult => ({
  loadSpeed,
  status,
  quality: '未知',
  pingTime: 0,
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
beforeEach(() => probe.mockReset());

it('starts every source through the shared probe and resolves the first real sample without waiting for slower sources', async () => {
  const a = deferred();
  const b = deferred();
  probe.mockImplementation((url) => (url === 'a' ? a.promise : b.promise));
  const update = jest.fn();
  const session = probeLiveSources(['a', 'b'], update);
  expect(probe).toHaveBeenCalledTimes(2);
  b.resolve(result('150 KB/s'));
  await expect(session.ready).resolves.toBe(1);
  expect(update).toHaveBeenCalledWith(1, result('150 KB/s'));
  a.resolve(result('5 MB/s'));
  await Promise.resolve();
  expect(update).toHaveBeenCalledWith(0, result('5 MB/s'));
  await expect(session.ready).resolves.toBe(1);
});
it('accepts confirmed native playback with no exposed byte speed, but never promotes a merely reachable playlist', async () => {
  const decoded = deferred();
  probe.mockImplementation((url) =>
    url === 'playlist' ? Promise.resolve(result('未测得')) : decoded.promise
  );
  const session = probeLiveSources(['playlist', 'native'], jest.fn());
  const ready = jest.fn();
  session.ready.then(ready);
  await Promise.resolve();
  await Promise.resolve();
  expect(ready).not.toHaveBeenCalled();
  decoded.resolve(result('未测得', 'playable'));
  await expect(session.ready).resolves.toBe(1);
});
it('returns null after all samples are inconclusive or reject, preserving honest unknown metrics', async () => {
  probe
    .mockResolvedValueOnce(result('0 KB/s'))
    .mockRejectedValueOnce(new Error('network'));
  const update = jest.fn();
  await expect(probeLiveSources(['a', 'b'], update).ready).resolves.toBeNull();
  expect(update).toHaveBeenCalledWith(
    1,
    expect.objectContaining({ status: 'unknown', loadSpeed: '未测得' })
  );
  await expect(probeLiveSources([], jest.fn()).ready).resolves.toBeNull();
});
it('cancels readiness and detaches late callbacks without cancelling the shared promises', async () => {
  const pending = deferred();
  probe.mockReturnValue(pending.promise);
  const update = jest.fn();
  const session = probeLiveSources(['a'], update);
  session.cancel();
  await expect(session.ready).resolves.toBeNull();
  pending.resolve(result('1 MB/s'));
  await Promise.resolve();
  expect(update).not.toHaveBeenCalled();
});
it('forwards the short sampling timeout and force option to the existing cache-aware media probe', async () => {
  probe.mockResolvedValue(result('1 MB/s'));
  await probeLiveSources(['fresh'], jest.fn(), { force: true }).ready;
  expect(probe).toHaveBeenCalledWith('fresh', { timeoutMs: 3500, force: true });
});
