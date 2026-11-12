import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import LivePage from './page';

const mockLoad = jest.fn();
jest.mock('@/lib/iptv-catalog', () => ({
  loadIptvCatalog: (...args: unknown[]) => mockLoad(...args),
}));

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/LivePlayer', () => ({
  __esModule: true,
  default: ({ channel }: { channel: { name: string } }) => (
    <div aria-label='当前直播播放器'>{channel.name}</div>
  ),
}));
const channels = [
  {
    id: 'world:dw',
    country: 'DE',
    countryName: '德国',
    categories: ['新闻'],
    languages: ['英语'],
    name: 'DW English',
    category: '国际新闻与纪录',
    urls: [
      'https://example.com/a',
      'https://example.com/b',
      'https://example.com/c',
    ],
    language: '英语',
    quality: '标称高清',
    website: 'https://www.dw.com/',
    verification: { method: '官方页面与目录核对，未实测', checkedAt: '' },
  },
  {
    id: 'cn:zhejiang',
    country: 'CN',
    countryName: '中国',
    categories: ['综合'],
    languages: ['普通话'],
    name: '浙江卫视',
    category: '高清卫视',
    urls: ['https://example.com/d'],
    language: '普通话',
    quality: '标称1080p',
    verification: { method: 'upstream-decode', checkedAt: '2026-11-10' },
  },
];
beforeEach(() => {
  localStorage.clear();
  mockLoad.mockReset();
  mockLoad.mockResolvedValue({
    channels,
    stale: false,
    updatedAt: Date.now(),
    source: 'subscription',
  });
});
async function openPage() {
  await act(async () => {
    render(<LivePage />);
  });
}
it('puts an explicit source count directly alongside each channel name', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  const dw = screen.getByRole('button', { name: '播放 DW English' });
  expect(within(dw).getByText('3 个源')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '国内频道' }));
  expect(
    within(screen.getByRole('button', { name: '播放 浙江卫视' })).getByText(
      '1 个源'
    )
  ).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '海外频道' })).toBeInTheDocument();
});
it('separates domestic and overseas categories and searches language metadata', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '国内频道' }));
  expect(screen.queryByRole('button', { name: '播放 DW English' })).toBeNull();
  expect(
    screen.getByRole('button', { name: '播放 浙江卫视' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索频道' }), {
    target: { value: '英语' },
  });
  expect(
    screen.getByRole('button', { name: '播放 DW English' })
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '播放 浙江卫视' })).toBeNull();
});
it('does not present untested candidates as verified playback and labels upstream checks accurately', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  fireEvent.click(screen.getByRole('button', { name: '播放 DW English' }));
  expect(
    screen.getByText('频道候选 · 播放状态以实际连接为准')
  ).toBeInTheDocument();
  expect(screen.queryByText('本站检测通过')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '国内频道' }));
  fireEvent.click(screen.getByRole('button', { name: '播放 浙江卫视' }));
  expect(screen.getByText('上游检测通过')).toBeInTheDocument();
  expect(screen.queryByText('本站检测通过')).toBeNull();
});
it('preserves favorites, recents, and M3U import', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  fireEvent.click(screen.getByRole('button', { name: '收藏 DW English' }));
  fireEvent.click(screen.getByRole('button', { name: /^收藏$/ }));
  expect(screen.queryByRole('button', { name: '播放 浙江卫视' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  fireEvent.click(screen.getByRole('button', { name: '播放 DW English' }));
  fireEvent.click(screen.getByRole('button', { name: '最近观看' }));
  expect(
    screen.getByRole('button', { name: '播放 DW English' })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '导入频道' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'M3U 内容' }), {
    target: {
      value: '#EXTM3U\n#EXTINF:-1,自定义新闻\nhttps://example.com/live.m3u8',
    },
  });
  fireEvent.click(screen.getByRole('button', { name: '保存频道' }));
  expect(
    screen.getByRole('button', { name: '播放 自定义新闻' })
  ).toBeInTheDocument();
  expect(localStorage.getItem('moontv_live_preferences_v1')).toContain(
    '自定义新闻'
  );
});

