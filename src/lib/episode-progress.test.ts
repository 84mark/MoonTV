import {
  readEpisode,
  rememberEpisode,
  requestedEpisode,
} from './episode-progress';

beforeEach(() => {
  document.cookie = 'moontv_episodes=; Max-Age=0; Path=/';
});
it('remembers episodes across sources, separates years, and gives explicit selection priority', () => {
  expect(readEpisode('剧集', '2026')).toBe(0);
  rememberEpisode('剧 集', '2026', 12);
  expect(
    requestedEpisode(new URLSearchParams('title=剧集&year=2026&source=another'))
  ).toBe(12);
  expect(
    requestedEpisode(new URLSearchParams('title=剧集&year=2026&episode=3'))
  ).toBe(2);
  expect(readEpisode('剧集', '2025')).toBe(0);
});
it('bounds the cookie and recovers from malformed cookies and episode parameters', () => {
  document.cookie = 'moontv_episodes=broken; Path=/';
  expect(readEpisode('剧集')).toBe(0);
  for (let i = 0; i < 100; i++) rememberEpisode(`剧集${i}`, '2026', i);
  expect(document.cookie.length).toBeLessThan(3800);
  expect(readEpisode('剧集99', '2026')).toBe(99);
  expect(readEpisode('剧集0', '2026')).toBe(0);
  rememberEpisode('剧集99', '2026', -1);
  expect(
    requestedEpisode(new URLSearchParams('title=剧集99&year=2026&episode=-2'))
  ).toBe(99);
});
