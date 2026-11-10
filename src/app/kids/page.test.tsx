import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';

import { KIDS_TITLES } from '@/lib/kids';

import KidsPage from './page';

let query = 'kind=tv';
const replace = jest.fn();
const observers: Array<{
  callback: IntersectionObserverCallback;
  observe: jest.Mock;
  disconnect: jest.Mock;
  options?: IntersectionObserverInit;
}> = [];
const resourceCalls = () =>
  (fetch as jest.Mock).mock.calls.filter(([url]) =>
    String(url).startsWith('/api/kids?')
  );

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const poster =
  'https://img3.doubanio.com/view/photo/s_ratio_poster/public/p123456.jpg';
const source = (language: string, id: string) => ({
  id,
  title: `小猪佩奇 第一季 ${language}`,
  poster,
  episodes: ['one', 'two'],
  source: `source-${id}`,
  source_name: `片源${id}`,
  year: '2026',
  language,
});
const variants = [
  {
    id: 'peppa-zh',
    title: '小猪佩奇 第一季 国语版',
    poster,
    language: { code: 'zh-CN', label: '普通话' },
    sources: [source('普通话', 'zh')],
    season: '第一季',
    year: '2026',
    kind: 'tv',
  },
  {
    id: 'peppa-en',
    title: '小猪佩奇 第一季 英语版',
    poster,
    language: { code: 'en', label: '英语' },
    sources: [source('英语', 'en')],
    season: '第一季',
    year: '2026',
    kind: 'tv',
  },
];
beforeEach(() => {
  query = 'kind=tv';
  replace.mockClear();
  observers.length = 0;
  global.IntersectionObserver = jest.fn((callback, options) => {
    const observer = {
      callback,
      options,
      observe: jest.fn(),
      disconnect: jest.fn(),
    };
    observers.push(observer);
    return observer;
  }) as unknown as typeof IntersectionObserver;
  global.fetch = jest.fn(async (input) => {
    const url = new URL(String(input), 'https://test.local');
    return {
      ok: true,
      status: 200,
      json: async () =>
        url.pathname === '/api/kids'
          ? { variants: url.searchParams.get('id') === 'peppa' ? variants : [] }
          : { subject: { poster } },
    };
  }) as jest.Mock;
});

