import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import LivePage from './page';

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
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ channels, fallback: false, updatedAt: 0 }),
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
  (fetch as jest.Mock).mockResolvedValue({
    ok: true,
    json: async () => ({
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
    }),
  });
  await openPage();
  expect(screen.queryByRole('button', { name: '播放 快乐购物' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '海外频道' }));
  expect(screen.queryByRole('button', { name: '播放 QVC' })).toBeNull();
});
