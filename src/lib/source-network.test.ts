/** @jest-environment node */
import { Response } from 'next/dist/compiled/@edge-runtime/primitives';

import { checkSource, fetchSourceUrl } from './source-network';

Object.assign(global, { Response });
const source = {
  key: 'sample',
  name: '源',
  api: 'https://example.com/api',
  from: 'custom' as const,
};
const originalFetch = global.fetch;
const fetchMock = jest.fn();
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterAll(() => {
  global.fetch = originalFetch;
});

it('checks MacCMS JSON instead of calling HEAD or assuming HTTP 200 is healthy', async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ list: [{ vod_id: 1, vod_name: '测试' }] }))
  );
  const result = await checkSource(source);
  expect(result).toMatchObject({ status: 'ok', itemCount: 1 });
  expect(fetchMock.mock.calls[0][1].method).toBeUndefined();
  expect(fetchMock.mock.calls[0][0]).toContain('ac=videolist');
});

it('distinguishes empty valid catalogues from unreachable sources', async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ list: [] })));
  expect(await checkSource(source)).toMatchObject({
    status: 'ok',
    itemCount: 0,
  });
});

it('reports HTML challenge pages as incompatible responses, not valid APIs', async () => {
  fetchMock.mockResolvedValue(new Response('<html>challenge</html>'));
  expect((await checkSource(source)).status).toBe('invalid_response');
});

it('does not equate a blocked request with a permanently dead source', async () => {
  fetchMock.mockResolvedValue(new Response('Forbidden', { status: 403 }));
  expect(await checkSource(source)).toMatchObject({
    status: 'http_error',
    httpStatus: 403,
  });
});

it('validates redirect destinations and never requests private addresses', async () => {
  fetchMock.mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { Location: 'http://127.0.0.1/private' },
    })
  );
  await expect(fetchSourceUrl(source.api)).rejects.toThrow();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