it('shows actual posters and separates language versions of the same animation', async () => {
  await act(async () => {
    render(<KidsPage />);
  });
  expect(
    await screen.findByRole('button', {
      name: '选择 小猪佩奇 第一季 国语版 · 普通话',
    })
  ).toBeInTheDocument();
  expect(
    screen.getByRole('button', { name: '选择 小猪佩奇 第一季 英语版 · 英语' })
  ).toBeInTheDocument();
  expect(screen.getByAltText('小猪佩奇 第一季 英语版海报')).toHaveAttribute(
    'src',
    expect.stringContaining('/api/image?url=')
  );
  expect(screen.getByAltText('小猪佩奇 第一季 英语版海报')).toHaveAttribute(
    'referrerpolicy',
    'no-referrer'
  );
  expect(screen.queryByRole('button', { name: /岁/ })).toBeNull();
});
it('preserves the chosen audio version and exact source on the detail link', async () => {
  await act(async () => {
    render(<KidsPage />);
  });
  fireEvent.click(
    await screen.findByRole('button', {
      name: '选择 小猪佩奇 第一季 英语版 · 英语',
    })
  );
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  const link = screen.getByRole('link', { name: /就看这个版本/ });
  const href = new URL(link.getAttribute('href') || '', 'https://test.local');
  expect(href.searchParams.get('source')).toBe('source-en');
  expect(href.searchParams.get('id')).toBe('en');
  expect(href.searchParams.get('kids_language')).toBe('en');
  expect(href.searchParams.get('kids_id')).toBe('peppa');
  expect(href.searchParams.get('returnTo')).toBe('/kids?kind=tv');
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
});
it('marks unlabeled versions as unconfirmed and never invents a default language', async () => {
  (fetch as jest.Mock).mockImplementation(async (input) => {
    const url = new URL(String(input), 'https://test.local');
    return {
      ok: true,
      json: async () =>
        url.pathname === '/api/kids'
          ? {
              variants:
                url.searchParams.get('id') === 'peppa'
                  ? [
                      {
                        ...variants[0],
                        id: 'unknown',
                        language: { code: 'unknown', label: '语言待确认' },
                      },
                    ]
                  : [],
            }
          : { subject: { poster } },
    };
  });
  await act(async () => {
    render(<KidsPage />);
  });
  expect(
    await screen.findByRole('button', {
      name: '选择 小猪佩奇 第一季 国语版 · 语言待确认',
    })
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '普通话' })).toBeNull();
});
it('offers movie and series entry points without age groups', async () => {
  await act(async () => {
    render(<KidsPage />);
  });
  fireEvent.click(screen.getByRole('button', { name: /动画电影/ }));
  expect(replace).toHaveBeenCalledWith('/kids?kind=movie', { scroll: false });
  expect(screen.getByRole('button', { name: /动画剧集/ })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});
it('limits the initial resource pool search to two concurrent requests', async () => {
  const pending: Array<() => void> = [];
  (fetch as jest.Mock).mockImplementation((input) => {
    const url = new URL(String(input), 'https://test.local');
    if (url.pathname === '/api/kids')
      return new Promise((resolve) =>
        pending.push(() =>
          resolve({ ok: true, json: async () => ({ variants: [] }) })
        )
      );
    return Promise.resolve({ ok: true, json: async () => ({ subject: null }) });
  });
  await act(async () => {
    render(<KidsPage />);
  });
  await waitFor(() => expect(pending).toHaveLength(2));
  expect(
    (fetch as jest.Mock).mock.calls.filter(([url]) =>
      String(url).startsWith('/api/kids?')
    )
  ).toHaveLength(2);
});

it('keeps seasons in the version picker instead of repeating the same language poster', async () => {
  (fetch as jest.Mock).mockImplementation(async (input) => {
    const url = new URL(String(input), 'https://test.local');
    return {
      ok: true,
      json: async () =>
        url.pathname === '/api/kids'
          ? {
              variants:
                url.searchParams.get('id') === 'peppa'
                  ? [
                      ...variants,
                      {
                        ...variants[1],
                        id: 'peppa-en-season2',
                        title: '小猪佩奇 第二季 英语版',
                        season: '第2季',
                      },
                    ]
                  : [],
            }
          : { subject: { poster } },
    };
  });
  await act(async () => {
    render(<KidsPage />);
  });
  expect(
    await screen.findAllByRole('button', { name: /^选择 .* · 英语$/ })
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: /^选择 .* · 英语$/ }));
  expect(
    screen.getByRole('button', { name: '英语 · 第2季' })
  ).toBeInTheDocument();
});

it('keeps search without parent or rediscovery sections', async () => {
  render(<KidsPage />);
  expect(screen.getByRole('textbox', { name: '搜索动画' })).toBeInTheDocument();
  expect(screen.queryByText('家长入口')).toBeNull();
  expect(screen.queryByText('再找找其他动画')).toBeNull();
});

it('loads 25 titles first, then appends the remaining titles when the sentinel is visible', async () => {
  render(<KidsPage />);
  await waitFor(() => expect(resourceCalls()).toHaveLength(25));
  await waitFor(() =>
    expect(
      observers.some((observer) => observer.observe.mock.calls.length)
    ).toBe(true)
  );
  const observer = [...observers]
    .reverse()
    .find((item) => item.observe.mock.calls.length);
  if (!observer) throw new Error('Missing pagination observer');
  expect(observer.options).toEqual({ threshold: 0.1 });
  expect(observer.observe.mock.calls[0][0]).toHaveAttribute(
    'aria-label',
    '加载更多动画'
  );
  act(() => {
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
  });
  const titles = KIDS_TITLES.filter((item) => item.kind === 'tv');
  await waitFor(() => expect(resourceCalls()).toHaveLength(titles.length));
  expect(
    new Set(
      resourceCalls().map(([url]) =>
        new URL(url, 'https://test.local').searchParams.get('id')
      )
    ).size
  ).toBe(titles.length);
  expect(observer.disconnect).toHaveBeenCalled();
});

it('debounces search and only discovers titles matching the latest query', async () => {
  render(<KidsPage />);
  const input = screen.getByRole('textbox', { name: '搜索动画' });
  fireEvent.change(input, { target: { value: '花园' } });
  fireEvent.change(input, { target: { value: '佩奇' } });
  await screen.findByRole('button', {
    name: '选择 小猪佩奇 第一季 英语版 · 英语',
  });
  expect(resourceCalls()).toHaveLength(1);
  expect(String(resourceCalls()[0][0])).toContain('id=peppa');
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  await waitFor(() => expect(resourceCalls()).toHaveLength(25));
});
