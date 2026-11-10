import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';

import type { LiveChannel } from '@/lib/live';

import LivePlayer from './LivePlayer';

type Options = {
  url: string;
  muted: boolean;
  volume: number;
  customType: { m3u8: (video: HTMLVideoElement, url: string) => void };
};
type Player = {
  options: Options;
  video: HTMLVideoElement;
  events: Record<string, () => void>;
  destroy: jest.Mock;
};
type HlsInstance = {
  events: Record<string, (event: string, data: { fatal: boolean }) => void>;
  stopLoad: jest.Mock;
  destroy: jest.Mock;
};
const mockPlayers: Player[] = [];
const mockHls: HlsInstance[] = [];
const mockProbe = jest.fn((...args: unknown[]) => {
  void args;
  return { ready: new Promise(() => undefined), cancel: jest.fn() };
});

jest.mock('@/lib/live-probe', () => ({
  probeLiveSources: (...args: unknown[]) => mockProbe(...args),
}));
jest.mock('artplayer', () => ({
  __esModule: true,
  default: class {
    video = document.createElement('video');
    events: Record<string, () => void> = {};
    destroy = jest.fn();
    constructor(public options: Options) {
      this.video.muted = options.muted;
      this.video.volume = options.volume;
      mockPlayers.push(this);
      options.customType.m3u8(this.video, options.url);
    }
    on(event: string, callback: () => void) {
      this.events[event] = callback;
    }
  },
}));
jest.mock('hls.js', () => ({
  __esModule: true,
  default: class {
    static isSupported: () => boolean = () => true;
    static Events: { ERROR: string } = { ERROR: 'error' };
    events: HlsInstance['events'] = {};
    stopLoad = jest.fn();
    destroy = jest.fn();
    loadSource = jest.fn();
    attachMedia = jest.fn();
    constructor() {
      mockHls.push(this);
    }
    on(event: string, callback: HlsInstance['events'][string]) {
      this.events[event] = callback;
    }
  },
}));
const channel: LiveChannel = {
  id: 'custom:fixture',
  name: '测试频道',
  category: '央视',
  urls: ['https://example.com/first.m3u8', 'https://example.com/backup.m3u8'],
};
beforeEach(() => {
  jest.useFakeTimers();
  mockPlayers.length = 0;
  mockHls.length = 0;
  mockProbe.mockClear();
});
afterEach(() => {
  // Reset the session sound preference through the real cleanup path.
  mockPlayers.forEach((player) => {
    player.video.muted = true;
    player.video.volume = 0.7;
  });
  cleanup();
  jest.useRealTimers();
});

it('keeps playback running when a refresh rebuilds an equivalent channel object', () => {
  const { rerender } = render(<LivePlayer channel={channel} />);
  const first = mockPlayers[0];
  act(() => first.events['video:playing']());
  rerender(<LivePlayer channel={{ ...channel, urls: [...channel.urls] }} />);
  expect(mockPlayers).toHaveLength(1);
  expect(first.destroy).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('正在直播');
});

