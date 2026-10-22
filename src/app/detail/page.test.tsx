import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import DetailPage from './page';

let query = '';
jest.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/DoubanComments', () => ({
  __esModule: true,
  default: () => <div>短评组件</div>,
}));
const subject = {
  id: '1292052',
  title: '肖申克的救赎',
  year: '1994',
  intro: '剧情简介内容',
  poster:
    'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg',
  rating: 9.7,
  ratingCount: 1000,
  genres: ['剧情'],
  directors: ['导演'],
  actors: ['演员'],
  photos: [
    {
      id: '123456',
      url: 'https://img3.doubanio.com/view/photo/l/public/p123456.jpg',
    },
  ],
};
const response = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 502,
  json: async () => data,
});
beforeEach(() => {
  global.fetch = jest.fn();
});
it('shows synopsis, photos, ratings and reviews before an explicit play action, preserving source selection parameters', async () => {
  query =
    'title=测试&source=fixture&id=101&prefer=true&stitle=原搜索&stype=movie&year=1994&douban_id=1292052';
  (fetch as jest.Mock)
    .mockResolvedValueOnce(
      response({ title: '测试', year: '1994', desc: '源简介' })
    )
    .mockResolvedValueOnce(response({ subject, candidates: [] }));
  const { container } = render(<DetailPage />);
  expect(await screen.findByText('剧情简介内容')).toBeInTheDocument();
  expect(screen.getByText('9.7')).toBeInTheDocument();
  expect(screen.getByAltText('肖申克的救赎剧照 1')).toHaveAttribute(
    'src',
    expect.stringContaining('/api/image?')
  );
  expect(screen.getByText('短评组件')).toBeInTheDocument();
  expect(container.querySelector('video')).toBeNull();
  const link = new URL(
    screen.getByRole('link', { name: /立即播放/ }).getAttribute('href') || '',
    'https://example.test'
  );
  expect(link.pathname).toBe('/play');
  new URLSearchParams(query).forEach((value, key) => {
    expect(link.searchParams.get(key)).toBe(value);
  });
});
it('allows immediate playback and retains source synopsis if Douban fails', async () => {
  query = 'title=测试&source=fixture&id=101';
  (fetch as jest.Mock)
    .mockResolvedValueOnce(response({ title: '测试', desc: '源简介' }))
    .mockResolvedValueOnce(response({}, false));
  render(<DetailPage />);
  expect(screen.getByRole('link', { name: /立即播放/ })).toHaveAttribute(
    'href',
    expect.stringContaining('source=fixture')
  );
  expect(await screen.findByText('源简介')).toBeInTheDocument();
  expect(await screen.findByText(/豆瓣资料暂时无法获取/)).toBeInTheDocument();
});
it('requires choosing an ambiguous film and carries the chosen Douban ID to playback', async () => {
  query = 'title=同名影片';
  (fetch as jest.Mock)
    .mockResolvedValueOnce(
      response({
        subject: null,
        candidates: [{ id: '1292052', title: '同名影片', year: '1994' }],
      })
    )
    .mockResolvedValueOnce(response({ subject, candidates: [] }));
  render(<DetailPage />);
  fireEvent.click(await screen.findByRole('button', { name: /同名影片/ }));
  await waitFor(() =>
    expect(screen.getByRole('link', { name: /立即播放/ })).toHaveAttribute(
      'href',
      expect.stringContaining('douban_id=1292052')
    )
  );
});

it('keeps fallback Douban posters on the built-in image proxy when metadata fails', async () => {
  const poster =
    'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p480747492.jpg';
  query = `title=测试&poster=${encodeURIComponent(poster)}`;
  localStorage.setItem('imageProxyUrl', 'https://broken.example/?url=');
  (fetch as jest.Mock).mockResolvedValueOnce(response({}, false));
  render(<DetailPage />);
  expect(screen.getByAltText('测试海报')).toHaveAttribute(
    'src',
    expect.stringContaining('/api/image?')
  );
  await screen.findByText(/豆瓣资料暂时无法获取/);
  localStorage.clear();
});
