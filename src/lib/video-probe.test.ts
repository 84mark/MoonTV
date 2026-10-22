import Hls from 'hls.js';

import { getVideoResolutionFromM3u8 } from './video-probe';

jest.mock('hls.js', () => ({ __esModule: true, default: jest.fn() }));

interface FakeHls {
  emit: (event: string, data?: unknown) => void;
  destroy: jest.Mock;
  loadSource: jest.Mock;
  attachMedia: jest.Mock;
  recoverMediaError: jest.Mock;
}
const hlsConstructor = Hls as unknown as jest.Mock;
let videos: HTMLVideoElement[];
let native = false;
let count = 0;
const url = () => `https://example.com/video-${count++}.m3u8`;
const instance = (index = 0) =>
  hlsConstructor.mock.results[index].value as FakeHls;

beforeEach(() => {
  videos = [];
  native = false;
  jest.useFakeTimers();
  hlsConstructor.mockReset();
  Object.assign(Hls, {
    isSupported: () => true,
    Events: {
      MANIFEST_LOADED: 'manifest',
      FRAG_LOADING: 'fragment-loading',
      FRAG_LOADED: 'fragment',
      FRAG_BUFFERED: 'buffered',
      ERROR: 'error',
    },
    ErrorTypes: { MEDIA_ERROR: 'media' },
  });
  hlsConstructor.mockImplementation(() => {
    const handlers = new Map<string, (event: string, data: unknown) => void>();
    return {
      on: (event: string, callback: (event: string, data: unknown) => void) =>
        handlers.set(event, callback),
      emit: (event: string, data: unknown) =>
        handlers.get(event)?.(event, data),
      destroy: jest.fn(),
      loadSource: jest.fn(),
      attachMedia: jest.fn(),
      recoverMediaError: jest.fn(),
    };
  });
  const create = document.createElement.bind(document);
  jest.spyOn(document, 'createElement').mockImplementation((tag, options) => {
    const element = create(tag, options);
    if (tag === 'video') {
      const video = element as HTMLVideoElement;
      video.canPlayType = jest.fn(() => (native ? 'probably' : ''));
      video.pause = jest.fn();
      video.load = jest.fn();
      Object.defineProperty(video, 'videoWidth', { value: 1920 });
      videos.push(video);
    }
    return element;
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

it('supports native HLS without requiring hls.js or fabricating segment speed', async () => {
  native = true;
  Object.assign(Hls, { isSupported: () => false });
  const promise = getVideoResolutionFromM3u8(url());
  videos[0].dispatchEvent(new Event('canplay'));
  expect(await promise).toMatchObject({
    status: 'playable',
    quality: '1080p',
    loadSpeed: '未测得',
    latencyKind: 'metadata',
  });
  expect(hlsConstructor).not.toHaveBeenCalled();
  expect(videos[0].pause).toHaveBeenCalled();
  expect(videos[0].hasAttribute('src')).toBe(false);
});

it('allows a slow playable source more than four seconds and measures real GET timings', async () => {
  const promise = getVideoResolutionFromM3u8(url());
  jest.advanceTimersByTime(5000);
  expect(instance().destroy).not.toHaveBeenCalled();
  instance().emit('manifest', {
    stats: { loading: { start: 100, first: 150 } },
  });
  instance().emit('fragment', {
    payload: new Uint8Array(65536),
    frag: { stats: { loading: { start: 100, first: 150, end: 1150 } } },
  });
  videos[0].dispatchEvent(new Event('canplay'));
  expect(await promise).toMatchObject({
    status: 'playable',
    loadSpeed: '64.0 KB/s',
    pingTime: 50,
    latencyKind: 'response',
  });
  expect(instance().destroy).toHaveBeenCalledTimes(1);
});

it('does not mark a playable video as failed when bandwidth cannot be measured', async () => {
  const promise = getVideoResolutionFromM3u8(url());
  videos[0].dispatchEvent(new Event('canplay'));
  jest.advanceTimersByTime(600);
  expect(await promise).toMatchObject({
    status: 'playable',
    loadSpeed: '未测得',
  });
});

it('returns unknown for CORS/network preflight failures and releases the media resources', async () => {
  const promise = getVideoResolutionFromM3u8(url());
  instance().emit('error', { fatal: true, type: 'network' });
  expect(await promise).toMatchObject({
    status: 'unknown',
    loadSpeed: '未测得',
    pingTime: 0,
  });
  expect(instance().destroy).toHaveBeenCalledTimes(1);
});

it('distinguishes a reachable playlist from verified playback on timeout', async () => {
  const promise = getVideoResolutionFromM3u8(url());
  instance().emit('manifest', { stats: { loading: { start: 10, first: 30 } } });
  jest.advanceTimersByTime(12000);
  expect(await promise).toMatchObject({ status: 'reachable', pingTime: 20 });
});

it('deduplicates overlapping probes and caches completed measurements', async () => {
  const target = url();
  const first = getVideoResolutionFromM3u8(target);
  const second = getVideoResolutionFromM3u8(target);
  expect(first).toBe(second);
  instance().emit('error', { fatal: true, type: 'network' });
  await first;
  await getVideoResolutionFromM3u8(target);
  expect(hlsConstructor).toHaveBeenCalledTimes(1);
  const retry = getVideoResolutionFromM3u8(target, { force: true });
  instance(1).emit('error', { fatal: true, type: 'network' });
  await retry;
  expect(hlsConstructor).toHaveBeenCalledTimes(2);
});

it('limits simultaneous media probes to three', async () => {
  const promises = Array.from({ length: 5 }, () =>
    getVideoResolutionFromM3u8(url())
  );
  expect(hlsConstructor).toHaveBeenCalledTimes(3);
  instance().emit('error', { fatal: true, type: 'network' });
  await promises[0];
  expect(hlsConstructor).toHaveBeenCalledTimes(4);
  instance(1).emit('error', { fatal: true, type: 'network' });
  instance(2).emit('error', { fatal: true, type: 'network' });
  instance(3).emit('error', { fatal: true, type: 'network' });
  await Promise.resolve();
  await Promise.resolve();
  instance(4).emit('error', { fatal: true, type: 'network' });
  await Promise.all(promises);
});
