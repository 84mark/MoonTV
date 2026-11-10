import { fireEvent, render, screen } from '@testing-library/react';

import { getBuiltinImageProxyUrl } from '@/lib/image-proxy';
import { processImageUrl } from '@/lib/utils';

import VideoCard from './VideoCard';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/lib/db.client', () => ({
  isFavorited: async () => false,
  generateStorageKey: (source: string, id: string) => `${source}+${id}`,
  subscribeToDataUpdates: () => () => undefined,
}));
jest.mock('next/image', () => ({
  __esModule: true,
  default: (props: { src: string; alt: string; onError: () => void }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={props.src} alt={props.alt} onError={props.onError} />
  ),
}));

const poster =
  'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg';

beforeEach(() => {
  localStorage.clear();
});

it.each(['电影', '剧集', '综艺'])(
  '%s cards use the same-origin poster endpoint by default',
  (title) => {
    render(<VideoCard from='douban' title={title} poster={poster} />);
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      getBuiltinImageProxyUrl(poster)
    );
  }
);

it('does not let an old disabled custom-proxy setting disable the built-in proxy', () => {
  localStorage.setItem('enableImageProxy', 'false');
  localStorage.setItem('imageProxyUrl', 'https://old-proxy.example/?url=');
  expect(processImageUrl(poster)).toBe(getBuiltinImageProxyUrl(poster));
});

it('tries the built-in proxy then public CDN without retry loops', () => {
  const customProxy = 'https://old-proxy.example/?url=';
  localStorage.setItem('imageProxyUrl', customProxy);
  localStorage.setItem('enableImageProxy', 'true');
  const { rerender } = render(
    <VideoCard from='douban' title='电影' poster={poster} />
  );
  const image = screen.getByRole('img');
  expect(image).toHaveAttribute(
    'src',
    customProxy + encodeURIComponent(poster)
  );
  fireEvent.error(image);
  expect(image).toHaveAttribute('src', getBuiltinImageProxyUrl(poster));
  fireEvent.error(image);
  expect(image).toHaveAttribute('src', poster);

  const nextPoster = poster.replace('p480747492', 'p480747493');
  rerender(<VideoCard from='douban' title='剧集' poster={nextPoster} />);
  expect(image).toHaveAttribute(
    'src',
    customProxy + encodeURIComponent(nextPoster)
  );
});

it('leaves non-Douban posters alone and still supports custom image proxies', () => {
  const other = 'https://images.example/poster.jpg';
  expect(processImageUrl(other)).toBe(other);
  expect(processImageUrl('/logo.png')).toBe('/logo.png');
  expect(processImageUrl('')).toBe('');
  localStorage.setItem('imageProxyUrl', '/custom-proxy?url=');
  expect(processImageUrl(other)).toBe(
    `/custom-proxy?url=${encodeURIComponent(other)}`
  );
});

it('opens the introduction with the existing Douban identity', () => {
  render(
    <VideoCard
      from='douban'
      title='肖申克的救赎'
      poster={poster}
      douban_id='1292052'
      year='1994'
      type='movie'
    />
  );
  fireEvent.click(screen.getByRole('link', { name: /查看 肖申克的救赎 介绍/ }));
  const url = new URL(
    mockPush.mock.calls[mockPush.mock.calls.length - 1][0],
    'https://example.test'
  );
  expect(url.pathname).toBe('/detail');
  expect(url.searchParams.get('douban_id')).toBe('1292052');
  expect(url.searchParams.get('title')).toBe('肖申克的救赎');
  expect(url.searchParams.get('stype')).toBe('movie');
  expect(url.searchParams.get('poster')).toBe(poster);
});

it('carries the Douban TV type separately without restricting variety-show playback to multiple episodes', () => {
  render(
    <VideoCard
      from='douban'
      title='现在就出发 第四季'
      poster={poster}
      douban_id='37816990'
      doubanType='tv'
    />
  );
  fireEvent.click(
    screen.getByRole('link', { name: /查看 现在就出发 第四季 介绍/ })
  );
  const url = new URL(
    mockPush.mock.calls[mockPush.mock.calls.length - 1][0],
    'https://example.test'
  );
  expect(url.searchParams.get('douban_type')).toBe('tv');
  expect(url.searchParams.get('stype')).toBeNull();
});