it('safely returns to the first line when a refreshed channel removes the selected backup', () => {
  const { rerender } = render(<LivePlayer channel={channel} />);
  fireEvent.click(screen.getByRole('button', { name: '线路 2' }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[1]);
  rerender(<LivePlayer channel={{ ...channel, urls: [channel.urls[0]] }} />);
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[0]);
  expect(
    mockPlayers.every((player) => typeof player.options.url === 'string')
  ).toBe(true);
  expect(screen.getByRole('button', { name: '线路 1' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

it('switches on a fatal failure, stops every failed HLS loader, and exposes retry after all lines fail', () => {
  render(<LivePlayer channel={channel} />);
  const first = mockHls[0];
  act(() => first.events.error('error', { fatal: true }));
  expect(first.stopLoad).toHaveBeenCalledTimes(1);
  expect(first.destroy).toHaveBeenCalledTimes(1);
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[1]);
  const backup = mockHls[1];
  act(() => backup.events.error('error', { fatal: true }));
  expect(backup.stopLoad).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: '重新连接' })).toBeInTheDocument();
  const count = mockPlayers.length;
  act(() => {
    first.events.error('error', { fatal: true });
    backup.events.error('error', { fatal: true });
    jest.advanceTimersByTime(30000);
  });
  expect(mockPlayers).toHaveLength(count);
  fireEvent.click(screen.getByRole('button', { name: '重新连接' }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[0]);
});

it('tries the backup after the startup deadline and destroys media and timers on unmount', () => {
  const { unmount } = render(<LivePlayer channel={channel} />);
  act(() => jest.advanceTimersByTime(8000));
  expect(mockPlayers).toHaveLength(2);
  expect(mockHls[0].stopLoad).toHaveBeenCalledTimes(1);
  const player = mockPlayers[1];
  const hls = mockHls[1];
  unmount();
  expect(hls.destroy).toHaveBeenCalledTimes(1);
  expect(player.destroy).toHaveBeenCalledWith(false);
  expect(jest.getTimerCount()).toBe(0);
});

it('retains the user sound settings across a channel switch', () => {
  const { rerender } = render(
    <LivePlayer key={channel.id} channel={channel} />
  );
  mockPlayers[0].video.muted = false;
  mockPlayers[0].video.volume = 0.35;
  const second = {
    ...channel,
    id: 'custom:second',
    name: '第二频道',
    urls: ['https://example.com/second.m3u8'],
  };
  rerender(<LivePlayer key={second.id} channel={second} />);
  expect(mockPlayers[1].options).toEqual(
    expect.objectContaining({ muted: false, volume: 0.35 })
  );
});

it('starts domestic channels directly and retries the same source through Cloudflare before the backup', () => {
  render(<LivePlayer channel={{ ...channel, id: 'cn:fixture' }} />);
  expect(mockProbe.mock.calls[0][0]).toEqual(channel.urls);
  fireEvent.click(screen.getByRole('button', { name: '跳过检测，直接播放' }));
  expect(mockPlayers[0].options.url).toBe(channel.urls[0]);
  act(() => mockHls[0].events.error('error', { fatal: true }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(
    '/api/live/stream?channel=cn%3Afixture&line=0'
  );
  act(() => mockHls[mockHls.length - 1].events.error('error', { fatal: true }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[1]);
  expect(screen.getByRole('button', { name: '自动选择' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
it('automatically relays only the source explicitly listed as requiring compatibility', () => {
  render(
    <LivePlayer
      channel={{
        ...channel,
        id: 'cn:fixture',
        relayRequired: [channel.urls[1]],
      }}
    />
  );
  expect(mockProbe.mock.calls[0][0]).toEqual([
    channel.urls[0],
    '/api/live/stream?channel=cn%3Afixture&line=1',
  ]);
  fireEvent.click(screen.getByRole('button', { name: '线路 2' }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(
    '/api/live/stream?channel=cn%3Afixture&line=1'
  );
  fireEvent.click(screen.getByRole('button', { name: '线路 1' }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[0]);
  fireEvent.click(screen.getByRole('button', { name: '直连播放' }));
  fireEvent.click(screen.getByRole('button', { name: '线路 2' }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[1]);
});
it('routes overseas channels through Cloudflare automatically and respects manual direct mode', () => {
  render(<LivePlayer channel={{ ...channel, id: 'world:fixture' }} />);
  expect(mockPlayers[0].options.url).toBe(
    '/api/live/stream?channel=world%3Afixture&line=0'
  );
  expect(screen.getByText(/当前线路：Cloudflare 转发/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '直连播放' }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[0]);
  act(() => mockHls[mockHls.length - 1].events.error('error', { fatal: true }));
  expect(mockPlayers[mockPlayers.length - 1].options.url).toBe(channel.urls[1]);
});
it('relays HTTP domestic sources to avoid mixed content and labels the actual route', () => {
  render(
    <LivePlayer
      channel={{
        ...channel,
        id: 'cn:http',
        urls: ['http://example.com/live.m3u8'],
      }}
    />
  );
  expect(mockPlayers[0].options.url).toBe(
    '/api/live/stream?channel=cn%3Ahttp&line=0'
  );
  expect(
    screen.getByText(/Cloudflare 兼容转发（HTTP 源）/)
  ).toBeInTheDocument();
});
it('starts playback without waiting for multi-source probes to finish', () => {
  render(<LivePlayer channel={{ ...channel, id: 'cn:fixture' }} />);
  expect(mockPlayers).toHaveLength(1);
  expect(mockPlayers[0].options.url).toBe(channel.urls[0]);
});
it('never relays user-imported channels even if imported data contains a relay marker', () => {
  render(<LivePlayer channel={{ ...channel, relayRequired: channel.urls }} />);
  expect(mockProbe.mock.calls[0][0]).toEqual(channel.urls);
  expect(mockPlayers[0].options.url).toBe(channel.urls[0]);
  expect(
    screen.queryByRole('button', { name: 'Cloudflare 转发' })
  ).not.toBeInTheDocument();
});

it('uses an 8 second direct deadline then 12 seconds for Cloudflare before advancing', () => {
  render(<LivePlayer channel={{ ...channel, id: 'cn:fixture' }} />);
  act(() => jest.advanceTimersByTime(7999));
  expect(mockPlayers).toHaveLength(1);
  act(() => jest.advanceTimersByTime(1));
  expect(mockPlayers).toHaveLength(2);
  expect(mockPlayers[1].options.url).toBe(
    '/api/live/stream?channel=cn%3Afixture&line=0'
  );
  expect(screen.getByText(/首帧等待超过 8 秒/)).toBeInTheDocument();
  act(() => jest.advanceTimersByTime(11999));
  expect(mockPlayers).toHaveLength(2);
  act(() => jest.advanceTimersByTime(1));
  expect(mockPlayers).toHaveLength(3);
  expect(mockPlayers[2].options.url).toBe(channel.urls[1]);
  expect(screen.getByText(/首帧等待超过 12 秒/)).toBeInTheDocument();
});
it('keeps a 20 second recovery window after playback has started', () => {
  render(<LivePlayer channel={channel} />);
  act(() => mockPlayers[0].events['video:playing']());
  act(() => jest.advanceTimersByTime(12000));
  expect(mockPlayers).toHaveLength(1);
  act(() => mockPlayers[0].events['video:waiting']());
  act(() => jest.advanceTimersByTime(19999));
  expect(mockPlayers).toHaveLength(1);
  act(() => jest.advanceTimersByTime(1));
  expect(mockPlayers).toHaveLength(2);
  expect(screen.getByText(/缓冲等待超过 20 秒/)).toBeInTheDocument();
});
it('does not extend the first-frame deadline when initial buffering repeats', () => {
  render(<LivePlayer channel={channel} />);
  act(() => jest.advanceTimersByTime(7000));
  act(() => mockPlayers[0].events['video:waiting']());
  act(() => jest.advanceTimersByTime(1000));
  expect(mockPlayers).toHaveLength(2);
});
