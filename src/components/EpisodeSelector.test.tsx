import { fireEvent, render, screen } from '@testing-library/react';

import { SearchResult } from '@/lib/types';

import EpisodeSelector from './EpisodeSelector';

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
const first: SearchResult = {
  id: '1',
  title: '同一部电影',
  poster: 'https://example.com/poster.jpg',
  episodes: ['https://example.com/one.m3u8'],
  source: 'a',
  source_name: '源 A',
  year: '2026',
};
const second: SearchResult = { ...first, source: 'b', source_name: '源 B' };
beforeEach(() => localStorage.setItem('enableOptimization', 'false'));
afterEach(() => localStorage.clear());

it('renders compact source buttons without duplicate posters or titles', () => {
  const onChange = jest.fn();
  const sources = [second, first];
  render(
    <EpisodeSelector
      totalEpisodes={1}
      currentSource='a'
      currentId='1'
      availableSources={sources}
      onSourceChange={onChange}
    />
  );
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByText('同一部电影')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: '当前源 源 A' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '切换到 源 B' }));
  expect(onChange).toHaveBeenCalledWith('b', '1', '同一部电影');
  expect(sources.map((source) => source.source)).toEqual(['b', 'a']);
});

it('shows measured speed/response beside the source without fabricating zero milliseconds', () => {
  render(
    <EpisodeSelector
      totalEpisodes={1}
      currentSource='a'
      currentId='1'
      availableSources={[first, second]}
      precomputedVideoInfo={
        new Map([
          [
            'a-1',
            {
              quality: '1080p',
              loadSpeed: '1.2 MB/s',
              pingTime: 80,
              status: 'playable' as const,
            },
          ],
          [
            'b-1',
            {
              quality: '未知',
              loadSpeed: '未测得',
              pingTime: 0,
              status: 'unknown' as const,
            },
          ],
        ])
      }
    />
  );
  expect(screen.getByText('速度 1.2 MB/s')).toBeInTheDocument();
  expect(screen.getByText('响应 80 ms')).toBeInTheDocument();
  expect(screen.getByText('响应未测得')).toBeInTheDocument();
  expect(screen.getByText('预检未确认')).toBeInTheDocument();
  expect(screen.queryByText(/响应 0 ms/)).not.toBeInTheDocument();
});

it('keeps measured metrics when the actual player subsequently confirms playback', () => {
  const { rerender } = render(<EpisodeSelector totalEpisodes={1} availableSources={[first]} precomputedVideoInfo={new Map([
    ['a-1', { quality: '1080p', loadSpeed: '1.2 MB/s', pingTime: 80, status: 'playable' as const }],
  ])} />);
  rerender(<EpisodeSelector totalEpisodes={1} availableSources={[first]} precomputedVideoInfo={new Map([
    ['a-1', { quality: '1080p', loadSpeed: '未测得', pingTime: 0, status: 'playable' as const, message: '当前播放器已确认可播放' }],
  ])} />);
  expect(screen.getByText('速度 1.2 MB/s')).toBeInTheDocument();
  expect(screen.getByText('响应 80 ms')).toBeInTheDocument();
  expect(screen.getByText('1080p · 播放已确认')).toBeInTheDocument();
});
