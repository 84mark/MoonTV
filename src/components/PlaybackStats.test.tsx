import { act, fireEvent, render, screen } from '@testing-library/react';

import { DownloadMeter } from '@/lib/playback-stats';

import PlaybackStats from './PlaybackStats';

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});
it('shows episode totals and real buffer, supports pin/close/reopen, and saves the preference', () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const video = document.createElement('video');
  Object.defineProperty(video, 'buffered', {
    value: { length: 1, start: () => 0, end: () => 50 },
  });
  video.currentTime = 12;
  const meter = new DownloadMeter();
  const view = render(
    <PlaybackStats
      container={container}
      video={video}
      meter={meter}
      episode={3}
      total={40}
      mediaKey='one'
    />
  );
  expect(screen.getByText('剧集（3/40）')).toBeInTheDocument();
  act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(screen.getByText('已向前缓存 38.0 秒')).toBeInTheDocument();
  expect(screen.getByText(/当前浏览器暂不提供/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '常驻' }));
  expect(localStorage.getItem('playbackStatsMode')).toBe('pinned');
  act(() => {
    jest.advanceTimersByTime(5000);
  });
  expect(screen.getByRole('button', { name: '取消常驻' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  fireEvent.click(screen.getByRole('button', { name: '关闭播放信息' }));
  expect(screen.queryByLabelText('播放信息')).not.toBeInTheDocument();
  expect(localStorage.getItem('playbackStatsMode')).toBe('closed');
  fireEvent.click(screen.getByRole('button', { name: '显示播放信息' }));
  expect(screen.getByLabelText('播放信息')).toBeInTheDocument();
  view.unmount();
  container.remove();
});