it('never shows shopping channels in either region or imported lists', async () => {
  mockLoad.mockResolvedValue({
    channels: [
      ...channels,
      {
        id: 'cn:shopping',
        name: '快乐购物',
        category: '购物',
        urls: ['https://example.com/shop.m3u8'],
      },
      {
        id: 'world:qvc',
        name: 'QVC',
        category: 'Shopping',
        urls: ['https://example.com/qvc.m3u8'],
      },
    ],
    stale: false,
    updatedAt: Date.now(),
    source: 'subscription',
  });
  await openPage();
  expect(screen.queryByRole('button', { name: '播放 快乐购物' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  expect(screen.queryByRole('button', { name: '播放 QVC' })).toBeNull();
});

it('keeps the current stream selected while browsing other channel groups', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '播放 浙江卫视' }));
  expect(screen.getByLabelText('当前直播播放器')).toHaveTextContent('浙江卫视');
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  fireEvent.change(screen.getByRole('textbox', { name: '搜索频道' }), {
    target: { value: 'DW' },
  });
  expect(screen.getByLabelText('当前直播播放器')).toHaveTextContent('浙江卫视');
  fireEvent.click(screen.getByRole('button', { name: '播放 DW English' }));
  expect(screen.getByLabelText('当前直播播放器')).toHaveTextContent(
    'DW English'
  );
});

it('filters by country and category without changing current playback', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '播放 浙江卫视' }));
  fireEvent.change(screen.getByLabelText('按国家筛选'), {
    target: { value: 'DE' },
  });
  expect(screen.queryByRole('button', { name: '播放 浙江卫视' })).toBeNull();
  expect(
    screen.getByRole('button', { name: '播放 DW English' })
  ).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('按分类筛选'), {
    target: { value: '综合' },
  });
  expect(screen.queryByRole('button', { name: '播放 DW English' })).toBeNull();
  expect(screen.getByLabelText('当前直播播放器')).toHaveTextContent('浙江卫视');
});

it('renders a bounded window of ten thousand channels and searches the full directory', async () => {
  mockLoad.mockResolvedValue({
    channels: Array.from({ length: 10000 }, (_, index) => ({
      ...channels[0],
      id: `world:${index}`,
      name: `测试台${String(index).padStart(5, '0')}`,
    })),
    stale: false,
    updatedAt: Date.now(),
    source: 'subscription',
  });
  await openPage();
  expect(
    screen.getAllByRole('button', { name: /^播放 测试台/ }).length
  ).toBeLessThan(30);
  fireEvent.scroll(screen.getByLabelText('滚动频道列表'), {
    target: { scrollTop: 6400 },
  });
  expect(
    screen.getByRole('button', { name: '播放 测试台00100' })
  ).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: '搜索频道' }), {
    target: { value: '测试台09999' },
  });
  expect(
    screen.getByRole('button', { name: '播放 测试台09999' })
  ).toBeInTheDocument();
});

it('uses the client cache loader and requests an explicit refresh only on demand', async () => {
  await openPage();
  expect(mockLoad).toHaveBeenCalledTimes(1);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '更新频道' }));
  });
  expect(mockLoad).toHaveBeenLastCalledWith(
    expect.objectContaining({ force: true })
  );
});

it('keeps an active stream when a refreshed directory no longer includes it', async () => {
  await openPage();
  fireEvent.click(screen.getByRole('button', { name: '播放 浙江卫视' }));
  mockLoad.mockResolvedValue({
    channels: [channels[0]],
    stale: false,
    updatedAt: Date.now(),
    source: 'subscription',
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '更新频道' }));
  });
  expect(screen.getByLabelText('当前直播播放器')).toHaveTextContent('浙江卫视');
});
