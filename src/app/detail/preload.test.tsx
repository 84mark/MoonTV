import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type {
  PlaybackPreparation,
  PlaybackPreparationState,
} from '@/lib/playback-preload';
import { preparePlayback } from '@/lib/playback-preload';
import type { SearchResult } from '@/lib/types';

import DetailPage from './page';

jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('title=电影&year=2026'),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/DoubanComments', () => ({
  __esModule: true,
  default: () => null,
}));
jest.mock('@/lib/playback-preload', () => ({ preparePlayback: jest.fn() }));
let listener: (state: PlaybackPreparationState) => void;
let session: PlaybackPreparation;
const source: SearchResult = {
  id: '1',
  source: 'a',
  source_name: 'A',
  title: '电影',
  year: '2026',
  episodes: ['a'],
  poster: '',
};
beforeEach(() => {
  global.fetch = jest
    .fn()
    .mockResolvedValue({
      ok: true,
      json: async () => ({ subject: null, candidates: [] }),
    });
  session = {
    id: 'handoff',
    createdAt: 0,
    snapshot: {
      status: 'searching',
      sources: [],
      results: new Map(),
      firstSource: null,
      selected: null,
      completed: 0,
    },
    subscribe: (callback) => {
      listener = callback;
      return () => undefined;
    },
  };
  (preparePlayback as jest.Mock).mockReset().mockReturnValue(session);
});
it('keeps a fast click enabled, forwards first measured source, then switches the play target to the fastest complete result', async () => {
  render(<DetailPage />);
  expect(screen.getByRole('link', { name: /立即播放/ })).toHaveAttribute(
    'href',
    expect.stringContaining('preload=handoff')
  );
  act(() =>
    listener({
      ...session.snapshot,
      status: 'testing',
      selected: source,
      firstSource: source,
      sources: [source],
      completed: 1,
    })
  );
  expect(screen.getByRole('link', { name: /立即播放/ })).toHaveAttribute(
    'href',
    expect.stringContaining('source=a')
  );
  const faster = { ...source, source: 'b', source_name: 'B' };
  act(() =>
    listener({
      ...session.snapshot,
      status: 'complete',
      selected: faster,
      firstSource: source,
      sources: [source, faster],
      completed: 2,
    })
  );
  expect(screen.getByRole('link', { name: /立即播放/ })).toHaveAttribute(
    'href',
    expect.stringContaining('source=b')
  );
  expect(
    await screen.findByText(/测速完成，将使用最快片源：B/)
  ).toBeInTheDocument();
});
it('greys out playback after every source has no speed and offers a fresh detection action', async () => {
  render(<DetailPage />);
  act(() =>
    listener({
      ...session.snapshot,
      status: 'complete',
      sources: [source],
      selected: null,
      completed: 1,
    })
  );
  expect(screen.getByRole('button', { name: /暂无可用片源/ })).toBeDisabled();
  expect(
    screen.queryByRole('link', { name: /立即播放/ })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '重新检测' }));
  expect(preparePlayback).toHaveBeenLastCalledWith(expect.any(String), true);
  await screen.findByRole('heading', { name: '剧情简介' });
});
