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

let query = 'kind=movie';
const replace = jest.fn();
const push = jest.fn();
const observers: Array<{
  callback: IntersectionObserverCallback;
  observe: jest.Mock;
  disconnect: jest.Mock;
  options?: IntersectionObserverInit;
}> = [];

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => new URLSearchParams(query),
}));
jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const cards = () => screen.getAllByRole('link', { name: /^查看 .* 的详情$/ });
const resourceCalls = () =>
  (fetch as jest.Mock).mock.calls.filter(([url]) =>
    String(url).startsWith('/api/kids?')
  );

beforeEach(() => {
  query = 'kind=movie';
  replace.mockClear();
  push.mockClear();
  localStorage.clear();
  window.history.replaceState({}, '', `/kids?${query}`);
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
  // Metadata never resolves: browsing must not wait for a poster or a source.
  global.fetch = jest.fn(() => new Promise(() => undefined)) as jest.Mock;
});

it('shows 25 immediately clickable movies without waiting for any network response', () => {
  render(<KidsPage />);
  expect(cards()).toHaveLength(25);
  fireEvent.click(screen.getByRole('link', { name: '查看 头脑特工队 的详情' }));
  const href = new URL(push.mock.calls[0][0], 'https://test.local');
  expect(href.pathname).toBe('/detail');
  expect(href.searchParams.get('kids_id')).toBe('insideout');
  expect(href.searchParams.has('kids_language')).toBe(false);
  expect(href.searchParams.has('source')).toBe(false);
  expect(href.searchParams.has('id')).toBe(false);
  expect(href.searchParams.get('stype')).toBe('movie');
  expect(href.searchParams.get('returnTo')).toBe('/kids?kind=movie');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(resourceCalls()).toHaveLength(0);
});

it('appends another 25 movies while the initial poster requests are still pending', async () => {
  render(<KidsPage />);
  await waitFor(() =>
    expect((fetch as jest.Mock).mock.calls.length).toBeGreaterThan(0)
  );
  const initialCalls = [...(fetch as jest.Mock).mock.calls];
  expect(initialCalls).toHaveLength(6);
  const observer = [...observers]
    .reverse()
    .find((item) => item.observe.mock.calls.length);
  if (!observer) throw new Error('Missing pagination observer');
  act(() =>
    observer.callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    )
  );
  expect(cards()).toHaveLength(50);
  expect(fetch).toHaveBeenCalledTimes(6);
  expect(resourceCalls()).toHaveLength(0);
  for (const [, options] of initialCalls) {
    expect(options?.signal?.aborted).not.toBe(true);
  }
});

it('filters the offline catalogue by aliases immediately and resets pagination on clear', () => {
  render(<KidsPage />);
  fireEvent.change(screen.getByRole('textbox', { name: '搜索动画' }), {
    target: { value: 'Inside Out' },
  });
  const expected = KIDS_TITLES.filter(
    (item) =>
      item.kind === 'movie' &&
      `${item.name} ${(item.aliases || []).join(' ')}`
        .toLowerCase()
        .includes('inside out')
  );
  expect(cards()).toHaveLength(expected.length);
  expect(
    screen.getByRole('link', { name: '查看 头脑特工队 的详情' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
  expect(cards()).toHaveLength(25);
  expect(resourceCalls()).toHaveLength(0);
});

it('passes an explicitly requested audio language to shared discovery without claiming availability', () => {
  query = 'kind=movie&language=en';
  window.history.replaceState({}, '', `/kids?${query}`);
  render(<KidsPage />);
  expect(cards()).toHaveLength(25);
  fireEvent.click(screen.getByRole('link', { name: '查看 头脑特工队 的详情' }));
  const href = new URL(push.mock.calls[0][0], 'https://test.local');
  expect(href.searchParams.get('kids_id')).toBe('insideout');
  expect(href.searchParams.get('kids_language')).toBe('en');
  expect(href.searchParams.get('returnTo')).toBe(
    '/kids?kind=movie&language=en'
  );
  expect(resourceCalls()).toHaveLength(0);
});

it('keeps compact category navigation and omits the old selection panels', () => {
  render(<KidsPage />);
  fireEvent.click(screen.getByRole('button', { name: '动画剧集' }));
  expect(replace).toHaveBeenCalledWith('/kids?kind=tv', { scroll: false });
  expect(screen.queryByText('家长入口')).toBeNull();
  expect(screen.queryByText('再找找其他动画')).toBeNull();
  expect(screen.queryByText('就看这个版本')).toBeNull();
});
