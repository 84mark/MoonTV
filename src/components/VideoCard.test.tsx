import { fireEvent, render, screen } from '@testing-library/react';

import { getBuiltinImageProxyUrl } from '@/lib/image-proxy';
import { processImageUrl } from '@/lib/utils';

import VideoCard from './VideoCard';

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));
jest.mock('@/lib/db.client', () => ({}));
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

it('retries a broken custom proxy through the built-in endpoint exactly once', () => {
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
  expect(image).toHaveAttribute('src', getBuiltinImageProxyUrl(poster));

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

it('opens the details page with the existing Douban identity instead of autoplaying', () => {
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
  fireEvent.click(
    screen.getByRole('link', { name: /查看 肖申克的救赎 的详情/ })
  );
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
  render(<VideoCard from='douban' title='现在就出发 第四季' poster={poster} douban_id='37816990' doubanType='tv' />);
  fireEvent.click(screen.getByRole('link', { name: /查看 现在就出发 第四季 的详情/ }));
  const url = new URL(mockPush.mock.calls[mockPush.mock.calls.length - 1][0], 'https://example.test');
  expect(url.searchParams.get('douban_type')).toBe('tv');
  expect(url.searchParams.get('stype')).toBeNull();
});
