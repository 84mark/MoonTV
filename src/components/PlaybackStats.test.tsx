import { act, fireEvent, render, screen } from '@testing-library/react';

import { DownloadMeter } from '@/lib/playback-stats';

import PlaybackStats from './PlaybackStats';

beforeEach(() => {
  localStorage.clear();
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});
it.each([
  { label: undefined, heading: '剧集（3/40）' },
  { label: '直播 · CCTV-1', heading: '直播 · CCTV-1' },
])(
  'shows $heading with real buffer and supports pin/close/reopen',
  ({ label, heading }) => {
    const clock = jest.spyOn(performance, 'now').mockReturnValue(0);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const video = document.createElement('video');
    Object.defineProperty(video, 'buffered', {
      value: { length: 1, start: () => 0, end: () => 50 },
    });
    video.currentTime = 12;
    const meter = new DownloadMeter();
    if (label) {
      meter.available = true;
      meter.track({ loaded: 64 * 1024, loading: { end: 1 } });
    }
    const view = render(
      <PlaybackStats
        container={container}
        video={video}
        meter={meter}
        episode={3}
        total={40}
        mediaKey='one'
        label={label}
      />
    );
    expect(screen.getByText(heading)).toBeInTheDocument();
    if (label)
      expect(screen.queryByText('剧集（3/40）')).not.toBeInTheDocument();
    act(() => {
      clock.mockReturnValue(1000);
      jest.advanceTimersByTime(1000);
    });
    expect(screen.getByText('已向前缓存 38.0 秒')).toBeInTheDocument();
    if (label) {
      expect(screen.getByText('视频下行 64.0 KB/s')).toBeInTheDocument();
      expect(
        screen.getByRole('img', { name: '最近30秒视频下载速率' })
      ).toBeInTheDocument();
    } else expect(screen.getByText(/当前浏览器暂不提供/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '常驻' }));
    expect(localStorage.getItem('playbackStatsMode')).toBe('pinned');
    act(() => {
      clock.mockReturnValue(6000);
      jest.advanceTimersByTime(5000);
    });
    expect(screen.getByRole('button', { name: '取消常驻' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    if (label)
      expect(screen.getByText('视频下行 0.0 KB/s')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '关闭播放信息' }));
    expect(screen.queryByLabelText('播放信息')).not.toBeInTheDocument();
    expect(localStorage.getItem('playbackStatsMode')).toBe('closed');
    fireEvent.click(screen.getByRole('button', { name: '显示播放信息' }));
    expect(screen.getByLabelText('播放信息')).toBeInTheDocument();
    expect(screen.getByText(heading)).toBeInTheDocument();
    view.unmount();
    container.remove();
  }
);
