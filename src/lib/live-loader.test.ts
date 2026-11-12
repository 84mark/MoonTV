/** @jest-environment node */
import type {
  HlsConfig,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderStats,
} from 'hls.js';
import { Response } from 'next/dist/compiled/@edge-runtime/primitives';
import { TextDecoder } from 'util';

import { createLiveLoader } from './live-loader';

Object.assign(globalThis, { Response, TextDecoder });

const mockTransports: {
  callbacks?: LoaderCallbacks<LoaderContext>;
  abort: jest.Mock;
  destroy: jest.Mock;
}[] = [];
jest.mock('hls.js', () => ({
  FetchLoader: class {
    callbacks?: LoaderCallbacks<LoaderContext>;
    abort = jest.fn();
    destroy = jest.fn();
    constructor() {
      mockTransports.push(this);
    }
    load(
      _context: LoaderContext,
      _config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ) {
      this.callbacks = callbacks;
    }
  },
}));
const context = {
  url: 'https://station.example.com/live.m3u8',
  responseType: 'text',
  type: 'manifest',
};
const stats = {} as LoaderStats;
function setup() {
  const log = jest.fn();
  const Loader = createLiveLoader({
    isActive: () => true,
    deadline: () => Date.now() + 30000,
    log,
  });
  const loader = new Loader({} as HlsConfig);
  const callbacks = {
    onSuccess: jest.fn(),
    onError: jest.fn(),
    onTimeout: jest.fn(),
  };
  loader.load(context, {} as LoaderConfiguration, callbacks);
  return { loader, callbacks, log };
}
beforeEach(() => {
  jest.useFakeTimers();
  mockTransports.length = 0;
});
afterEach(() => jest.useRealTimers());

it('makes actual root requests after 1.5 and 3 seconds and stops after two retries', () => {
  const { callbacks } = setup();
  mockTransports[0].callbacks?.onError(
    { code: 503, text: 'Unavailable' },
    context,
    null,
    stats
  );
  expect(callbacks.onError).not.toHaveBeenCalled();
  jest.advanceTimersByTime(1499);
  expect(mockTransports).toHaveLength(1);
  jest.advanceTimersByTime(1);
  expect(mockTransports).toHaveLength(2);
  mockTransports[1].callbacks?.onError(
    { code: 503, text: 'Unavailable' },
    context,
    null,
    stats
  );
  jest.advanceTimersByTime(2999);
  expect(mockTransports).toHaveLength(2);
  jest.advanceTimersByTime(1);
  expect(mockTransports).toHaveLength(3);
  mockTransports[2].callbacks?.onError(
    { code: 503, text: 'Unavailable' },
    context,
    null,
    stats
  );
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
});
it('cancels backoff when switching a channel and ignores late responses', () => {
  const { loader, callbacks } = setup();
  mockTransports[0].callbacks?.onError(
    { code: 503, text: 'Unavailable' },
    context,
    null,
    stats
  );
  loader.destroy();
  jest.advanceTimersByTime(10000);
  mockTransports[0].callbacks?.onError(
    { code: 503, text: 'Late error' },
    context,
    null,
    stats
  );
  expect(mockTransports).toHaveLength(1);
  expect(callbacks.onError).not.toHaveBeenCalled();
  expect(jest.getTimerCount()).toBe(0);
});
it('does not retry permanent HTTP failures', () => {
  const { callbacks } = setup();
  mockTransports[0].callbacks?.onError(
    { code: 403, text: 'Forbidden' },
    context,
    null,
    stats
  );
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
it('shows Worker upstream errors and does not treat a wrapped 403 as a transient 502', async () => {
  const { callbacks, log } = setup();
  const response = new Response(
    JSON.stringify({ error: 'Upstream HTTP 403' }),
    { status: 502, headers: { 'Content-Type': 'application/json' } }
  );
  mockTransports[0].callbacks?.onError(
    { code: 502, text: 'Bad gateway' },
    context,
    response,
    stats
  );
  // Flush response stream microtasks without advancing retry clocks.
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(log).toHaveBeenCalledWith('源站返回：Upstream HTTP 403', true);
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(10000);
  expect(mockTransports).toHaveLength(1);
});
it('leaves non-root playlist and fragment retries to the HLS controller', () => {
  const { loader, callbacks } = setup();
  const level = { ...context, type: 'level' };
  loader.load(level, {} as LoaderConfiguration, callbacks);
  mockTransports[0].callbacks?.onError(
    { code: 503, text: 'Unavailable' },
    level,
    null,
    stats
  );
  expect(callbacks.onError).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
});
