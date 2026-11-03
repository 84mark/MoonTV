import { render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { getAllPlayRecords } from '@/lib/db.client';
import { rememberEpisode } from '@/lib/episode-progress';
import { getPreparedPlayback } from '@/lib/playback-preload';
import { getVideoResolutionFromM3u8 } from '@/lib/utils';

import PlayPage from './page';

jest.mock('@/lib/playback-preload', () => ({ getPreparedPlayback: jest.fn() }));

let query = '';
const mockPlayer = jest.fn();
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock('artplayer', () => ({
  __esModule: true,
  default: class {
    video = document.createElement('video');
    template = { $player: document.createElement('div') };
    on = jest.fn();
    destroy = jest.fn();
    constructor(options: unknown) {
      mockPlayer(options);
    }
  },
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/DoubanComments', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/PlaybackStats', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/components/EpisodeSelector', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/lib/utils', () => ({
  getVideoResolutionFromM3u8: jest.fn(),
  processImageUrl: (url: string) => url,
}));
jest.mock('@/lib/db.client', () => ({
  getAllPlayRecords: jest.fn(),
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  getSkipConfig: async () => null,
  isFavorited: async () => false,
  subscribeToDataUpdates: () => () => undefined,
}));
const a = {
  source: 'a',
  id: '1',
  title: '剧集',
  year: '2026',
  source_name: 'A',
  poster: '',
  episodes: ['a1', 'a2', 'a3', 'a4'],
};
const b = {
  ...a,
  source: 'b',
  source_name: 'B',
  episodes: ['b1', 'b2', 'b3', 'b4'],
};
beforeEach(() => {
  document.cookie = 'moontv_episodes=; Max-Age=0; Path=/';
  localStorage.clear();
  mockPlayer.mockClear();
  (getPreparedPlayback as jest.Mock).mockReturnValue(null);
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, json: async () => ({ results: [a, b] }) });
  (getAllPlayRecords as jest.Mock).mockResolvedValue({
    'a+1': { index: 1, play_time: 100 },
  });
  (getVideoResolutionFromM3u8 as jest.Mock)
    .mockReset()
    .mockImplementation(async (url: string) => ({
      quality: '720p',
      loadSpeed: url.startsWith('b') ? '2 MB/s' : '100 KB/s',
      pingTime: 10,
      status: 'playable',
      latencyKind: 'response',
      message: '',
    }));
});
it('honors a clicked episode over old history and starts with the first measured current episode without waiting for the next', async () => {
  query = 'title=剧集&year=2026&source=a&id=1&prefer=true&episode=3';
  render(<PlayPage />);
  await waitFor(() =>
    expect(mockPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'a3' })
    )
  );
  expect(
    (getVideoResolutionFromM3u8 as jest.Mock).mock.calls
      .map((call) => call[0])
      .sort()
  ).toEqual(['a3', 'b3']);
  expect(screen.getByRole('heading', { name: /第 3 集/ })).toBeInTheDocument();
});
it('uses the remembered episode across source changes rather than the first source old record', async () => {
  rememberEpisode('剧集', '2026', 2);
  query = 'title=剧集&year=2026&prefer=true';
  render(<PlayPage />);
  await waitFor(() =>
    expect(mockPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'a3' })
    )
  );
});

it('reuses discovered sources for a different clicked episode without reusing old measurements or searching again', async () => {
  query = 'title=剧集&year=2026&source=a&id=1&episode=3&preload=handoff';
  (getPreparedPlayback as jest.Mock).mockReturnValue({
    snapshot: {
      sources: [a, b],
      episodeIndex: 0,
      results: new Map(),
      selected: a,
    },
  });
  render(<PlayPage />);
  await waitFor(() =>
    expect(mockPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'a3' })
    )
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(getVideoResolutionFromM3u8).not.toHaveBeenCalled();
});

it('restores the latest merged episode even when the current source has no history key or episode cookie', async () => {
  query = 'title=剧集&year=2026&source=a&id=1';
  (getAllPlayRecords as jest.Mock).mockResolvedValue({
    'b+1': {
      title: '剧集',
      year: '2026',
      total_episodes: 4,
      index: 3,
      play_time: 50,
      save_time: 200,
    },
  });
  render(<PlayPage />);
  await waitFor(() =>
    expect(mockPlayer).toHaveBeenCalledWith(
      expect.objectContaining({ url: 'a3' })
    )
  );
});
