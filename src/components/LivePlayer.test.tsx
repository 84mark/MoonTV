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
  id: 'cn:fixture',
  name: '测试频道',
  category: '央视',
  urls: ['https://example.com/first.m3u8', 'https://example.com/backup.m3u8'],
};
beforeEach(() => {
  jest.useFakeTimers();
  mockPlayers.length = 0;
  mockHls.length = 0;
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
  act(() => jest.advanceTimersByTime(15000));
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
    id: 'cn:second',
    name: '第二频道',
    urls: ['https://example.com/second.m3u8'],
  };
  rerender(<LivePlayer key={second.id} channel={second} />);
  expect(mockPlayers[1].options).toEqual(
    expect.objectContaining({ muted: false, volume: 0.35 })
  );
});
