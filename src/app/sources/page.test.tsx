import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import SourcesPage from './page';

jest.mock('@/components/PageLayout', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const source = {
  key: 'old',
  name: '原有源',
  api: 'https://example.com/api',
  from: 'config',
  disabled: false,
};
const response = (data: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 409,
  json: async () => data,
});

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock
    .mockReset()
    .mockResolvedValue(
      response({
        sources: [source],
        defaults: [source],
        revision: 1,
        canManage: true,
        configured: true,
        sharedPasswordAccess: true,
      })
    );
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('adds a source to the shared draft and saves the list with its revision', async () => {
  render(<SourcesPage />);
  await screen.findByText('原有源');
  fireEvent.change(screen.getByLabelText('源标识'), {
    target: { value: 'new' },
  });
  fireEvent.change(screen.getByLabelText('名称'), {
    target: { value: '新增源' },
  });
  fireEvent.change(screen.getByLabelText('采集 API 地址'), {
    target: { value: 'https://example.org/api' },
  });
  fireEvent.click(screen.getByText('添加到草稿'));
  await screen.findByText('新增源');
  fetchMock.mockResolvedValueOnce(response({ ok: true, revision: 2 }));
  fireEvent.click(screen.getByText('保存到所有设备'));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const body = JSON.parse(fetchMock.mock.calls[1][1].body);
  expect(body.revision).toBe(1);
  expect(body.sources.map((item: { key: string }) => item.key)).toEqual([
    'old',
    'new',
  ]);
});

it('keeps unsaved changes when another device has already updated the configuration', async () => {
  render(<SourcesPage />);
  await screen.findByText('原有源');
  fireEvent.click(screen.getByLabelText('启用 原有源'));
  fetchMock.mockResolvedValueOnce(
    response({ error: '另一设备已更新配置，请重新加载后再保存' }, false)
  );
  fireEvent.click(screen.getByText('保存到所有设备'));
  await screen.findByText('另一设备已更新配置，请重新加载后再保存');
  expect(screen.getByLabelText('启用 原有源')).not.toBeChecked();
  expect(screen.getByText('保存到所有设备')).not.toBeDisabled();
});

it('previews imported JSON before changing any existing source', async () => {
  render(<SourcesPage />);
  await screen.findByText('原有源');
  fireEvent.change(screen.getByLabelText('源配置 JSON'), {
    target: {
      value: JSON.stringify({
        api_site: { added: { name: '导入源', api: 'https://example.org/api' } },
      }),
    },
  });
  fireEvent.click(screen.getByText('预览 JSON'));
  expect(screen.getByText('预览：1 个源')).toBeInTheDocument();
  expect(screen.getByLabelText('启用 原有源')).toBeChecked();
  expect(screen.queryByLabelText('启用 导入源')).not.toBeInTheDocument();
  fireEvent.click(screen.getByText('合并到草稿（保留现有开关）'));
  expect(screen.getByLabelText('启用 导入源')).toBeChecked();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
