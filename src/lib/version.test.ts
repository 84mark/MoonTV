import { checkForUpdates, CURRENT_VERSION, UpdateStatus } from './version';

describe('repository version check', () => {
  const originalFetch = global.fetch;
  const fetchMock = jest.fn();

  beforeEach(() => {
    global.fetch = fetchMock;
    fetchMock.mockReset();
  });
  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('reads the maintained repository without a third-party proxy', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => CURRENT_VERSION });
    expect(await checkForUpdates()).toBe(UpdateStatus.NO_UPDATE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://raw.githubusercontent.com/84mark/MoonTV/main/VERSION.txt'
    );
  });

  it('recognizes a newer version', async () => {
    fetchMock.mockResolvedValue({ ok: true, text: async () => '20990101000000' });
    expect(await checkForUpdates()).toBe(UpdateStatus.HAS_UPDATE);
  });

  it.each(['<html>proxy error</html>', '', 'invalid', '20250804231933junk'])(
    'does not treat an invalid version response as up to date: %s',
    async (value) => {
      fetchMock.mockResolvedValue({ ok: true, text: async () => value });
      expect(await checkForUpdates()).toBe(UpdateStatus.FETCH_FAILED);
    }
  );
});