it.each(['movie', 'tv', 'show'])(
  'carries the originating %s menu into playback navigation',
  (type) => {
    window.history.replaceState({}, '', `/douban?type=${type}`);
    render(<VideoCard from='douban' title='剧集' poster={poster} />);
    fireEvent.click(screen.getByRole('link', { name: /查看 剧集 介绍/ }));
    const url = new URL(
      mockPush.mock.calls[mockPush.mock.calls.length - 1][0],
      'https://example.test'
    );
    expect(url.searchParams.get('returnTo')).toBe(`/douban?type=${type}`);
    window.history.replaceState({}, '', '/');
  }
);

it('keeps the saved children language when reopening a continue-watching card', () => {
  render(
    <VideoCard
      from='playrecord'
      id='english-1'
      source='family'
      title='小猪佩奇 第一季'
      poster={poster}
      episodes={26}
      currentEpisode={3}
      kidsId='peppa'
      kidsLanguage='multi:en+zh-CN'
    />
  );
  fireEvent.click(
    screen.getByRole('link', { name: '查看 小猪佩奇 第一季 介绍' })
  );
  const url = new URL(
    mockPush.mock.calls[mockPush.mock.calls.length - 1][0],
    'https://example.test'
  );
  expect(url.pathname).toBe('/detail');
  expect(url.searchParams.get('source')).toBe('family');
  expect(url.searchParams.get('id')).toBe('english-1');
  expect(url.searchParams.get('episode')).toBe('3');
  expect(url.searchParams.get('kids_id')).toBe('peppa');
  expect(url.searchParams.get('kids_language')).toBe('multi:en+zh-CN');
});

it('preserves the kids catalogue constraint without inventing an audio language', () => {
  render(
    <VideoCard
      from='douban'
      title='头脑特工队'
      type='movie'
      kidsId='insideout'
    />
  );
  fireEvent.click(screen.getByRole('link', { name: '查看 头脑特工队 介绍' }));
  const url = new URL(
    mockPush.mock.calls[mockPush.mock.calls.length - 1][0],
    'https://example.test'
  );
  expect(url.pathname).toBe('/detail');
  expect(url.searchParams.get('kids_id')).toBe('insideout');
  expect(url.searchParams.has('kids_language')).toBe(false);
  expect(url.searchParams.get('stype')).toBe('movie');
});

it.each(['favorite', 'search'] as const)(
  'opens %s cards in the introduction and preserves source identifiers',
  (from) => {
    render(
      <VideoCard
        from={from}
        title='电影 & 特别篇'
        source='source-key'
        id='one&two'
        year='2026'
        type='movie'
        query='电影'
      />
    );
    fireEvent.click(
      screen.getByRole('link', { name: '查看 电影 & 特别篇 介绍' })
    );
    const url = new URL(
      mockPush.mock.calls[mockPush.mock.calls.length - 1][0],
      'https://example.test'
    );
    expect(url.pathname).toBe('/detail');
    expect(url.searchParams.get('source')).toBe('source-key');
    expect(url.searchParams.get('id')).toBe('one&two');
    expect(url.searchParams.get('title')).toBe('电影 & 特别篇');
    expect(url.searchParams.get('year')).toBe('2026');
    expect(url.searchParams.get('stitle')).toBe('电影');
  }
);

it('uses the catalogue fallback after the proxy and public image fail, then stops retrying', () => {
  const fallback = 'https://api.bgm.tv/v0/subjects/119035/image?type=medium';
  render(
    <VideoCard
      from='douban'
      title='动画'
      poster={poster}
      fallbackPoster={fallback}
    />
  );
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img')).toHaveAttribute('src', poster);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.getByRole('img')).toHaveAttribute('src', fallback);
  fireEvent.error(screen.getByRole('img'));
  expect(screen.queryByRole('img')).toBeNull();
  expect(
    screen.getByRole('link', { name: '查看 动画 介绍' })
  ).toBeInTheDocument();
});
